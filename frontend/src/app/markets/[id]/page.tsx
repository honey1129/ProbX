"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, Clock3, Droplets, Radio, UsersRound } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { TradePanel } from "@/components/trade/TradePanel";
import { formatPercent, formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import type { Side } from "@/lib/types";

const timeframes = ["1H", "24H", "7D"] as const;

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const { markets, activity } = useMarkets();
  const [chartSide, setChartSide] = useState<Side>("YES");
  const [timeframe, setTimeframe] = useState<(typeof timeframes)[number]>("24H");

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const market = markets.find((item) => item.id === id);

  const recentTrades = useMemo(() => {
    if (!market) return [];
    return market.probabilityHistory.slice(-18).reverse().map((price, index) => {
      const side: Side = index % 3 === 0 ? "NO" : "YES";
      return {
        id: `${market.id}-${index}`,
        side,
        price: side === "YES" ? price : 1 - price,
        size: 4.2 + ((index * 17) % 31) / 4,
        time: `${index + 1}m`
      };
    });
  }, [market]);

  if (!market) {
    return (
      <section className="terminal-panel grid min-h-[520px] place-items-center p-10 text-center">
        <div>
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-muted">Market not found</p>
          <h1 className="mb-6 text-3xl font-black">This ProbX market is not in the local cache.</h1>
          <Link href="/" className="inline-flex rounded-lg border border-solPurple/60 bg-solPurple/20 px-4 py-2 font-bold text-white shadow-glow">
            Back to markets
          </Link>
        </div>
      </section>
    );
  }

  const yesProbability = probability(market);
  const activePrice = chartSide === "YES" ? yesProbability : 1 - yesProbability;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-3 pb-16">
      <main className="grid gap-3">
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
                <span className="flex items-center gap-1 text-yes">
                  <Radio size={13} /> Live pricing
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
              <p className="text-xs text-muted">YES/NO price history, simulated real-time feed</p>
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
          <ProbabilityChart market={market} />
        </section>

        <section className="grid grid-cols-4 gap-3">
          <StatCard label="Total Liquidity" value={formatSol(market.totalLiquidity)} icon={<Droplets size={16} />} />
          <StatCard label="24h Volume" value={`$${(market.volume24h / 1_000_000).toFixed(2)}M`} icon={<Radio size={16} />} />
          <StatCard label="Participants" value={market.participants.toLocaleString()} icon={<UsersRound size={16} />} />
          <StatCard label="Current YES" value={formatPercent(yesProbability)} icon={<Bot size={16} />} />
        </section>

        <section className="terminal-panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-black">Trade History</h2>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-950/80 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Side</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((trade) => (
                <tr key={trade.id} className="border-t border-line bg-slate-950/30">
                  <td className={trade.side === "YES" ? "px-4 py-3 font-black text-yes" : "px-4 py-3 font-black text-no"}>
                    BUY {trade.side}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatPrice(trade.price)}</td>
                  <td className="px-4 py-3 text-right">{trade.size.toFixed(2)} SOL</td>
                  <td className="px-4 py-3 text-right text-muted">{trade.time} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <aside className="sticky top-20 grid h-[calc(100vh-96px)] grid-rows-[auto_auto_1fr] gap-3">
        <TradePanel market={market} />
        <section className="terminal-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black">Agent Insight</h2>
            <span className="rounded border border-solBlue/40 bg-solBlue/10 px-2 py-1 text-xs font-black text-solBlue">AI</span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <MiniSignal label="Sentiment" value="72" suffix="/100" />
            <MiniSignal label="Momentum" value={market.change24h >= 0 ? "Bull" : "Bear"} />
            <MiniSignal label="Confidence" value={`${Math.round(64 + Math.abs(market.change24h) * 180)}%`} />
          </div>
          <p className="text-sm leading-6 text-slate-300">
            Agents favor <b className={yesProbability >= 0.5 ? "text-yes" : "text-no"}>{yesProbability >= 0.5 ? "YES" : "NO"}</b> after
            comparing short-term flow, pool imbalance, and external sentiment drift.
          </p>
        </section>
        <section className="terminal-panel overflow-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-black">Live Agent Feed</h2>
            <span className="rounded border border-yes/25 bg-yes/10 px-2 py-1 text-xs text-yes">Streaming</span>
          </div>
          <AgentActivityFeed activity={activity.filter((item) => item.marketId === market.id).slice(0, 10)} markets={markets} />
        </section>
      </aside>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
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
