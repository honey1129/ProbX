"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatPrice, formatSol, probability } from "@/lib/format";
import type { Market, Side } from "@/lib/types";
import { useMarkets } from "@/components/market/MarketProvider";

export function TradePanel({ market }: { market: Market }) {
  const { connected } = useWallet();
  const { buy } = useMarkets();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("1.0");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const p = side === "YES" ? probability(market) : 1 - probability(market);
  const amountNumber = Number(amount || 0);
  const shares = p > 0 ? amountNumber / p : 0;

  async function submit() {
    setStatus(null);
    setIsSubmitting(true);
    try {
      const signature = await buy(market.id, side, amountNumber);
      setStatus(signature === "simulated" ? "Simulated trade executed" : `Tx sent: ${signature.slice(0, 12)}...`);
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
        {["25%", "50%", "75%", "MAX"].map((label) => (
          <button key={label} className="rounded border border-line bg-slate-950/70 py-1.5 text-xs text-slate-300 hover:border-solBlue/50">
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
        <Row label="Est. Fill Price" value={formatPrice(p)} />
        <Row label="Shares Received" value={shares.toFixed(3)} />
        <Row label="Potential Return" value={formatSol(shares)} />
        <Row label="Fee" value={formatSol(amountNumber * 0.001, 4)} />
      </div>

      <button
        disabled={isSubmitting || amountNumber <= 0}
        onClick={submit}
        className={side === "YES" ? "primary-action yes" : "primary-action no"}
      >
        {isSubmitting ? "Signing..." : connected && onchainEnabled ? `Buy ${side}` : `Simulate ${side}`}
      </button>
      {status ? <p className="mt-3 text-xs text-muted">{status}</p> : null}
      <p className="mt-3 text-xs text-muted">
        Set <code>NEXT_PUBLIC_ENABLE_ONCHAIN=true</code> to sign Anchor <code>place_bet</code> transactions. Otherwise the terminal runs in simulation mode.
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
