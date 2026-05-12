"use client";

import { useMemo, useState } from "react";
import { TransactionProgressModal, type TransactionProgressState } from "@/components/chain/TransactionProgress";
import { useMarkets } from "@/components/market/MarketProvider";
import { formatPercent } from "@/lib/format";
import { getRuntimeConfig } from "@/lib/runtimeConfig";
import type { Market, Position } from "@/lib/types";
import { RouterLink as Link } from "@/router";

export function PositionTable({ positions, markets, compact = false }: { positions: Position[]; markets: Market[]; compact?: boolean }) {
  const { redeem, refund, waitForActionConfirmation } = useMarkets();
  const runtimeConfig = useMemo(() => getRuntimeConfig(), []);
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [chainProgress, setChainProgress] = useState<TransactionProgressState | null>(null);
  const showAction = !compact;

  async function claim(position: Position) {
    setMessages((current) => ({ ...current, [position.id]: "" }));
    setChainProgress(null);
    setPending((current) => ({ ...current, [position.id]: true }));
    try {
      const market = markets.find((item) => item.id === position.marketId);
      const isCancelled = Boolean(market?.resolved && market.outcome === 2);
      const signature = isCancelled ? await refund(position.id) : await redeem(position.id);
      if (signature !== "local" && signature !== "indexed") {
        setChainProgress({
          title: isCancelled ? "Refund Position" : "Claim Winnings",
          phase: "confirming",
          signature,
          message: "Transaction broadcasted. Waiting for confirmation and ProbX indexing."
        });
        setMessages((current) => ({
          ...current,
          [position.id]: `Tx ${signature.slice(0, 8)}... waiting for indexer`
        }));
        const confirmation = await waitForActionConfirmation(signature, {
          eventType: isCancelled ? "RefundRedeemed" : "WinningsRedeemed",
          marketId: position.marketId
        });
        const confirmed = confirmation === "confirmed";
        const chainConfirmed = confirmation === "chain-confirmed";
        const failed = confirmation === "failed";
        setChainProgress({
          title: isCancelled ? "Refund Position" : "Claim Winnings",
          phase: confirmed ? "confirmed" : chainConfirmed ? "chain-confirmed" : failed ? "error" : "timeout",
          signature,
          message:
            confirmed
              ? "Transaction is confirmed and indexed by ProbX."
              : chainConfirmed
                ? "Transaction is confirmed on Solana. ProbX indexing is still catching up."
                : failed
                  ? "Solana reported this transaction as failed."
              : "Transaction was sent; indexing is still catching up."
        });
        if (!failed) {
          setClaimed((current) => ({ ...current, [position.id]: true }));
        }
        setMessages((current) => ({
          ...current,
          [position.id]:
            confirmed
              ? `${isCancelled ? "Refund" : "Claim"} confirmed: ${signature.slice(0, 8)}...`
              : chainConfirmed
                ? `${isCancelled ? "Refund" : "Claim"} confirmed on-chain: ${signature.slice(0, 8)}...`
                : failed
                  ? `Tx failed: ${signature.slice(0, 8)}...`
              : `Tx ${signature.slice(0, 8)}... indexer still catching up`
        }));
        return;
      }
      setClaimed((current) => ({ ...current, [position.id]: true }));
      setMessages((current) => ({
        ...current,
        [position.id]:
          signature === "local"
            ? isCancelled
              ? "Marked refunded"
              : "Marked claimed"
            : isCancelled
              ? "Refund indexed"
              : "Claim indexed"
      }));
    } catch (error) {
      setChainProgress(null);
      setMessages((current) => ({
        ...current,
        [position.id]: error instanceof Error ? error.message : "Action failed"
      }));
    } finally {
      setPending((current) => ({ ...current, [position.id]: false }));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <TransactionProgressModal
        state={chainProgress}
        explorerCluster={runtimeConfig.explorerCluster}
        onClose={() => setChainProgress(null)}
      />
      <div className="grid gap-2 p-2 md:hidden">
        {!positions.length ? (
          <div className="rounded-lg bg-slate-950/35 px-4 py-10 text-center">
            <p className="font-bold text-slate-200">No positions yet</p>
            <p className="mt-1 text-sm text-muted">Your open and resolved positions will appear here after trades are recorded.</p>
          </div>
        ) : null}
        {positions.map((position) => {
          const market = markets.find((item) => item.id === position.marketId);
          const pnlClass = position.pnl >= 0 ? "text-yes" : "text-no";
          const isCancelled = Boolean(market?.resolved && market.outcome === 2);
          const winningSide = market?.outcome === 1 ? "YES" : market?.outcome === 0 ? "NO" : position.side;
          const isResolved = Boolean(position.resolved || market?.resolved);
          const isWinning = isCancelled || !market?.resolved || position.side === winningSide;
          const isClaimed = claimed[position.id] || position.size <= 0;
          return (
            <article key={position.id} className="rounded-lg border border-line bg-slate-950/35 p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <Link href={`/markets/${position.marketId}`} className="min-w-0 flex-1 text-sm font-black leading-snug text-white">
                  {market?.question ?? position.marketId}
                </Link>
                <span className={position.side === "YES" ? "shrink-0 font-black text-yes" : "shrink-0 font-black text-no"}>
                  {position.side}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <MobileStat label="Size" value={`${position.size.toFixed(compact ? 0 : 2)}${compact ? "" : " SOL"}`} />
                <MobileStat label="PnL" value={`${position.pnl >= 0 ? "+" : "-"}$${Math.abs(position.pnl).toFixed(2)}`} valueClassName={pnlClass} />
                <MobileStat label="Entry" value={formatPercent(position.entryProbability)} />
                <MobileStat label="Current" value={formatPercent(position.currentProbability)} />
              </div>
              {showAction ? (
                <div className="mt-3">
                  {isResolved && isWinning ? (
                    <button
                      onClick={() => claim(position)}
                      disabled={isClaimed || pending[position.id]}
                      className="h-9 w-full rounded border border-yes/40 bg-yes/10 px-3 text-xs font-bold text-yes transition hover:bg-yes/20 disabled:border-line disabled:bg-white/5 disabled:text-muted"
                    >
                      {pending[position.id] ? (isCancelled ? "Refunding" : "Claiming") : isClaimed ? (isCancelled ? "Refunded" : "Claimed") : isCancelled ? "Refund" : "Claim"}
                    </button>
                  ) : isResolved ? (
                    <span className="text-xs text-muted">Lost</span>
                  ) : (
                    <span className="text-xs text-muted">Open</span>
                  )}
                  {messages[position.id] ? <div className="mt-2 text-[11px] text-muted">{messages[position.id]}</div> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <table className={compact ? "hidden w-full table-fixed border-collapse text-xs md:table" : "hidden w-full border-collapse text-sm md:table"}>
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
          {!positions.length ? (
            <tr className="border-t border-line bg-slate-950/35">
              <td colSpan={showAction ? 7 : 6} className="px-4 py-10 text-center">
                <p className="font-bold text-slate-200">No positions yet</p>
                <p className="mt-1 text-sm text-muted">Your open and resolved positions will appear here after trades are recorded.</p>
              </td>
            </tr>
          ) : null}
          {positions.map((position) => {
            const market = markets.find((item) => item.id === position.marketId);
            const pnlClass = position.pnl >= 0 ? "text-yes" : "text-no";
            const isCancelled = Boolean(market?.resolved && market.outcome === 2);
            const winningSide = market?.outcome === 1 ? "YES" : market?.outcome === 0 ? "NO" : position.side;
            const isResolved = Boolean(position.resolved || market?.resolved);
            const isWinning = isCancelled || !market?.resolved || position.side === winningSide;
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
                        {pending[position.id] ? (isCancelled ? "Refunding" : "Claiming") : isClaimed ? (isCancelled ? "Refunded" : "Claimed") : isCancelled ? "Refund" : "Claim"}
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

function MobileStat({ label, value, valueClassName = "text-slate-100" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-black/20 px-2.5 py-2">
      <div className="text-[11px] uppercase text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${valueClassName}`}>{value}</div>
    </div>
  );
}
