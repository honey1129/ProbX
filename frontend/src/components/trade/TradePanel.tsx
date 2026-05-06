"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ChevronDown } from "lucide-react";
import { formatPrice, formatSol, probability } from "@/lib/format";
import { quoteBuyShares } from "@/lib/anchorClient";
import type { Market, Side } from "@/lib/types";
import { useMarkets } from "@/components/market/MarketProvider";

export function TradePanel({ market }: { market: Market }) {
  const { connected } = useWallet();
  const { buy } = useMarkets();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("1.0");
  const [orderType, setOrderType] = useState("Market");
  const [slippage, setSlippage] = useState("0.5");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mockBalance = 24.25;
  const p = side === "YES" ? probability(market) : 1 - probability(market);
  const amountNumber = Number(amount || 0);
  const quote = useMemo(() => quoteBuyShares(market, side, amountNumber), [amountNumber, market, side]);
  const shares = Number(quote.sharesOut.toString()) / LAMPORTS_PER_SOL;
  const fee = 0;
  const expectedTotal = amountNumber + fee;
  const impact = useMemo(() => {
    const nextTotal = quote.nextYesPool + quote.nextNoPool;
    if (!amountNumber || nextTotal <= 0) return 0;
    const nextYesProbability = quote.nextYesPool / nextTotal;
    const nextProbability = side === "YES" ? nextYesProbability : 1 - nextYesProbability;
    return Math.abs(nextProbability - p) * 100;
  }, [amountNumber, p, quote.nextNoPool, quote.nextYesPool, side]);

  function setPercent(percent: number) {
    const clampedPercent = Math.max(0, Math.min(1, percent));
    setAmount((mockBalance * clampedPercent).toFixed(clampedPercent === 1 ? 2 : 3));
  }

  async function submit() {
    setStatus(null);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setStatus("Enter a valid SOL amount.");
      return;
    }
    if (amountNumber > mockBalance) {
      setStatus("Amount exceeds simulated wallet balance.");
      return;
    }
    setIsSubmitting(true);
    try {
      const signature = await buy(market.id, side, amountNumber, {
        slippageBps: Math.round(Number(slippage) * 100)
      });
      setStatus(
        signature === "simulated"
          ? "Simulated AMM trade executed"
          : signature === "indexed"
            ? "Trade saved to backend"
            : `Tx sent: ${signature.slice(0, 12)}...`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <aside className="rounded-lg border border-line bg-panel p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide("YES")}
          className={`trade-side yes ${side === "YES" ? "active" : ""}`}
        >
          Buy YES
          <span>{formatPrice(probability(market))}</span>
        </button>
        <button
          onClick={() => setSide("NO")}
          className={`trade-side no ${side === "NO" ? "active" : ""}`}
        >
          Buy NO
          <span>{formatPrice(1 - probability(market))}</span>
        </button>
      </div>

      <label className="mb-2 block text-xs font-semibold text-slate-300">Amount</label>
      <div className="mb-3 flex h-12 items-center rounded-lg border border-line bg-black/35 px-3">
        <span className="text-sm font-bold text-slate-300">SOL</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="h-full flex-1 bg-transparent text-right text-xl font-bold outline-none"
          inputMode="decimal"
        />
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
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
        value={Math.max(0, Math.min(100, (amountNumber / mockBalance) * 100 || 0))}
        onChange={(event) => setPercent(Number(event.target.value) / 100)}
        type="range"
        min="0"
        max="100"
        className="mb-4 w-full accent-emerald-400"
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Order Type
          <span className="relative">
            <select
              value={orderType}
              onChange={(event) => setOrderType(event.target.value)}
              className="h-10 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
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
              className="h-10 w-full appearance-none rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
            >
              <option value="0.1">0.1%</option>
              <option value="0.5">0.5%</option>
              <option value="1.0">1.0%</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-muted" />
          </span>
        </label>
      </div>

      <div className="mb-4 grid gap-2 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
        <Row label="Balance" value={formatSol(mockBalance, 2)} />
        <Row label="Order Type" value={orderType} />
        <Row label="Max Slippage" value={`${slippage}%`} />
        <Row label="Est. Fill Price" value={formatPrice(p)} />
        <Row label="Shares Received" value={shares.toFixed(3)} />
        <Row label="Potential Return" value={formatSol(shares)} />
        <Row label="Price Impact" value={`${impact.toFixed(2)}%`} />
        <Row label="Protocol Fee" value={formatSol(fee, 4)} />
        <Row label="Est. Total" value={formatSol(expectedTotal, 4)} />
      </div>

      <button
        disabled={isSubmitting || amountNumber <= 0}
        onClick={submit}
        className={side === "YES" ? "primary-action yes" : "primary-action no"}
      >
        {isSubmitting ? "Signing..." : connected && onchainEnabled ? `Buy ${side}` : `Simulate ${side}`}
      </button>
      {status ? (
        <p className={`mt-3 rounded-md border px-3 py-2 text-xs ${status.includes("executed") || status.includes("Tx") ? "border-yes/30 bg-yes/10 text-yes" : "border-no/30 bg-no/10 text-no"}`}>
          {status}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Set <code>NEXT_PUBLIC_ENABLE_ONCHAIN=true</code> to sign Anchor <code>buy_shares</code> transactions. Otherwise the terminal runs in simulation mode.
      </p>
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
