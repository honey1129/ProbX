"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ChevronDown, Wallet2 } from "lucide-react";
import { formatPercent, formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import { quoteBuyShares, quoteSellShares } from "@/lib/anchorClient";
import type { Market, Side } from "@/lib/types";
import { useMarkets } from "@/components/market/MarketProvider";

type TradeMode = "BUY" | "SELL";
type TradeTab = "TRADE" | "INFO";

export function TradePanel({ market }: { market: Market }) {
  const { connected } = useWallet();
  const { buy, sell, positions, isLoading, error, backendEnabled, dataSource } = useMarkets();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const [tab, setTab] = useState<TradeTab>("TRADE");
  const [mode, setMode] = useState<TradeMode>("BUY");
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("1.0");
  const [orderType, setOrderType] = useState("Market");
  const [slippage, setSlippage] = useState("0.5");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableShares = positions
    .filter((position) => position.marketId === market.id && position.side === side && !position.resolved)
    .reduce((total, position) => total + position.size, 0);
  const localBuyLimit = 24.25;
  const orderLimit = mode === "BUY" ? localBuyLimit : availableShares;
  const hasFiniteLimit = mode === "SELL" || !backendEnabled;
  const p = side === "YES" ? probability(market) : 1 - probability(market);
  const amountNumber = Number(amount || 0);
  const buyQuote = useMemo(() => quoteBuyShares(market, side, amountNumber), [amountNumber, market, side]);
  const sellQuote = useMemo(() => quoteSellShares(market, side, amountNumber), [amountNumber, market, side]);
  const nextYesPool = mode === "BUY" ? buyQuote.nextYesPool : sellQuote.nextYesPool;
  const nextNoPool = mode === "BUY" ? buyQuote.nextNoPool : sellQuote.nextNoPool;
  const shares = mode === "BUY" ? Number(buyQuote.sharesOut.toString()) / LAMPORTS_PER_SOL : amountNumber;
  const proceeds = mode === "SELL" ? Number(sellQuote.lamportsOut.toString()) / LAMPORTS_PER_SOL : 0;
  const fee = 0;
  const expectedTotal = mode === "BUY" ? amountNumber + fee : proceeds;
  const impact = useMemo(() => {
    const nextTotal = nextYesPool + nextNoPool;
    if (!amountNumber || nextTotal <= 0) return 0;
    const nextYesProbability = nextYesPool / nextTotal;
    const nextProbability = side === "YES" ? nextYesProbability : 1 - nextYesProbability;
    return Math.abs(nextProbability - p) * 100;
  }, [amountNumber, nextNoPool, nextYesPool, p, side]);

  function setPercent(percent: number) {
    if (!hasFiniteLimit) return;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    setAmount((orderLimit * clampedPercent).toFixed(clampedPercent === 1 ? 2 : 3));
  }

  async function submit() {
    setStatus(null);
    if (backendEnabled && error) {
      setStatus(error);
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setStatus("Enter a valid SOL amount.");
      return;
    }
    if (hasFiniteLimit && amountNumber > orderLimit) {
      setStatus(mode === "BUY" ? "Amount exceeds the local preview order limit." : "Amount exceeds available shares.");
      return;
    }
    setIsSubmitting(true);
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const signature =
        mode === "BUY"
          ? await buy(market.id, side, amountNumber, { slippageBps })
          : await sell(market.id, side, amountNumber, { slippageBps });
      setStatus(
        signature === "local"
          ? "Local preview trade updated"
          : signature === "indexed"
            ? "Trade saved to ProbX API"
            : `Tx sent: ${signature.slice(0, 12)}...`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <aside className="terminal-panel flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-3 flex items-center border-b border-line pb-2 text-sm">
        <button
          onClick={() => setTab("TRADE")}
          className={`flex-1 border-b-2 pb-2 font-black transition ${
            tab === "TRADE" ? "border-solPurple text-violet-200" : "border-transparent text-muted hover:text-white"
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setTab("INFO")}
          className={`flex-1 border-b-2 pb-2 font-bold transition ${
            tab === "INFO" ? "border-solPurple text-violet-200" : "border-transparent text-muted hover:text-white"
          }`}
        >
          Market Info
        </button>
      </div>

      {tab === "TRADE" ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-black/25 p-1">
            {(["BUY", "SELL"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`rounded-md py-2 text-xs font-black transition ${
                  mode === item ? "bg-solBlue/20 text-white" : "text-muted hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide("YES")}
              className={`trade-side yes ${side === "YES" ? "active" : ""}`}
            >
              {mode === "BUY" ? "Buy" : "Sell"} YES
              <span>{formatPrice(probability(market))}</span>
            </button>
            <button
              onClick={() => setSide("NO")}
              className={`trade-side no ${side === "NO" ? "active" : ""}`}
            >
              {mode === "BUY" ? "Buy" : "Sell"} NO
              <span>{formatPrice(1 - probability(market))}</span>
            </button>
          </div>

          <label className="mb-2 block text-xs font-semibold text-slate-300">
            {mode === "BUY" ? "Amount" : "Shares"}
          </label>
          <div className="mb-1.5 flex h-11 items-center rounded-lg border border-line bg-black/35 px-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-300">
              {mode === "BUY" ? <Wallet2 size={15} className="text-solPurple" /> : null}
              {mode === "BUY" ? "SOL" : side}
              <ChevronDown size={13} className="text-muted" />
            </span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-full flex-1 bg-transparent text-right text-xl font-bold outline-none"
              inputMode="decimal"
            />
          </div>
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span>
              {mode === "BUY"
                ? backendEnabled
                  ? "API will record the submitted amount"
                  : `Preview limit: ${formatSol(orderLimit, 3)}`
                : `Available: ${orderLimit.toFixed(3)} shares`}
            </span>
            {hasFiniteLimit ? (
              <button onClick={() => setPercent(1)} className="rounded border border-line bg-black/25 px-2 py-0.5 text-slate-300 transition hover:border-solBlue/40 hover:text-white">
                MAX
              </button>
            ) : null}
          </div>

          {hasFiniteLimit ? (
            <>
              <div className="mb-3 grid grid-cols-4 gap-1.5">
                {[
                  ["25%", 0.25],
                  ["50%", 0.5],
                  ["75%", 0.75],
                  ["MAX", 1]
                ].map(([label, percent]) => (
                  <button
                    key={label}
                    onClick={() => setPercent(Number(percent))}
                    className="rounded border border-line bg-slate-950/70 py-1.5 text-xs text-slate-300 transition hover:border-solBlue/50 hover:text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <input
                value={Math.max(0, Math.min(100, (amountNumber / orderLimit) * 100 || 0))}
                onChange={(event) => setPercent(Number(event.target.value) / 100)}
                type="range"
                min="0"
                max="100"
                className="mb-4 w-full accent-emerald-400"
              />
            </>
          ) : null}

          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-muted">
              Order Type
              <span className="relative">
                <select
                  value={orderType}
                  onChange={(event) => setOrderType(event.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
                >
                  <option>Market</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-muted" />
              </span>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Slippage
              <span className="relative">
                <select
                  value={slippage}
                  onChange={(event) => setSlippage(event.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
                >
                  <option value="0.1">0.1%</option>
                  <option value="0.5">0.5%</option>
                  <option value="1.0">1.0%</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-muted" />
              </span>
            </label>
          </div>

          <div className="mb-3 grid gap-2 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
            <Row
              label={mode === "BUY" ? (backendEnabled ? "API Amount" : "Preview Limit") : "Available Shares"}
              value={mode === "BUY" ? (backendEnabled ? formatSol(amountNumber || 0, 4) : formatSol(orderLimit, 3)) : `${orderLimit.toFixed(3)} ${side}`}
            />
            <Row label="Order Type" value={orderType} />
            <Row label="Max Slippage" value={`${slippage}%`} />
            <Row label="Est. Fill Price" value={formatPrice(p)} />
            <Row label={mode === "BUY" ? "Shares Received" : "Shares Sold"} value={shares.toFixed(3)} />
            <Row label={mode === "BUY" ? "Potential Return" : "Est. Proceeds"} value={formatSol(mode === "BUY" ? shares : proceeds)} />
            <Row label="Price Impact" value={`${impact.toFixed(2)}%`} />
            <Row label="Protocol Fee" value={formatSol(fee, 4)} />
            <Row label={mode === "BUY" ? "Est. Total" : "SOL Out"} value={formatSol(expectedTotal, 4)} />
          </div>

          <button
            disabled={isSubmitting || amountNumber <= 0 || (backendEnabled && isLoading)}
            onClick={submit}
            className={side === "YES" ? "primary-action yes" : "primary-action no"}
          >
            {isSubmitting ? (connected && onchainEnabled ? "Signing..." : "Submitting...") : connected && onchainEnabled ? `${mode} ${side}` : backendEnabled ? `Record ${mode} ${side}` : `Preview ${mode} ${side}`}
          </button>
          {status ? (
            <p className={`mt-3 rounded-md border px-3 py-2 text-xs ${status.includes("updated") || status.includes("API") || status.includes("Tx") ? "border-yes/30 bg-yes/10 text-yes" : "border-no/30 bg-no/10 text-no"}`}>
              {status}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-black/25 px-3 py-2 text-xs text-muted">
            <span>{dataSource === "api" ? "ProbX API" : "Local preview"}</span>
            <span className={backendEnabled || onchainEnabled ? "flex items-center gap-1 text-yes" : "flex items-center gap-1 text-muted"}>
              <span className={backendEnabled || onchainEnabled ? "h-1.5 w-1.5 rounded-full bg-yes" : "h-1.5 w-1.5 rounded-full bg-muted"} />
              {onchainEnabled ? "On-chain enabled" : backendEnabled ? "Indexed" : "Preview"}
            </span>
          </div>
        </>
      ) : (
        <MarketInfo market={market} />
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <b className="text-slate-100">{value}</b>
    </div>
  );
}

function MarketInfo({ market }: { market: Market }) {
  const yesProbability = probability(market);
  const liquidity = market.totalLiquidity;
  const imbalance = Math.abs(market.yesPool - market.noPool) / Math.max(1, market.yesPool + market.noPool);

  return (
    <div className="grid min-h-0 flex-1 content-start gap-3 overflow-hidden">
      <div className="rounded-lg border border-line bg-black/25 p-3">
        <div className="mb-2 text-xs uppercase text-muted">Current Odds</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-yes/25 bg-yes/10 p-3">
            <div className="text-xs text-yes">YES</div>
            <div className="mt-1 text-2xl font-black text-yes">{formatPrice(yesProbability)}</div>
          </div>
          <div className="rounded-lg border border-no/25 bg-no/10 p-3">
            <div className="text-xs text-no">NO</div>
            <div className="mt-1 text-2xl font-black text-no">{formatPrice(1 - yesProbability)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-line bg-black/25 p-3 text-sm">
        <Row label="Category" value={market.category} />
        <Row label="Chance" value={formatPercent(yesProbability, 0)} />
        <Row label="24h Volume" value={`$${(market.volume24h / 1_000_000).toFixed(2)}M`} />
        <Row label="Liquidity" value={formatSol(liquidity)} />
        <Row label="Participants" value={market.participants.toLocaleString()} />
        <Row label="Pool Imbalance" value={formatPercent(imbalance, 1)} />
        <Row label="Closes In" value={timeRemaining(market.endTime)} />
      </div>

      <div className="rounded-lg border border-line bg-black/25 p-3">
        <div className="mb-2 text-xs uppercase text-muted">Contract</div>
        <div className="grid gap-2 text-xs">
          <CodeRow label="Market" value={market.publicKey} />
          <CodeRow label="Creator" value={market.creator} />
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between rounded-lg border border-line bg-black/25 px-3 py-2 text-xs text-muted">
        <span>AMM market</span>
        <span className="flex items-center gap-1 text-yes"><span className="h-1.5 w-1.5 rounded-full bg-yes" /> Synced</span>
      </div>
    </div>
  );
}

function CodeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-muted">{label}</span>
      <code className="truncate rounded border border-line bg-slate-950/70 px-2 py-1 text-[11px] text-slate-200">{shortAddress(value)}</code>
    </div>
  );
}

function shortAddress(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
