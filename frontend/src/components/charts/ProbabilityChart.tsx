import type { Market } from "@/lib/types";

export function ProbabilityChart({ market, compact = false }: { market: Market; compact?: boolean }) {
  const points = toPoints(market.probabilityHistory);
  const noPoints = toPoints(market.probabilityHistory.map((p) => 1 - p));

  return (
    <div className={compact ? "chart-card h-56" : "chart-card h-[420px]"}>
      <svg className="h-full w-full" viewBox="0 0 1000 320" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`prob-fill-${market.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9b5cff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9b5cff" stopOpacity="0" />
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
        <polyline points={points} fill="none" stroke="#b169ff" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <polyline points={noPoints} fill="none" stroke="#19f58c" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
        {Array.from({ length: 58 }).map((_, i) => {
          const height = 10 + Math.sin(i * 1.7) * 9 + ((i * 17) % 29);
          return (
            <rect
              key={i}
              x={i * 17.4}
              y={310 - height}
              width="5"
              height={height}
              fill={i % 3 === 0 ? "rgba(155,92,255,.48)" : "rgba(25,245,140,.28)"}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute right-3 top-3 grid gap-10 text-right text-xs text-muted">
        <span>100¢</span>
        <span>75¢</span>
        <span>50¢</span>
        <span>25¢</span>
        <span>0¢</span>
      </div>
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
