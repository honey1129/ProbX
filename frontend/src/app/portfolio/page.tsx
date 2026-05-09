"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownUp, BadgeDollarSign, Landmark, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { PnLChart } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { formatPercent, formatSol, probability } from "@/lib/format";
import type { Position } from "@/lib/types";

type SortKey = "pnl" | "size" | "market";

export default function PortfolioPage() {
  const { markets, positions, isLoading, error, backendEnabled, refresh } = useMarkets();
  const [sortKey, setSortKey] = useState<SortKey>("pnl");

  const enriched = useMemo<Position[]>(() => {
    return positions.map((position) => {
      const market = markets.find((item) => item.id === position.marketId);
      const yes = market ? probability(market) : position.currentProbability;
      const currentProbability = position.side === "YES" ? yes : 1 - yes;
      const pnl = (currentProbability - position.entryProbability) * position.size * 100;
      return { ...position, currentProbability, pnl };
    });
  }, [markets, positions]);

  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      if (sortKey === "size") return b.size - a.size;
      if (sortKey === "market") {
        const aQuestion = markets.find((item) => item.id === a.marketId)?.question ?? a.marketId;
        const bQuestion = markets.find((item) => item.id === b.marketId)?.question ?? b.marketId;
        return aQuestion.localeCompare(bQuestion);
      }
      return b.pnl - a.pnl;
    });
  }, [enriched, markets, sortKey]);

  const totalBalance = enriched.reduce((sum, item) => sum + item.size, 0);
  const unrealized = enriched.filter((item) => !item.resolved).reduce((sum, item) => sum + item.pnl, 0);
  const realized = enriched.filter((item) => item.resolved).reduce((sum, item) => sum + item.pnl, 0);
  const winRate = enriched.length ? enriched.filter((item) => item.pnl > 0).length / enriched.length : 0;
  const pnlCurve = useMemo(() => {
    let total = 0;
    return enriched.map((position) => {
      total += position.pnl;
      return total;
    });
  }, [enriched]);

  if (isLoading) {
    return (
      <PortfolioStatePanel
        icon={<Loader2 size={26} className="animate-spin text-solBlue" />}
        title="Loading portfolio"
        message={backendEnabled ? "Reading your positions from the ProbX API." : "Preparing local positions."}
      />
    );
  }

  if (error && !positions.length) {
    return (
      <PortfolioStatePanel
        icon={<AlertTriangle size={26} className="text-no" />}
        title="Portfolio is unavailable"
        message={error}
        action={
          <button onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border border-solBlue/50 bg-solBlue/10 px-4 py-2 font-bold text-solBlue transition hover:bg-solBlue/20">
            <RefreshCw size={15} /> Retry
          </button>
        }
      />
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-3 overflow-hidden">
      <section className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <SummaryCard icon={<WalletCards size={18} />} label="Total Balance" value={formatSol(totalBalance)} tone="blue" />
        <SummaryCard icon={<BadgeDollarSign size={18} />} label="Unrealized PnL" value={formatSignedUsd(unrealized)} tone={unrealized >= 0 ? "yes" : "no"} />
        <SummaryCard icon={<Landmark size={18} />} label="Realized PnL" value={formatSignedUsd(realized)} tone={realized >= 0 ? "yes" : "no"} />
        <SummaryCard icon={<ArrowDownUp size={18} />} label="Win Rate" value={formatPercent(winRate)} tone="purple" />
      </section>

      <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_clamp(360px,28vw,460px)]">
        <article className="terminal-panel flex min-h-0 flex-col overflow-hidden p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black">Portfolio</h1>
              <p className="text-sm text-muted">Open positions, current mark-to-market PnL, and claimable resolved markets.</p>
            </div>
            <div className="flex rounded-lg border border-line bg-black/25 p-1">
              {(["pnl", "size", "market"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setSortKey(item)}
                  className={`rounded-md px-3 py-1.5 text-xs font-black uppercase transition ${
                    sortKey === item ? "bg-solPurple/20 text-white shadow-glow" : "text-muted hover:text-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-no/30 bg-no/10 px-3 py-2 text-xs text-no">
              <span className="min-w-0 truncate">ProbX API error: {error}</span>
              <button onClick={refresh} className="shrink-0 font-black text-slate-100 transition hover:text-white">
                Retry
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PositionTable positions={sorted} markets={markets} />
          </div>
        </article>

        <aside className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden">
          <section className="terminal-panel overflow-hidden p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-black">Cumulative PnL</h2>
              <span className={unrealized + realized >= 0 ? "text-sm font-black text-yes" : "text-sm font-black text-no"}>
                {formatSignedUsd(unrealized + realized)}
              </span>
            </div>
            {pnlCurve.length ? <PnLChart values={pnlCurve} /> : <EmptyBlock title="No PnL curve yet" message="The curve will appear after positions are recorded." />}
          </section>

          <section className="terminal-panel flex min-h-0 flex-col overflow-hidden p-4">
            <h2 className="mb-4 font-black">Exposure</h2>
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto">
              {!enriched.length ? <EmptyBlock title="No exposure yet" message="Open positions will appear here after trades are recorded." /> : null}
              {enriched.map((position) => {
                const market = markets.find((item) => item.id === position.marketId);
                return (
                  <article key={position.id} className="rounded-lg border border-line bg-black/25 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-bold">{market?.question ?? position.marketId}</span>
                      <b className={position.side === "YES" ? "text-yes" : "text-no"}>{position.side}</b>
                    </div>
                    <ProbabilityBar probability={market ? probability(market) : position.currentProbability} />
                  </article>
                );
              })}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "yes" | "no" | "blue" | "purple" }) {
  const toneClass = {
    yes: "border-yes/30 bg-yes/10 text-yes shadow-yes",
    no: "border-no/30 bg-no/10 text-no shadow-no",
    blue: "border-solBlue/30 bg-solBlue/10 text-solBlue",
    purple: "border-solPurple/30 bg-solPurple/10 text-violet-200 shadow-glow"
  }[tone];

  return (
    <article className="terminal-panel p-4">
      <div className={`mb-4 inline-flex rounded-lg border p-2 ${toneClass}`}>{icon}</div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 text-3xl font-black">{value}</div>
    </article>
  );
}

function PortfolioStatePanel({ icon, title, message, action }: { icon: React.ReactNode; title: string; message: string; action?: React.ReactNode }) {
  return (
    <section className="terminal-panel grid min-h-[520px] place-items-center p-10 text-center">
      <div className="max-w-xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border border-line bg-black/25">{icon}</div>
        <h1 className="text-3xl font-black">{title}</h1>
        <p className="mt-3 text-sm text-muted">{message}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </section>
  );
}

function EmptyBlock({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid h-72 place-items-center rounded-lg border border-line bg-black/25 p-6 text-center">
      <div>
        <p className="font-bold text-slate-200">{title}</p>
        <p className="mt-1 text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

function formatSignedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}
