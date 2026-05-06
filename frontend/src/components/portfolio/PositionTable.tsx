import Link from "next/link";
import { formatPercent } from "@/lib/format";
import type { Market, Position } from "@/lib/types";

export function PositionTable({ positions, markets }: { positions: Position[]; markets: Market[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-950/80 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3 text-left">Market</th>
            <th className="px-4 py-3 text-left">Side</th>
            <th className="px-4 py-3 text-right">Size</th>
            <th className="px-4 py-3 text-right">Entry</th>
            <th className="px-4 py-3 text-right">Current</th>
            <th className="px-4 py-3 text-right">PnL</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => {
            const market = markets.find((item) => item.id === position.marketId);
            const pnlClass = position.pnl >= 0 ? "text-yes" : "text-no";
            return (
              <tr key={position.id} className="border-t border-line bg-slate-950/35 transition hover:bg-slate-900/60">
                <td className="max-w-[460px] px-4 py-3">
                  <Link href={`/markets/${position.marketId}`} className="font-semibold text-white hover:text-solBlue">
                    {market?.question ?? position.marketId}
                  </Link>
                </td>
                <td className={position.side === "YES" ? "px-4 py-3 font-black text-yes" : "px-4 py-3 font-black text-no"}>
                  {position.side}
                </td>
                <td className="px-4 py-3 text-right">{position.size.toFixed(2)} SOL</td>
                <td className="px-4 py-3 text-right">{formatPercent(position.entryProbability)}</td>
                <td className="px-4 py-3 text-right">{formatPercent(position.currentProbability)}</td>
                <td className={`px-4 py-3 text-right font-bold ${pnlClass}`}>
                  {position.pnl >= 0 ? "+" : "-"}${Math.abs(position.pnl).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">
                  {position.resolved ? (
                    <button className="rounded border border-yes/40 bg-yes/10 px-3 py-1 text-xs font-bold text-yes">Claim</button>
                  ) : (
                    <span className="text-xs text-muted">Open</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
