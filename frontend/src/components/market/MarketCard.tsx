"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Clock3, Droplets, TrendingDown, TrendingUp } from "lucide-react";
import { formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import type { Market } from "@/lib/types";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";

export function MarketCard({ market }: { market: Market }) {
  const p = probability(market);
  const positive = market.change24h >= 0;
  const previous = useRef(p);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (Math.abs(previous.current - p) < 0.0001) return;
    previous.current = p;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 540);
    return () => window.clearTimeout(id);
  }, [p]);

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group grid gap-3 rounded-lg border border-line bg-slate-950/55 p-4 transition hover:border-solBlue/50 hover:bg-slate-900/70 hover:shadow-[0_0_26px_rgba(49,185,255,0.12)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <span className="rounded border border-solPurple/30 bg-solPurple/10 px-2 py-0.5 text-violet-200">
              {market.category}
            </span>
            <span>{timeRemaining(market.endTime)}</span>
          </div>
          <h3 className="line-clamp-2 text-base font-bold leading-snug text-white">{market.question}</h3>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-black text-yes ${flash ? "number-flash" : ""}`}>{formatPrice(p)}</div>
          <div className={`mt-1 flex items-center justify-end gap-1 text-xs ${positive ? "text-yes" : "text-no"}`}>
            {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {Math.abs(market.change24h * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <ProbabilityBar probability={p} />

      <div className="grid grid-cols-3 gap-3 text-xs text-slate-300">
        <div className="rounded border border-white/5 bg-white/[0.03] p-2">
          <div className="mb-1 flex items-center gap-1 text-muted">
            <Droplets size={12} /> Liquidity
          </div>
          <b>{formatSol(market.totalLiquidity, 0)}</b>
        </div>
        <div className="rounded border border-white/5 bg-white/[0.03] p-2">
          <div className="mb-1 text-muted">24h Volume</div>
          <b>${(market.volume24h / 1_000_000).toFixed(2)}M</b>
        </div>
        <div className="rounded border border-white/5 bg-white/[0.03] p-2">
          <div className="mb-1 flex items-center gap-1 text-muted">
            <Clock3 size={12} /> Participants
          </div>
          <b>{market.participants.toLocaleString()}</b>
        </div>
      </div>
    </Link>
  );
}
