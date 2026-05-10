"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Star, TrendingDown, TrendingUp } from "lucide-react";
import { formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import type { Market } from "@/lib/types";
import { marketAvatarMode, marketAvatarUrl } from "@/lib/marketAvatars";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { RouterLink as Link } from "@/router";

export function MarketCard({ market }: { market: Market }) {
  const p = probability(market);
  const isCancelled = Boolean(market.resolved && market.outcome === 2);
  const positive = market.change24h >= 0;
  const no = 1 - p;
  const sparkPoints = toSparkPoints(market.probabilityHistory);
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
      className="market-tile group grid gap-2 rounded-lg border border-line px-2.5 py-2 transition hover:border-solBlue/50 hover:bg-slate-900/70 hover:shadow-[0_0_26px_rgba(49,185,255,0.12)]"
    >
      <div className="relative z-[1] flex items-start gap-2.5">
        <MarketVisual market={market} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-black leading-snug text-white">{market.question}</h3>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span>{market.category}</span>
                <span>/</span>
                <span>{isCancelled ? "Void" : marketSubtitle(market)}</span>
              </div>
            </div>
            <div className="grid shrink-0 justify-items-end gap-1">
              <Star size={14} className="text-muted transition group-hover:text-violet-200" />
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-black/25 px-2 py-0.5 text-[10px] text-muted">
                <Clock3 size={10} /> {isCancelled ? "Cancelled" : timeRemaining(market.endTime)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[66px_1fr_66px] items-end gap-2">
            <div>
              <div className="text-[11px] font-black text-yes">YES</div>
              <div className={`text-base font-black text-yes ${flash ? "number-flash" : ""}`}>{formatPrice(p)}</div>
            </div>
            <div className="min-w-0">
              <svg className="sparkline" viewBox="0 0 64 26" preserveAspectRatio="none">
                <polyline points={sparkPoints} fill="none" stroke={positive ? "#19f58c" : "#ff4e5c"} strokeWidth="1.4" />
              </svg>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-black text-no">NO</div>
              <div className="text-base font-black text-no">{formatPrice(no)}</div>
            </div>
          </div>

          <ProbabilityBar probability={p} />

          <div className="mt-1.5 grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] text-muted">
            <span>Vol ${(market.volume24h / 1_000_000).toFixed(2)}M</span>
            <span>Liq {formatSol(market.totalLiquidity, 0)}</span>
            <span>OI ${((market.yesPool + market.noPool) / 1000).toFixed(2)}M</span>
            <span className={positive ? "text-yes" : "text-no"}>
              {positive ? <TrendingUp className="inline" size={11} /> : <TrendingDown className="inline" size={11} />} {Math.abs(market.change24h * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function MarketVisual({ market }: { market: Market }) {
  const variant = marketVisualVariant(market);
  const avatarUrl = marketAvatarUrl(market);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  if (avatarUrl && !imageFailed) {
    return (
      <div className={`market-avatar custom ${marketAvatarMode(market)}`} aria-hidden="true">
        <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      </div>
    );
  }

  return (
    <div className={`market-avatar ${variant}`} aria-hidden="true">
      {variant === "fed" ? (
        <span className="fed-building">
          <span className="fed-dome" />
          <span className="fed-roof" />
          <span className="fed-columns">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="fed-base" />
        </span>
      ) : null}
      {variant === "bitcoin" ? (
        <span className="coin-mark">
          <b>B</b>
        </span>
      ) : null}
      {variant === "trump" ? (
        <span className="portrait-mark">
          <span className="flag-stripes" />
          <span className="portrait-head">T</span>
        </span>
      ) : null}
      {variant === "solana" ? (
        <span className="solana-bars">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {variant === "sports" ? (
        <span className="sports-mark">
          <i />
          <b>NBA</b>
        </span>
      ) : null}
      {variant === "on-chain" ? (
        <span className="chip-mark">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {variant === "nvidia" ? (
        <span className="nvidia-mark">
          <i />
          <b>N</b>
        </span>
      ) : null}
    </div>
  );
}

function toSparkPoints(values: number[]) {
  const source = values.slice(-22);
  const count = Math.max(1, source.length - 1);
  return source
    .map((value, index) => `${(index / count) * 64},${(1 - value) * 22 + 2}`)
    .join(" ");
}

function marketSubtitle(market: Market) {
  if (market.id === "fed-rates") return "Federal Reserve";
  if (market.id === "btc-100k") return "Price";
  if (market.id === "sol-etf") return "ETF";
  if (market.id === "trump-approval") return "Approval";
  if (market.id === "nba-finals") return "NBA";
  if (market.id === "nvidia-earnings") return "Earnings";
  return "Prediction";
}

function marketVisualVariant(market: Market) {
  if (market.id === "fed-rates") return "fed";
  if (market.id.includes("btc")) return "bitcoin";
  if (market.id === "trump-approval") return "trump";
  if (market.id === "sol-etf") return "solana";
  if (market.id === "nvidia-earnings") return "nvidia";
  if (market.category === "Sports") return "sports";
  if (market.category === "On-chain") return "on-chain";
  return market.category.toLowerCase();
}
