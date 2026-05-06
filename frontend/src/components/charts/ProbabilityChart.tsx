"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { Market, Side } from "@/lib/types";

type Timeframe = "1H" | "24H" | "7D";

export function ProbabilityChart({
  market,
  compact = false,
  side = "BOTH",
  timeframe = "24H"
}: {
  market: Market;
  compact?: boolean;
  side?: Side | "BOTH";
  timeframe?: Timeframe;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const history = useMemo(() => sliceHistory(market.probabilityHistory, timeframe), [market.probabilityHistory, timeframe]);
  const yesSeries = history;
  const noSeries = history.map((p) => 1 - p);
  const primarySeries = side === "NO" ? noSeries : yesSeries;
  const secondarySeries = side === "NO" ? yesSeries : noSeries;
  const points = toPoints(primarySeries);
  const secondaryPoints = toPoints(secondarySeries);
  const primaryColor = side === "BOTH" ? "#b169ff" : side === "NO" ? "#ff4e5c" : "#19f58c";
  const secondaryColor = side === "BOTH" ? "#19f58c" : side === "NO" ? "#19f58c" : "#ff4e5c";
  const gradientColor = side === "BOTH" ? "#9b5cff" : side === "NO" ? "#ff4e5c" : "#19f58c";
  const hoverIndex = hoverX === null ? null : Math.min(primarySeries.length - 1, Math.max(0, Math.round((hoverX / 1000) * (primarySeries.length - 1))));
  const hoverValue = hoverIndex === null ? null : primarySeries[hoverIndex];
  const hoverY = hoverValue === null ? null : (1 - clamp(hoverValue)) * 260 + 25;
  const yesLatest = yesSeries[yesSeries.length - 1] ?? 0;
  const noLatest = 1 - yesLatest;
  const yesY = (1 - clamp(yesLatest)) * 260 + 25;
  const noY = (1 - clamp(noLatest)) * 260 + 25;

  return (
    <div className={compact ? "chart-card h-full min-h-[250px]" : "chart-card h-[420px]"}>
      <svg
        className="h-full w-full cursor-crosshair"
        viewBox="0 0 1000 320"
        preserveAspectRatio="none"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHoverX(((event.clientX - rect.left) / rect.width) * 1000);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <defs>
          <linearGradient id={`prob-fill-${market.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={gradientColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={gradientColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h-${i}`} x1="0" x2="1000" y1={30 + i * 52} y2={30 + i * 52} stroke="rgba(125,170,255,.11)" />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`v-${i}`} x1={i * 110} x2={i * 110} y1="0" y2="320" stroke="rgba(125,170,255,.08)" />
        ))}
        <line x1="0" x2="1000" y1="160" y2="160" stroke="rgba(235,245,255,.38)" strokeDasharray="8 8" />
        <path d={`M ${points.replaceAll(" ", " L ")} L 1000 320 L 0 320 Z`} fill={`url(#prob-fill-${market.id})`} />
        <polyline points={points} fill="none" stroke={primaryColor} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <polyline
          points={secondaryPoints}
          fill="none"
          stroke={secondaryColor}
          strokeOpacity={side === "BOTH" ? 0.9 : 0.34}
          strokeWidth={side === "BOTH" ? 2.4 : 1.8}
          vectorEffect="non-scaling-stroke"
        />
        {Array.from({ length: 58 }).map((_, i) => {
          const height = 10 + Math.sin(i * 1.7) * 9 + ((i * 17) % 29);
          return (
            <rect
              key={i}
              x={i * 17.4}
              y={310 - height}
              width="5"
              height={height}
              fill={i % 3 === 0 ? "rgba(155,92,255,.52)" : "rgba(25,245,140,.30)"}
            />
          );
        })}
        {hoverX !== null && hoverY !== null ? (
          <>
            <line x1={hoverX} x2={hoverX} y1="0" y2="320" stroke="rgba(235,245,255,.42)" strokeDasharray="6 6" />
            <circle cx={hoverX} cy={hoverY} r="5" fill={primaryColor} stroke="#030609" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      {hoverX !== null && hoverValue !== null ? (
        <div
          className="pointer-events-none absolute top-4 rounded-md border border-line bg-slate-950/95 px-3 py-2 text-xs shadow-glow"
          style={{ left: `min(calc(${hoverX / 10}% + 12px), calc(100% - 138px))` }}
        >
          <div className="font-black text-white">{side === "BOTH" ? "YES" : side} {formatPrice(hoverValue)}</div>
          <div className="mt-1 text-muted">{timeframe} sample #{(hoverIndex ?? 0) + 1}</div>
        </div>
      ) : null}
      {side === "BOTH" ? (
        <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded border border-solPurple/45 bg-solPurple/15 px-2 py-1 font-black text-violet-200">
            <i className="h-2 w-2 rounded-full bg-solPurple" /> YES {formatPrice(yesLatest)}
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-yes/35 bg-yes/10 px-2 py-1 font-black text-yes">
            <i className="h-2 w-2 rounded-full bg-yes" /> NO {formatPrice(noLatest)}
          </span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 grid gap-10 text-right text-xs text-muted">
        <span>100¢</span>
        <span>75¢</span>
        <span>50¢</span>
        <span>25¢</span>
        <span>0¢</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 right-16 flex justify-between text-xs text-muted">
        <span>00:00</span>
        <span>03:00</span>
        <span>06:00</span>
        <span>09:00</span>
        <span>12:00</span>
        <span>15:00</span>
        <span>18:00</span>
        <span>21:00</span>
      </div>
      {side === "BOTH" ? (
        <>
          <span
            className="pointer-events-none absolute right-3 rounded border border-solPurple/60 bg-solPurple/80 px-2 py-1 text-xs font-black text-white shadow-glow"
            style={{ top: `calc(${(yesY / 320) * 100}% - 12px)` }}
          >
            {formatPrice(yesLatest)}
          </span>
          <span
            className="pointer-events-none absolute right-3 rounded border border-yes/60 bg-yes/20 px-2 py-1 text-xs font-black text-yes shadow-yes"
            style={{ top: `calc(${(noY / 320) * 100}% - 12px)` }}
          >
            {formatPrice(noLatest)}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function PnLChart({ values }: { values: number[] }) {
  const normalized = normalize(values);
  return (
    <div className="chart-card h-72">
      <svg className="h-full w-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pnl-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#19f58c" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#19f58c" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M ${toPoints(normalized).replaceAll(" ", " L ")} L 1000 300 L 0 300 Z`} fill="url(#pnl-fill)" />
        <polyline points={toPoints(normalized)} fill="none" stroke="#19f58c" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function toPoints(values: number[]) {
  const count = Math.max(1, values.length - 1);
  return values
    .map((value, index) => `${(index / count) * 1000},${(1 - clamp(value)) * 260 + 25}`)
    .join(" ");
}

function normalize(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value) => (value - min) / range);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sliceHistory(values: number[], timeframe: Timeframe) {
  const size = timeframe === "1H" ? 24 : timeframe === "24H" ? 72 : 96;
  return values.slice(-size);
}
