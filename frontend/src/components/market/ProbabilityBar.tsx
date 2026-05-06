import { formatPercent } from "@/lib/format";

export function ProbabilityBar({ probability }: { probability: number }) {
  const yes = Math.round(probability * 100);
  const no = 100 - yes;

  return (
    <div className="h-5 overflow-hidden rounded bg-slate-950 ring-1 ring-white/10">
      <div className="flex h-full text-[11px] font-black text-white">
        <div
          className="grid min-w-8 place-items-center bg-gradient-to-r from-emerald-700 to-yes transition-all duration-500"
          style={{ width: `${yes}%` }}
        >
          {formatPercent(probability, 0)}
        </div>
        <div
          className="grid min-w-8 place-items-center bg-gradient-to-r from-no to-red-900 transition-all duration-500"
          style={{ width: `${no}%` }}
        >
          {formatPercent(1 - probability, 0)}
        </div>
      </div>
    </div>
  );
}
