"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Bot, Clock3, Droplets, Loader2, Radio, RefreshCw, UsersRound } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { ProbabilityChart, type ChartTimeframe } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { TradePanel } from "@/components/trade/TradePanel";
import { formatPercent, formatPrice, formatSol, formatUsd, probability, timeRemaining } from "@/lib/format";
import type { Side } from "@/lib/types";

const timeframes: ChartTimeframe[] = ["1H", "1D", "1W", "ALL"];
const tradeFilters = ["ALL", "YES", "NO"] as const;

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const { markets, activity, isLoading, error, backendEnabled, dataSource, refresh } = useMarkets();
  const [chartSide, setChartSide] = useState<Side>("YES");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [tradeFilter, setTradeFilter] = useState<(typeof tradeFilters)[number]>("ALL");

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const market = markets.find((item) => item.id === id);
  const marketActivity = useMemo(() => (market ? activity.filter((item) => item.marketId === market.id) : []), [activity, market]);

  const recentTrades = useMemo(() => {
    const trades = tradeFilter === "ALL" ? marketActivity : marketActivity.filter((trade) => trade.side === tradeFilter);
    return trades.slice(0, 12);
  }, [marketActivity, tradeFilter]);

  const flow = useMemo(() => {
    const yes = marketActivity.filter((item) => item.side === "YES").reduce((sum, item) => sum + item.size, 0);
    const no = marketActivity.filter((item) => item.side === "NO").reduce((sum, item) => sum + item.size, 0);
    const confidence = marketActivity.length
      ? Math.round(marketActivity.reduce((sum, item) => sum + item.confidence, 0) / marketActivity.length)
      : 0;
    return { yes, no, confidence, side: yes >= no ? "YES" : "NO" };
  }, [marketActivity]);

  if (isLoading) {
    return (
      <MarketStatePanel
        icon={<Loader2 size={26} className="animate-spin text-solBlue" />}
        eyebrow="Loading"
        title="Reading market data"
        message={backendEnabled ? "Fetching this market from the ProbX API." : "Preparing local market data."}
      />
    );
  }

  if (error && !markets.length) {
    return (
      <MarketStatePanel
        icon={<AlertTriangle size={26} className="text-no" />}
        eyebrow="API error"
        title="ProbX API is unavailable"
        message={error}
        action={
          <button onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border border-solBlue/50 bg-solBlue/10 px-4 py-2 font-bold text-solBlue transition hover:bg-solBlue/20">
            <RefreshCw size={15} /> Retry
          </button>
        }
      />
    );
  }

  if (!market) {
    return (
      <MarketStatePanel
        icon={<AlertTriangle size={26} className="text-muted" />}
        eyebrow="Market not found"
        title="This market is not available"
        message={backendEnabled ? "The ProbX API responded, but this market id was not found." : "This market is not present in local preview data."}
        action={
          <Link href="/" className="inline-flex rounded-lg border border-solPurple/60 bg-solPurple/20 px-4 py-2 font-bold text-white shadow-glow">
            Back to markets
          </Link>
        }
      />
    );
  }

  const yesProbability = probability(market);
  const activePrice = chartSide === "YES" ? yesProbability : 1 - yesProbability;

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)_380px] gap-3">
      <main className="grid min-h-0 gap-3">
        <section className="terminal-panel p-5">
          <div className="mb-4 flex items-start justify-between gap-5">
            <div className="min-w-0">
              <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-solBlue">
                <ArrowLeft size={16} /> Markets
              </Link>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="rounded border border-solPurple/40 bg-solPurple/10 px-2 py-1 text-violet-200">{market.category}</span>
                <span className="flex items-center gap-1">
                  <Clock3 size={13} /> Ends in {timeRemaining(market.endTime)}
                </span>
                <span className={dataSource === "api" ? "flex items-center gap-1 text-yes" : "flex items-center gap-1 text-muted"}>
                  <Radio size={13} /> {dataSource === "api" ? "API indexed" : "Local preview"}
                </span>
              </div>
              <h1 className="max-w-5xl text-3xl font-black leading-tight">{market.question}</h1>
            </div>
            <div className="shrink-0 rounded-lg border border-yes/30 bg-yes/10 px-5 py-4 text-right shadow-yes">
              <div className="text-5xl font-black text-yes">{formatPrice(activePrice)}</div>
              <div className="mt-1 text-xs uppercase text-muted">{chartSide} probability</div>
            </div>
          </div>

          <ProbabilityBar probability={yesProbability} />
        </section>

        <section className="terminal-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Probability Chart</h2>
              <p className="text-xs text-muted">
                {dataSource === "api" ? "YES/NO probability history from indexed market state." : "YES/NO probability history from local preview state."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-line bg-black/25 p-1">
                {(["YES", "NO"] as const).map((side) => (
                  <button
                    key={side}
                    onClick={() => setChartSide(side)}
                    className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
                      chartSide === side
                        ? side === "YES"
                          ? "bg-yes/20 text-yes shadow-yes"
                          : "bg-no/20 text-no shadow-no"
                        : "text-muted hover:text-white"
                    }`}
                  >
                    {side}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-line bg-black/25 p-1">
                {timeframes.map((item) => (
                  <button
                    key={item}
                    onClick={() => setTimeframe(item)}
                    className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
                      timeframe === item ? "bg-solPurple/20 text-white shadow-glow" : "text-muted hover:text-white"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ProbabilityChart market={market} side={chartSide} timeframe={timeframe} />
        </section>

        <section className="grid grid-cols-4 gap-3">
          <StatCard label="Total Liquidity" value={formatSol(market.totalLiquidity)} icon={<Droplets size={16} />} />
          <StatCard label="24h Volume" value={`$${(market.volume24h / 1_000_000).toFixed(2)}M`} icon={<Radio size={16} />} />
          <StatCard label="Participants" value={market.participants.toLocaleString()} icon={<UsersRound size={16} />} />
          <StatCard label="Current YES" value={formatPercent(yesProbability)} icon={<Bot size={16} />} />
        </section>

        <section className="terminal-panel min-h-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-black">Trade History</h2>
            <div className="flex rounded-lg border border-line bg-black/25 p-1">
              {tradeFilters.map((item) => (
                <button
                  key={item}
                  onClick={() => setTradeFilter(item)}
                  className={`rounded-md px-3 py-1 text-xs font-black transition ${
                    tradeFilter === item ? "bg-solBlue/20 text-white" : "text-muted hover:text-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-950/80 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Side</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3 text-right">Confidence</th>
                <th className="px-4 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {!recentTrades.length ? (
                <tr className="border-t border-line bg-slate-950/30">
                  <td colSpan={4} className="px-4 py-10 text-center">
                    <p className="font-bold text-slate-200">No indexed trades yet</p>
                    <p className="mt-1 text-sm text-muted">Trades will appear here after the API records market activity.</p>
                  </td>
                </tr>
              ) : null}
              {recentTrades.slice(0, 8).map((trade) => (
                <tr key={trade.id} className="border-t border-line bg-slate-950/30">
                  <td className={trade.side === "YES" ? "px-4 py-3 font-black text-yes" : "px-4 py-3 font-black text-no"}>
                    {trade.action} {trade.side}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatUsd(trade.size)}</td>
                  <td className="px-4 py-3 text-right">{trade.confidence}%</td>
                  <td className="px-4 py-3 text-right text-muted">{relativeTime(trade.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <aside className="grid min-h-0 content-start gap-3">
        <TradePanel market={market} />
        <section className="terminal-panel overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black">Agent Insight</h2>
            <span className={`rounded border px-2 py-1 text-xs font-black ${
              marketActivity.length ? "border-solBlue/40 bg-solBlue/10 text-solBlue" : "border-line bg-black/25 text-muted"
            }`}>
              {marketActivity.length ? "Indexed" : "Empty"}
            </span>
          </div>
          {marketActivity.length ? (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <MiniSignal label="Trades" value={marketActivity.length.toString()} />
                <MiniSignal label="Flow" value={flow.side} />
                <MiniSignal label="Confidence" value={`${flow.confidence}%`} />
              </div>
              <p className="text-sm leading-6 text-slate-300">
                Indexed agent flow currently leans <b className={flow.side === "YES" ? "text-yes" : "text-no"}>{flow.side}</b> with {formatUsd(flow.yes + flow.no)} recorded activity.
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-line bg-black/25 p-4 text-sm text-muted">
              No indexed agent signals are available for this market yet.
            </div>
          )}
        </section>
        <section className="terminal-panel overflow-hidden p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-black">Agent Feed</h2>
            <span className={`rounded border px-2 py-1 text-xs ${
              marketActivity.length ? "border-yes/25 bg-yes/10 text-yes" : "border-line bg-black/25 text-muted"
            }`}>
              {marketActivity.length ? "Recorded" : "No entries"}
            </span>
          </div>
          <AgentActivityFeed activity={marketActivity.slice(0, 6)} markets={markets} />
        </section>
      </aside>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <article className="terminal-panel p-4">
      <div className="mb-3 flex items-center justify-between text-muted">
        <span className="text-xs uppercase">{label}</span>
        <span className="text-solBlue">{icon}</span>
      </div>
      <div className="text-2xl font-black">{value}</div>
    </article>
  );
}

function MarketStatePanel({ icon, eyebrow, title, message, action }: { icon: ReactNode; eyebrow: string; title: string; message: string; action?: ReactNode }) {
  return (
    <section className="terminal-panel grid min-h-[520px] place-items-center p-10 text-center">
      <div className="max-w-xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border border-line bg-black/25">{icon}</div>
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-muted">{eyebrow}</p>
        <h1 className="text-3xl font-black">{title}</h1>
        <p className="mt-3 text-sm text-muted">{message}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </section>
  );
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function MiniSignal({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/25 p-3">
      <div className="text-[11px] uppercase text-muted">{label}</div>
      <div className="mt-1 text-lg font-black">
        {value}
        {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
      </div>
    </div>
  );
}
