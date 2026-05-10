"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, Wallet2 } from "lucide-react";
import { formatPercent, formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import { quoteBuyShares, quoteSellShares } from "@/lib/anchorClient";
import type { Market, Side } from "@/lib/types";
import { useMarkets } from "@/components/market/MarketProvider";

type TradeMode = "BUY" | "SELL";
type TradeTab = "TRADE" | "INFO";

export function TradePanel({ market }: { market: Market }) {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const { buy, sell, positions, isLoading, error, backendEnabled, dataSource, waitForTradeConfirmation } = useMarkets();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const [tab, setTab] = useState<TradeTab>("TRADE");
  const [mode, setMode] = useState<TradeMode>("BUY");
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("1.0");
  const [orderType, setOrderType] = useState("Market");
  const [slippage, setSlippage] = useState("0.5");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
  }, [market.id, mode, side]);

  useEffect(() => {
    if (!onchainEnabled || !connected || !publicKey) {
      setWalletBalance(null);
      setBalanceError(null);
      setBalanceLoading(false);
      return;
    }

    let cancelled = false;
    setBalanceLoading(true);
    setBalanceError(null);

    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) setWalletBalance(lamports / LAMPORTS_PER_SOL);
      })
      .catch(() => {
        if (!cancelled) {
          setWalletBalance(null);
          setBalanceError("Wallet balance unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, connection, onchainEnabled, publicKey, isSubmitting]);

  const availableShares = positions
    .filter((position) => position.marketId === market.id && position.side === side && !position.resolved)
    .reduce((total, position) => total + position.size, 0);
  const reserveSol = 0.002;
  const walletSpendable = walletBalance === null ? null : Math.max(0, walletBalance - reserveSol);
  const localBuyLimit = 24.25;
  const buyLimit = onchainEnabled && connected && walletSpendable !== null ? walletSpendable : localBuyLimit;
  const orderLimit = mode === "BUY" ? buyLimit : availableShares;
  const hasFiniteLimit = mode === "SELL" || (mode === "BUY" && onchainEnabled && connected && walletSpendable !== null) || (!backendEnabled && !onchainEnabled);
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

  const validationMessage = useMemo(() => {
    if (market.resolved && market.outcome === 2) return "This market is cancelled.";
    if (market.resolved) return "This market is resolved.";
    if (market.endTime <= Math.floor(Date.now() / 1000)) return "This market is closed.";
    if (backendEnabled && isLoading) return "Waiting for the ProbX API.";
    if (backendEnabled && error) return error;
    if (onchainEnabled && !connected) return "Connect a wallet to trade on-chain.";
    if (mode === "BUY" && onchainEnabled && connected && balanceLoading) return "Loading wallet balance.";
    if (mode === "BUY" && onchainEnabled && connected && balanceError) return balanceError;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return "Enter a valid amount.";
    if (mode === "SELL" && availableShares <= 0) return `No ${side} shares available to sell.`;
    if (hasFiniteLimit && amountNumber > orderLimit + 1e-9) {
      return mode === "BUY" ? "Amount exceeds available SOL." : "Amount exceeds available shares.";
    }
    return null;
  }, [amountNumber, availableShares, backendEnabled, balanceError, balanceLoading, connected, error, hasFiniteLimit, isLoading, market.endTime, market.outcome, market.resolved, mode, onchainEnabled, orderLimit, side]);

  const percentUsed = hasFiniteLimit && orderLimit > 0 ? Math.max(0, Math.min(100, (amountNumber / orderLimit) * 100 || 0)) : 0;
  const successStatus = status ? status.includes("updated") || status.includes("API") || status.includes("Tx") || status.includes("saved") : false;
  const primaryButtonLabel = isSubmitting
    ? connected && onchainEnabled
      ? "Signing..."
      : "Submitting..."
    : connected && onchainEnabled
      ? `${mode} ${side}`
      : backendEnabled
        ? `Record ${mode} ${side}`
        : `Preview ${mode} ${side}`;
  const balanceLabel =
    mode === "BUY"
      ? onchainEnabled && connected
        ? balanceLoading
          ? "Wallet balance: loading"
          : walletBalance === null
            ? "Wallet balance unavailable"
            : `Wallet balance: ${formatSol(walletBalance, 4)}`
        : backendEnabled
          ? "API order amount"
          : `Preview limit: ${formatSol(orderLimit, 3)}`
      : `Available: ${orderLimit.toFixed(3)} ${side} shares`;

  function setPercent(percent: number) {
    if (!hasFiniteLimit) return;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    setStatus(null);
    setAmount((orderLimit * clampedPercent).toFixed(clampedPercent === 1 ? 2 : 3));
  }

  function updateAmount(nextValue: string) {
    if (/^\d*\.?\d*$/.test(nextValue)) {
      setStatus(null);
      setAmount(nextValue);
    }
  }

  async function submit() {
    setStatus(null);
    if (validationMessage) {
      setStatus(validationMessage);
      return;
    }
    setIsSubmitting(true);
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const signature =
        mode === "BUY"
          ? await buy(market.id, side, amountNumber, { slippageBps })
          : await sell(market.id, side, amountNumber, { slippageBps });
      if (signature !== "local" && signature !== "indexed") {
        setStatus(`Tx sent: ${signature.slice(0, 12)}... waiting for indexer`);
        const confirmation = await waitForTradeConfirmation(signature, { marketId: market.id });
        if (confirmation === "confirmed") {
          setStatus(`Tx confirmed and indexed: ${signature.slice(0, 12)}...`);
          return;
        }
        if (confirmation === "sent") {
          setStatus(`Tx saved, waiting for indexer: ${signature.slice(0, 12)}...`);
          return;
        }
        if (confirmation === "timeout") {
          setStatus(`Tx sent: ${signature.slice(0, 12)}... indexer still catching up`);
          return;
        }
      }
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
    <aside className="terminal-panel flex h-full min-h-0 flex-col overflow-hidden p-2.5">
      <div className="mb-2 flex items-center border-b border-line pb-1.5 text-sm">
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

      <div className="grid min-h-0 flex-1 content-start">
        {tab === "TRADE" ? (
          <div className="grid content-start">
            <div className="mb-2 flex items-center justify-between rounded-lg border border-line bg-black/25 px-3 py-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              {validationMessage ? <AlertTriangle size={13} className="text-no" /> : <CheckCircle2 size={13} className="text-yes" />}
              {dataSource === "api" ? "ProbX API" : "Local preview"}
            </span>
            <span className={onchainEnabled ? (connected ? "text-yes" : "text-no") : "text-muted"}>
              {onchainEnabled ? (connected ? "Wallet connected" : "Wallet required") : "Off-chain indexing"}
            </span>
            </div>

          <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-line bg-black/25 p-1">
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

          <div className="mb-2 grid grid-cols-2 gap-2">
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

          <label className="mb-1.5 block text-xs font-semibold text-slate-300">
            {mode === "BUY" ? "Amount" : "Shares"}
          </label>
          <div className="mb-1 flex h-10 items-center rounded-lg border border-line bg-black/35 px-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-300">
              {mode === "BUY" ? <Wallet2 size={15} className="text-solPurple" /> : null}
              {mode === "BUY" ? "SOL" : side}
            </span>
            <input
              value={amount}
              onChange={(event) => updateAmount(event.target.value)}
              placeholder="0.00"
              className="h-full flex-1 bg-transparent text-right text-lg font-bold outline-none"
              inputMode="decimal"
            />
          </div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>{balanceLabel}</span>
          </div>

          {hasFiniteLimit ? (
            <>
              <div className="mb-2 grid grid-cols-4 gap-1.5">
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
                value={percentUsed}
                onChange={(event) => setPercent(Number(event.target.value) / 100)}
                type="range"
                min="0"
                max="100"
                className="mb-2 w-full accent-emerald-400"
              />
            </>
          ) : null}

          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-muted">
              Order Type
              <span className="relative">
                <select
                  value={orderType}
                  onChange={(event) => setOrderType(event.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-xs font-bold text-slate-100 outline-none"
                >
                  <option>Market</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-muted" />
              </span>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Slippage
              <span className="relative">
                <select
                  value={slippage}
                  onChange={(event) => setSlippage(event.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-xs font-bold text-slate-100 outline-none"
                >
                  <option value="0.1">0.1%</option>
                  <option value="0.5">0.5%</option>
                  <option value="1.0">1.0%</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-muted" />
              </span>
            </label>
          </div>

          <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/25 p-2.5">
            <QuoteItem
              label={mode === "BUY" ? "Order Amount" : "Shares Sold"}
              value={mode === "BUY" ? formatSol(amountNumber || 0, 4) : `${amountNumber.toFixed(3)} ${side}`}
              strong
            />
            <QuoteItem label="Est. Fill Price" value={formatPrice(p)} />
            <QuoteItem label={mode === "BUY" ? "Shares Received" : "Shares Sold"} value={shares.toFixed(3)} />
            <QuoteItem label={mode === "BUY" ? "Potential Return" : "Est. Proceeds"} value={formatSol(mode === "BUY" ? shares : proceeds)} />
            <QuoteItem label="Price Impact" value={`${impact.toFixed(2)}%`} />
            <QuoteItem label="Max Slippage" value={`${slippage}%`} />
            <QuoteItem label="Protocol Fee" value={formatSol(fee, 4)} />
            <QuoteItem label={mode === "BUY" ? "Est. Total" : "SOL Out"} value={formatSol(expectedTotal, 4)} strong />
          </div>

          <button
            disabled={isSubmitting || Boolean(validationMessage)}
            onClick={submit}
            className={side === "YES" ? "primary-action yes" : "primary-action no"}
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : null}
            {primaryButtonLabel}
          </button>
          {status || validationMessage ? (
            <p className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs ${
              successStatus ? "border-yes/30 bg-yes/10 text-yes" : "border-no/30 bg-no/10 text-no"
            }`}>
              {successStatus ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
              <span>{status ?? validationMessage}</span>
            </p>
          ) : null}
          </div>
        ) : (
          <MarketInfo market={market} />
        )}
      </div>
    </aside>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-muted">{label}</span>
      <b className={`shrink-0 text-right ${strong ? "text-base text-white" : "text-slate-100"}`}>{value}</b>
    </div>
  );
}

function QuoteItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-black/20 px-2 py-1.5">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-right text-xs font-black ${strong ? "text-white" : "text-slate-200"}`}>{value}</div>
    </div>
  );
}

function MarketInfo({ market }: { market: Market }) {
  const yesProbability = probability(market);
  const liquidity = market.totalLiquidity;
  const imbalance = Math.abs(market.yesPool - market.noPool) / Math.max(1, market.yesPool + market.noPool);

  return (
    <div className="grid content-start gap-3">
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
          <CodeRow label="Resolver" value={market.resolver} />
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
