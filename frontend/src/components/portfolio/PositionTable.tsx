"use client";

import Link from "next/link";
import { useState } from "react";
import { useMarkets } from "@/components/market/MarketProvider";
import { formatPercent } from "@/lib/format";
import type { Market, Position } from "@/lib/types";

export function PositionTable({ positions, markets, compact = false }: { positions: Position[]; markets: Market[]; compact?: boolean }) {
  const { redeem } = useMarkets();
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const showAction = !compact;

  async function claim(position: Position) {
    setMessages((current) => ({ ...current, [position.id]: "" }));
    setPending((current) => ({ ...current, [position.id]: true }));
    try {
      const signature = await redeem(position.id);
      setClaimed((current) => ({ ...current, [position.id]: true }));
      setMessages((current) => ({
        ...current,
        [position.id]: signature === "simulated" ? "Claimed" : `Tx ${signature.slice(0, 8)}...`
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [position.id]: error instanceof Error ? error.message : "Claim failed"
      }));
    } finally {
      setPending((current) => ({ ...current, [position.id]: false }));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className={compact ? "w-full table-fixed border-collapse text-xs" : "w-full border-collapse text-sm"}>
        <thead className="bg-slate-950/80 text-xs uppercase text-muted">
          <tr>
            <th className={compact ? "w-[34%] px-3 py-2 text-left" : "px-4 py-3 text-left"}>Market</th>
            <th className={compact ? "w-[10%] px-3 py-2 text-left" : "px-4 py-3 text-left"}>Side</th>
            <th className={compact ? "w-[13%] px-3 py-2 text-right" : "px-4 py-3 text-right"}>Size</th>
            <th className={compact ? "w-[13%] px-3 py-2 text-right" : "px-4 py-3 text-right"}>Entry</th>
            <th className={compact ? "w-[13%] px-3 py-2 text-right" : "px-4 py-3 text-right"}>Current</th>
            <th className={compact ? "w-[17%] px-3 py-2 text-right" : "px-4 py-3 text-right"}>PnL</th>
            {showAction ? <th className="px-4 py-3 text-right">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => {
            const market = markets.find((item) => item.id === position.marketId);
            const pnlClass = position.pnl >= 0 ? "text-yes" : "text-no";
            const winningSide = market?.outcome === 1 ? "YES" : market?.outcome === 0 ? "NO" : position.side;
            const isResolved = Boolean(position.resolved || market?.resolved);
            const isWinning = !market?.resolved || position.side === winningSide;
            const isClaimed = claimed[position.id] || position.size <= 0;
            return (
              <tr key={position.id} className="border-t border-line bg-slate-950/35 transition hover:bg-slate-900/60">
                <td className={compact ? "px-3 py-2" : "max-w-[460px] px-4 py-3"}>
                  <Link href={`/markets/${position.marketId}`} className={compact ? "block truncate font-semibold text-white hover:text-solBlue" : "font-semibold text-white hover:text-solBlue"}>
                    {market?.question ?? position.marketId}
                  </Link>
                </td>
                <td className={position.side === "YES" ? "px-3 py-2 font-black text-yes" : "px-3 py-2 font-black text-no"}>
                  {position.side}
                </td>
                <td className="px-3 py-2 text-right">{position.size.toFixed(compact ? 0 : 2)}{compact ? "" : " SOL"}</td>
                <td className="px-3 py-2 text-right">{formatPercent(position.entryProbability)}</td>
                <td className="px-3 py-2 text-right">{formatPercent(position.currentProbability)}</td>
                <td className={`px-3 py-2 text-right font-bold ${pnlClass}`}>
                  {position.pnl >= 0 ? "+" : "-"}${Math.abs(position.pnl).toFixed(2)}
                </td>
                {showAction ? (
                  <td className="px-3 py-2 text-right">
                    {isResolved && isWinning ? (
                      <button
                        onClick={() => claim(position)}
                        disabled={isClaimed || pending[position.id]}
                        className="rounded border border-yes/40 bg-yes/10 px-3 py-1 text-xs font-bold text-yes transition hover:bg-yes/20 disabled:border-line disabled:bg-white/5 disabled:text-muted"
                      >
                        {pending[position.id] ? "Claiming" : isClaimed ? "Claimed" : "Claim"}
                      </button>
                    ) : isResolved ? (
                      <span className="text-xs text-muted">Lost</span>
                    ) : (
                      <span className="text-xs text-muted">Open</span>
                    )}
                    {messages[position.id] ? <div className="mt-1 text-[11px] text-muted">{messages[position.id]}</div> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
