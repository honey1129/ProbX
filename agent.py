#!/usr/bin/env python3
"""Trading agent for the ProbX Anchor prediction market.

Live mode:
  - Fetches Market accounts from the Solana program.
  - Computes weighted signals.
  - Sends the Anchor `place_bet(amount, side)` instruction.

Simulation mode:
  - Runs multiple agents against synthetic YES/NO pools.
  - Uses the same signal and sizing logic without RPC access.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import logging
import math
import os
import random
import struct
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import requests
except ImportError:
    requests = None

try:
    import yaml
except ImportError:
    yaml = None

try:
    from solana.rpc.api import Client
    from solana.rpc.commitment import Confirmed
    from solana.rpc.types import TxOpts
    from solders.hash import Hash
    from solders.instruction import AccountMeta, Instruction
    from solders.keypair import Keypair
    from solders.message import MessageV0
    from solders.pubkey import Pubkey
    from solders.system_program import ID as SYSTEM_PROGRAM_ID
    from solders.transaction import VersionedTransaction
except ImportError:  # Live mode will raise a clear error if these are missing.
    Client = None
    Confirmed = None
    TxOpts = None
    Hash = None
    AccountMeta = None
    Instruction = None
    Keypair = None
    MessageV0 = None
    Pubkey = None
    SYSTEM_PROGRAM_ID = None
    VersionedTransaction = None


SIDE_NO = 0
SIDE_YES = 1
SIDE_LABELS = {SIDE_NO: "NO", SIDE_YES: "YES"}
LAMPORTS_PER_SOL = 1_000_000_000
PRICE_SCALE = 1_000_000_000
MARKET_DISCRIMINATOR = hashlib.sha256(b"account:Market").digest()[:8]
PLACE_BET_DISCRIMINATOR = hashlib.sha256(b"global:place_bet").digest()[:8]


@dataclass
class MarketSnapshot:
    market: str
    market_id: int
    question: str
    creator: str
    resolver: str
    yes_pool: int
    no_pool: int
    total_liquidity: int
    end_time: int
    resolved: bool = False
    outcome: int = SIDE_NO

    @property
    def implied_probability(self) -> float:
        total = self.total_liquidity or self.yes_pool + self.no_pool
        if total <= 0:
            return 0.0
        return max(0.0, min(1.0, self.yes_pool / total))


@dataclass
class Decision:
    market: str
    side: int | None
    size_lamports: int
    score: float
    confidence: float
    reason: str

    @property
    def side_label(self) -> str:
        if self.side is None:
            return "SKIP"
        return SIDE_LABELS[self.side]


@dataclass
class Config:
    rpc_url: str
    program_id: str
    wallet_path: str
    idl_path: str
    api_endpoint: str | None
    dry_run: bool
    polling_interval_sec: float
    max_markets_per_cycle: int
    min_signal: float
    min_bet_lamports: int
    max_bet_lamports: int
    max_bet_per_market_lamports: int
    max_total_exposure_lamports: int
    stop_loss_probability_move: float
    stop_loss_action: str
    stop_loss_hedge_lamports: int
    momentum_lookback: int
    momentum_threshold: float
    mean_reversion_threshold: float
    weights: dict[str, float]
    log_file: str
    random_seed: int
    simulation: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "Config":
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) if yaml is not None else parse_simple_yaml(fh.read())
        raw = raw or {}

        trading = raw.get("trading", {})
        risk = raw.get("risk", {})
        signals = raw.get("signals", {})
        logging_cfg = raw.get("logging", {})

        return cls(
            rpc_url=raw.get("rpc_url", "http://127.0.0.1:8899"),
            program_id=raw["program_id"],
            wallet_path=os.path.expanduser(raw.get("wallet_path", "~/.config/solana/id.json")),
            idl_path=raw.get("idl_path", "idl/probx_prediction.json"),
            api_endpoint=raw.get("api_endpoint") or None,
            dry_run=bool(raw.get("dry_run", True)),
            polling_interval_sec=float(raw.get("polling_interval_sec", 10)),
            max_markets_per_cycle=int(raw.get("max_markets_per_cycle", 50)),
            min_signal=float(trading.get("min_signal", 0.15)),
            min_bet_lamports=int(trading.get("min_bet_lamports", 10_000_000)),
            max_bet_lamports=int(trading.get("max_bet_lamports", 100_000_000)),
            max_bet_per_market_lamports=int(
                risk.get("max_bet_per_market_lamports", 250_000_000)
            ),
            max_total_exposure_lamports=int(
                risk.get("max_total_exposure_lamports", 1_000_000_000)
            ),
            stop_loss_probability_move=float(risk.get("stop_loss_probability_move", 0.08)),
            stop_loss_action=str(risk.get("stop_loss_action", "halt")).lower(),
            stop_loss_hedge_lamports=int(risk.get("stop_loss_hedge_lamports", 50_000_000)),
            momentum_lookback=int(signals.get("momentum_lookback", 3)),
            momentum_threshold=float(signals.get("momentum_threshold", 0.01)),
            mean_reversion_threshold=float(signals.get("mean_reversion_threshold", 0.12)),
            weights={
                "momentum": float(signals.get("weights", {}).get("momentum", 0.4)),
                "mean_reversion": float(signals.get("weights", {}).get("mean_reversion", 0.35)),
                "external": float(signals.get("weights", {}).get("external", 0.25)),
            },
            log_file=logging_cfg.get("trade_log", "data/trades.csv"),
            random_seed=int(raw.get("random_seed", 7)),
            simulation=raw.get("simulation", {}),
        )


class MarketFetcher:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = None
        self.program_id = None

        if cfg.api_endpoint is None:
            self._require_solana_deps()
            self.client = Client(cfg.rpc_url)
            self.program_id = Pubkey.from_string(cfg.program_id)

    def fetch_active_markets(self) -> list[MarketSnapshot]:
        if self.cfg.api_endpoint:
            markets = self._fetch_from_api(self.cfg.api_endpoint)
        else:
            markets = self._fetch_from_chain()

        now = int(time.time())
        active = [m for m in markets if not m.resolved and m.end_time > now]
        active.sort(key=lambda m: (m.end_time, m.market))
        return active[: self.cfg.max_markets_per_cycle]

    def _fetch_from_api(self, endpoint: str) -> list[MarketSnapshot]:
        if requests is None:
            raise RuntimeError("API fetching requires requests. Install requirements.txt.")
        response = requests.get(endpoint, timeout=10)
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("markets", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise ValueError("Market API must return a list or {'markets': [...]} payload")
        return [self._snapshot_from_mapping(row) for row in rows]

    def _fetch_from_chain(self) -> list[MarketSnapshot]:
        assert self.client is not None and self.program_id is not None
        response = self.client.get_program_accounts(self.program_id, encoding="base64")
        accounts = _rpc_value(response)
        snapshots: list[MarketSnapshot] = []

        for item in accounts or []:
            pubkey = _read_attr_or_key(item, "pubkey")
            account = _read_attr_or_key(item, "account")
            raw = _decode_account_data(_read_attr_or_key(account, "data"))
            if raw.startswith(MARKET_DISCRIMINATOR):
                snapshots.append(decode_market_account(str(pubkey), raw))

        return snapshots

    @staticmethod
    def _snapshot_from_mapping(row: dict[str, Any]) -> MarketSnapshot:
        yes_pool = int(_pick(row, "yes_pool", "yesPool", default=0))
        no_pool = int(_pick(row, "no_pool", "noPool", default=0))
        total = int(_pick(row, "total_liquidity", "totalLiquidity", default=yes_pool + no_pool))
        return MarketSnapshot(
            market=str(_pick(row, "market", "pubkey", "address")),
            market_id=int(_pick(row, "id", "market_id", "marketId", default=0)),
            question=str(_pick(row, "question", default="")),
            creator=str(_pick(row, "creator", default="")),
            resolver=str(_pick(row, "resolver", default="")),
            yes_pool=yes_pool,
            no_pool=no_pool,
            total_liquidity=total,
            end_time=int(_pick(row, "end_time", "endTime", default=0)),
            resolved=bool(_pick(row, "resolved", default=False)),
            outcome=int(_pick(row, "outcome", default=SIDE_NO)),
        )

    @staticmethod
    def _require_solana_deps() -> None:
        if Client is None or Pubkey is None:
            raise RuntimeError(
                "Live mode requires solana-py and solders. Install dependencies from "
                "requirements.txt or run with --simulate."
            )


class SignalEngine:
    def __init__(self, cfg: Config, name: str = "agent", random_seed: int | None = None):
        if pd is None:
            raise RuntimeError("SignalEngine requires pandas. Install requirements.txt.")
        self.cfg = cfg
        self.name = name
        self.rng = random.Random(cfg.random_seed if random_seed is None else random_seed)
        self.history = pd.DataFrame(columns=["ts", "market", "probability"])

    def update_history(self, markets: Iterable[MarketSnapshot]) -> None:
        rows = [
            {"ts": time.time(), "market": m.market, "probability": m.implied_probability}
            for m in markets
        ]
        if not rows:
            return
        new_rows = pd.DataFrame(rows)
        if self.history.empty:
            self.history = new_rows
        else:
            self.history = pd.concat([self.history, new_rows], ignore_index=True)
        self.history = self.history.groupby("market", group_keys=False).tail(200)

    def decide(self, market: MarketSnapshot) -> Decision:
        components = {
            "momentum": self._momentum_signal(market),
            "mean_reversion": self._mean_reversion_signal(market),
            "external": self._external_signal(market),
        }
        weight_sum = sum(abs(v) for v in self.cfg.weights.values()) or 1.0
        score = sum(self.cfg.weights[k] * components[k] for k in components) / weight_sum
        score = _clip(score, -1.0, 1.0)
        confidence = abs(score)

        if confidence < self.cfg.min_signal:
            side = None
            size = 0
        else:
            side = SIDE_YES if score > 0 else SIDE_NO
            raw_size = int(self.cfg.max_bet_lamports * confidence)
            size = max(self.cfg.min_bet_lamports, min(self.cfg.max_bet_lamports, raw_size))

        reason = ", ".join(f"{k}={v:+.3f}" for k, v in components.items())
        return Decision(
            market=market.market,
            side=side,
            size_lamports=size,
            score=score,
            confidence=confidence,
            reason=reason,
        )

    def _momentum_signal(self, market: MarketSnapshot) -> float:
        rows = self.history[self.history["market"] == market.market]
        lookback = self.cfg.momentum_lookback
        if len(rows) <= lookback:
            return 0.0
        current = float(rows.iloc[-1]["probability"])
        previous = float(rows.iloc[-1 - lookback]["probability"])
        delta = current - previous
        if abs(delta) < self.cfg.momentum_threshold:
            return 0.0
        return _clip(delta / max(self.cfg.momentum_threshold * 3, 1e-9), -1.0, 1.0)

    def _mean_reversion_signal(self, market: MarketSnapshot) -> float:
        p = market.implied_probability
        deviation = p - 0.5
        threshold = self.cfg.mean_reversion_threshold
        if abs(deviation) <= threshold:
            return 0.0
        return _clip(-deviation / 0.5, -1.0, 1.0)

    def _external_signal(self, market: MarketSnapshot) -> float:
        sentiment = self.rng.uniform(-1.0, 1.0)
        liquidity_penalty = 0.5 if market.total_liquidity <= 0 else 1.0
        return sentiment * liquidity_penalty


class TradeLogger:
    fieldnames = [
        "ts",
        "agent",
        "market",
        "question",
        "side",
        "amount_lamports",
        "entry_probability",
        "score",
        "confidence",
        "reason",
        "tx_signature",
        "status",
    ]

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.trades: list[dict[str, Any]] = []
        self._load_existing()

    def record(
        self,
        *,
        agent: str,
        market: MarketSnapshot,
        decision: Decision,
        tx_signature: str,
        status: str,
    ) -> None:
        row = {
            "ts": int(time.time()),
            "agent": agent,
            "market": market.market,
            "question": market.question,
            "side": decision.side_label,
            "amount_lamports": decision.size_lamports,
            "entry_probability": f"{market.implied_probability:.10f}",
            "score": f"{decision.score:.6f}",
            "confidence": f"{decision.confidence:.6f}",
            "reason": decision.reason,
            "tx_signature": tx_signature,
            "status": status,
        }
        self.trades.append(row)

        write_header = not self.path.exists()
        with self.path.open("a", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=self.fieldnames)
            if write_header:
                writer.writeheader()
            writer.writerow(row)

    def exposure_lamports(self, market: str | None = None) -> int:
        rows = self.trades
        if market is not None:
            rows = [row for row in rows if row.get("market") == market]
        return sum(
            int(row.get("amount_lamports") or 0)
            for row in rows
            if row.get("status") in {"sent", "dry_run", "simulated"}
            and row.get("side") in {"YES", "NO"}
        )

    def average_entry(self, market: str, side: int) -> float | None:
        label = SIDE_LABELS[side]
        rows = [
            row
            for row in self.trades
            if row.get("market") == market
            and row.get("side") == label
            and row.get("status") in {"sent", "dry_run", "simulated"}
        ]
        if not rows:
            return None
        total_size = sum(int(row["amount_lamports"]) for row in rows)
        if total_size <= 0:
            return None
        weighted = sum(
            int(row["amount_lamports"]) * float(row["entry_probability"]) for row in rows
        )
        return weighted / total_size

    def mark_to_market_pnl(self, markets: Iterable[MarketSnapshot]) -> float:
        probs = {m.market: m.implied_probability for m in markets}
        pnl = 0.0
        for row in self.trades:
            if row.get("status") not in {"sent", "dry_run", "simulated"}:
                continue
            market = row.get("market")
            if market not in probs:
                continue
            amount = int(row["amount_lamports"])
            entry = float(row["entry_probability"])
            current = probs[market]
            if row["side"] == "YES":
                pnl += amount * (current - entry)
            elif row["side"] == "NO":
                pnl += amount * (entry - current)
        return pnl

    def _load_existing(self) -> None:
        if not self.path.exists():
            return
        with self.path.open("r", newline="", encoding="utf-8") as fh:
            self.trades = list(csv.DictReader(fh))


class RiskManager:
    def __init__(self, cfg: Config, logger: TradeLogger):
        self.cfg = cfg
        self.logger = logger

    def apply(self, decision: Decision, market: MarketSnapshot) -> Decision:
        if decision.side is None:
            return decision

        stop_loss_decision = self._stop_loss_decision(decision, market)
        if stop_loss_decision is not None:
            return stop_loss_decision

        market_exposure = self.logger.exposure_lamports(market.market)
        total_exposure = self.logger.exposure_lamports()
        remaining_market = self.cfg.max_bet_per_market_lamports - market_exposure
        remaining_total = self.cfg.max_total_exposure_lamports - total_exposure
        allowed = max(0, min(decision.size_lamports, remaining_market, remaining_total))

        if allowed < self.cfg.min_bet_lamports:
            return Decision(
                market=decision.market,
                side=None,
                size_lamports=0,
                score=decision.score,
                confidence=decision.confidence,
                reason=f"{decision.reason}, risk=exposure_limit",
            )

        decision.size_lamports = allowed
        return decision

    def _stop_loss_decision(self, decision: Decision, market: MarketSnapshot) -> Decision | None:
        for side in (SIDE_YES, SIDE_NO):
            entry = self.logger.average_entry(market.market, side)
            if entry is None:
                continue
            p = market.implied_probability
            adverse_move = entry - p if side == SIDE_YES else p - entry
            if adverse_move < self.cfg.stop_loss_probability_move:
                continue

            if self.cfg.stop_loss_action == "hedge":
                hedge_side = SIDE_NO if side == SIDE_YES else SIDE_YES
                return Decision(
                    market=market.market,
                    side=hedge_side,
                    size_lamports=min(self.cfg.stop_loss_hedge_lamports, self.cfg.max_bet_lamports),
                    score=decision.score,
                    confidence=decision.confidence,
                    reason=f"{decision.reason}, risk=stop_loss_hedge",
                )

            return Decision(
                market=market.market,
                side=None,
                size_lamports=0,
                score=decision.score,
                confidence=decision.confidence,
                reason=f"{decision.reason}, risk=stop_loss_halt",
            )

        return None


class ExecutionEngine:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = None
        self.program_id = None
        self.wallet = None

        if not cfg.dry_run:
            self._require_solana_deps()
            self.client = Client(cfg.rpc_url)
            self.program_id = Pubkey.from_string(cfg.program_id)
            self.wallet = load_keypair(cfg.wallet_path)

    def place_bet(self, market: MarketSnapshot, decision: Decision) -> tuple[str, str]:
        if decision.side is None or decision.size_lamports <= 0:
            return "", "skipped"

        if self.cfg.dry_run:
            logging.info(
                "DRY RUN bet market=%s side=%s size=%.6f SOL score=%.3f",
                market.market,
                decision.side_label,
                decision.size_lamports / LAMPORTS_PER_SOL,
                decision.score,
            )
            return "dry-run", "dry_run"

        assert self.client is not None and self.program_id is not None and self.wallet is not None
        owner = self.wallet.pubkey()
        market_pk = Pubkey.from_string(market.market)
        position_pk, _ = Pubkey.find_program_address(
            [b"position", bytes(market_pk), bytes(owner)],
            self.program_id,
        )

        data = (
            PLACE_BET_DISCRIMINATOR
            + struct.pack("<Q", decision.size_lamports)
            + struct.pack("<B", decision.side)
        )
        ix = Instruction(
            self.program_id,
            data,
            [
                AccountMeta(market_pk, False, True),
                AccountMeta(position_pk, False, True),
                AccountMeta(owner, True, True),
                AccountMeta(SYSTEM_PROGRAM_ID, False, False),
            ],
        )
        blockhash = extract_blockhash(self.client.get_latest_blockhash())
        if isinstance(blockhash, str):
            blockhash = Hash.from_string(blockhash)
        msg = MessageV0.try_compile(owner, [ix], [], blockhash)
        tx = VersionedTransaction(msg, [self.wallet])
        response = self.client.send_transaction(
            tx,
            opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed),
        )
        signature = str(_rpc_value(response))
        logging.info("Sent bet tx=%s market=%s side=%s", signature, market.market, decision.side_label)
        return signature, "sent"

    @staticmethod
    def _require_solana_deps() -> None:
        if any(x is None for x in [Client, Pubkey, Keypair, Instruction, VersionedTransaction]):
            raise RuntimeError("Execution requires solana-py and solders.")


class TradingAgent:
    def __init__(self, cfg: Config, name: str = "agent"):
        self.cfg = cfg
        self.name = name
        self.fetcher = MarketFetcher(cfg)
        self.signal_engine = SignalEngine(cfg, name=name)
        self.logger = TradeLogger(cfg.log_file)
        self.risk = RiskManager(cfg, self.logger)
        self.execution = ExecutionEngine(cfg)

    def run_once(self) -> None:
        markets = self.fetcher.fetch_active_markets()
        if not markets:
            logging.info("No active markets found")
            return

        self.signal_engine.update_history(markets)
        self._print_market_table(markets)

        for market in markets:
            decision = self.signal_engine.decide(market)
            decision = self.risk.apply(decision, market)
            if decision.side is None:
                logging.info("Skip market=%s reason=%s", market.market, decision.reason)
                continue
            signature, status = self.execution.place_bet(market, decision)
            self.logger.record(
                agent=self.name,
                market=market,
                decision=decision,
                tx_signature=signature,
                status=status,
            )

        pnl = self.logger.mark_to_market_pnl(markets)
        logging.info(
            "Cycle summary exposure=%.6f SOL approx_unrealized_pnl=%.6f SOL trades=%d",
            self.logger.exposure_lamports() / LAMPORTS_PER_SOL,
            pnl / LAMPORTS_PER_SOL,
            len(self.logger.trades),
        )

    def run_forever(self) -> None:
        while True:
            self.run_once()
            time.sleep(self.cfg.polling_interval_sec)

    @staticmethod
    def _print_market_table(markets: list[MarketSnapshot]) -> None:
        rows = [
            {
                "market": m.market[:8],
                "yes_pool_sol": m.yes_pool / LAMPORTS_PER_SOL,
                "no_pool_sol": m.no_pool / LAMPORTS_PER_SOL,
                "p_yes": round(m.implied_probability, 4),
                "end_time": m.end_time,
                "question": m.question[:60],
            }
            for m in markets
        ]
        logging.info("Active markets:\n%s", pd.DataFrame(rows).to_string(index=False))


@dataclass
class SimPosition:
    yes_amount: int = 0
    no_amount: int = 0


class SimulationAgent:
    def __init__(self, cfg: Config, name: str, seed: int):
        self.name = name
        self.engine = SignalEngine(cfg, name=name, random_seed=seed)
        self.cash = int(cfg.simulation.get("initial_cash_lamports", 5 * LAMPORTS_PER_SOL))
        self.positions: dict[str, SimPosition] = {}
        self.pnl = 0
        self.trades = 0

    def trade(self, cfg: Config, market: MarketSnapshot) -> Decision:
        decision = self.engine.decide(market)
        if decision.side is None or self.cash < cfg.min_bet_lamports:
            return decision
        size = min(decision.size_lamports, self.cash, cfg.max_bet_lamports)
        if size < cfg.min_bet_lamports:
            decision.side = None
            decision.size_lamports = 0
            return decision
        decision.size_lamports = size
        self.cash -= size
        pos = self.positions.setdefault(market.market, SimPosition())
        if decision.side == SIDE_YES:
            pos.yes_amount += size
        else:
            pos.no_amount += size
        self.trades += 1
        return decision


def run_simulation(cfg: Config, agent_count: int, steps: int) -> None:
    rng = random.Random(cfg.random_seed)
    market_count = int(cfg.simulation.get("market_count", 3))
    initial_pool = int(cfg.simulation.get("initial_pool_lamports", 2 * LAMPORTS_PER_SOL))
    agents = [
        SimulationAgent(cfg, name=f"agent_{i + 1}", seed=cfg.random_seed + i * 97)
        for i in range(agent_count)
    ]

    true_probs = {f"SIM{i + 1}": rng.uniform(0.25, 0.75) for i in range(market_count)}
    markets = [
        MarketSnapshot(
            market=f"SIM{i + 1}",
            market_id=i + 1,
            question=f"Simulated market {i + 1}",
            creator="sim",
            resolver="sim",
            yes_pool=initial_pool,
            no_pool=initial_pool,
            total_liquidity=2 * initial_pool,
            end_time=int(time.time()) + steps + 60,
        )
        for i in range(market_count)
    ]

    for step in range(steps):
        for m in markets:
            true_probs[m.market] = _clip(true_probs[m.market] + rng.gauss(0, 0.015), 0.05, 0.95)

        for agent in agents:
            agent.engine.update_history(markets)
            for market in markets:
                decision = agent.trade(cfg, market)
                if decision.side == SIDE_YES:
                    market.yes_pool += decision.size_lamports
                    market.total_liquidity += decision.size_lamports
                elif decision.side == SIDE_NO:
                    market.no_pool += decision.size_lamports
                    market.total_liquidity += decision.size_lamports

        if step % max(1, steps // 10) == 0:
            logging.info(
                "sim step=%d prices=%s",
                step,
                {m.market: round(m.implied_probability, 3) for m in markets},
            )

    outcomes = {
        m.market: SIDE_YES if rng.random() < true_probs[m.market] else SIDE_NO for m in markets
    }
    rows = []
    for agent in agents:
        payout = 0
        staked = 0
        for m in markets:
            pos = agent.positions.get(m.market, SimPosition())
            user_amount = pos.yes_amount if outcomes[m.market] == SIDE_YES else pos.no_amount
            winning_pool = m.yes_pool if outcomes[m.market] == SIDE_YES else m.no_pool
            staked += pos.yes_amount + pos.no_amount
            if winning_pool > 0 and user_amount > 0:
                payout += int(user_amount * m.total_liquidity / winning_pool)
        final_equity = agent.cash + payout
        initial_cash = int(cfg.simulation.get("initial_cash_lamports", 5 * LAMPORTS_PER_SOL))
        rows.append(
            {
                "agent": agent.name,
                "trades": agent.trades,
                "staked_sol": round(staked / LAMPORTS_PER_SOL, 4),
                "payout_sol": round(payout / LAMPORTS_PER_SOL, 4),
                "final_equity_sol": round(final_equity / LAMPORTS_PER_SOL, 4),
                "pnl_sol": round((final_equity - initial_cash) / LAMPORTS_PER_SOL, 4),
            }
        )

    logging.info("Simulation outcomes=%s true_probs=%s", outcomes, true_probs)
    print(pd.DataFrame(rows).sort_values("pnl_sol", ascending=False).to_string(index=False))


def decode_market_account(pubkey: str, raw: bytes) -> MarketSnapshot:
    offset = 8
    market_id, offset = _read_u64(raw, offset)
    question, offset = _read_string(raw, offset)
    creator, offset = _read_pubkey(raw, offset)
    resolver, offset = _read_pubkey(raw, offset)
    yes_pool, offset = _read_u64(raw, offset)
    no_pool, offset = _read_u64(raw, offset)
    total_liquidity, offset = _read_u64(raw, offset)
    end_time, offset = _read_i64(raw, offset)
    resolved = bool(raw[offset])
    offset += 1
    outcome = raw[offset]

    return MarketSnapshot(
        market=pubkey,
        market_id=market_id,
        question=question,
        creator=creator,
        resolver=resolver,
        yes_pool=yes_pool,
        no_pool=no_pool,
        total_liquidity=total_liquidity,
        end_time=end_time,
        resolved=resolved,
        outcome=outcome,
    )


def load_keypair(path: str | Path) -> Any:
    if Keypair is None:
        raise RuntimeError("solders is required to load a Solana keypair")
    with open(os.path.expanduser(str(path)), "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    if isinstance(raw, dict) and "secretKey" in raw:
        raw = raw["secretKey"]
    return Keypair.from_bytes(bytes(raw))


def _read_u64(raw: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from("<Q", raw, offset)[0], offset + 8


def _read_i64(raw: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from("<q", raw, offset)[0], offset + 8


def _read_string(raw: bytes, offset: int) -> tuple[str, int]:
    length = struct.unpack_from("<I", raw, offset)[0]
    offset += 4
    value = raw[offset : offset + length].decode("utf-8")
    return value, offset + length


def _read_pubkey(raw: bytes, offset: int) -> tuple[str, int]:
    data = raw[offset : offset + 32]
    if Pubkey is not None:
        return str(Pubkey.from_bytes(data)), offset + 32
    return data.hex(), offset + 32


def _decode_account_data(data: Any) -> bytes:
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    if isinstance(data, (list, tuple)):
        return base64.b64decode(data[0])
    if isinstance(data, str):
        return base64.b64decode(data)
    if hasattr(data, "data"):
        return _decode_account_data(data.data)
    raise TypeError(f"Unsupported account data shape: {type(data)!r}")


def _rpc_value(response: Any) -> Any:
    if hasattr(response, "value"):
        return response.value
    if isinstance(response, dict):
        return response.get("result")
    return response


def extract_blockhash(response: Any) -> Any:
    value = _rpc_value(response)
    if hasattr(value, "blockhash"):
        return value.blockhash
    if isinstance(value, dict):
        if "blockhash" in value:
            return value["blockhash"]
        if "value" in value and "blockhash" in value["value"]:
            return value["value"]["blockhash"]
    raise ValueError(f"Could not extract latest blockhash from response: {response!r}")


def _read_attr_or_key(obj: Any, key: str) -> Any:
    if hasattr(obj, key):
        return getattr(obj, key)
    if isinstance(obj, dict):
        return obj[key]
    raise KeyError(key)


def _pick(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return default


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_simple_yaml(text: str) -> dict[str, Any]:
    """Small fallback parser for this repo's simple nested config.yaml."""
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]

    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]

        if value == "":
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = parse_scalar(value)

    return root


def parse_scalar(value: str) -> Any:
    value = value.split(" #", 1)[0].strip()
    if value in {"null", "None", "~"}:
        return None
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ProbX Solana prediction-market trading agent")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--once", action="store_true", help="Run one live trading cycle")
    parser.add_argument("--loop", action="store_true", help="Run live trading cycles forever")
    parser.add_argument("--simulate", action="store_true", help="Run multi-agent simulation")
    parser.add_argument("--agents", type=int, default=None, help="Simulation agent count")
    parser.add_argument("--steps", type=int, default=None, help="Simulation step count")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run execution")
    parser.add_argument("--log-level", default="INFO", help="Python logging level")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    cfg = Config.from_yaml(args.config)
    if args.dry_run:
        cfg.dry_run = True

    if args.simulate:
        sim = cfg.simulation
        run_simulation(
            cfg,
            agent_count=args.agents or int(sim.get("agents", 5)),
            steps=args.steps or int(sim.get("steps", 100)),
        )
        return

    agent = TradingAgent(cfg)
    if args.loop:
        agent.run_forever()
    else:
        agent.run_once()


if __name__ == "__main__":
    main()
