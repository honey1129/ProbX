"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Bot, BrainCircuit, Loader2, Radio, RefreshCw, Trophy, Zap } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { PnLChart } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { formatPercent, formatUsd, probability } from "@/lib/format";
import type { ActivitySide, AgentActivity } from "@/lib/types";

export default function AgentsPage() {
  const { markets, activity, isLoading, error, backendEnabled, refresh } = useMarkets();
  const [feedFilter, setFeedFilter] = useState<"ALL" | ActivitySide>("ALL");
  const [selectedAgent, setSelectedAgent] = useState("");

  const agentStats = useMemo(() => deriveAgentStats(activity), [activity]);

  const totals = useMemo(() => {
    const volume = activity.reduce((sum, item) => sum + item.size, 0);
    const trades = activity.length;
    const confidence = trades ? activity.reduce((sum, item) => sum + item.confidence, 0) / trades / 100 : 0;
    return { volume, trades, confidence, activeMarkets: markets.length };
  }, [activity, markets.length]);

  const volumeCurve = useMemo(() => {
    let total = 0;
    return [...activity]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((item) => {
        total += item.size;
        return total;
      });
  }, [activity]);

  const signalMarket = markets[0];
  const signal = signalMarket ? probability(signalMarket) : 0.5;
  const selectedStats = agentStats.find((agent) => agent.name === selectedAgent) ?? agentStats[0];
  const filteredActivity = feedFilter === "ALL" ? activity : activity.filter((item) => item.side === feedFilter);
  const yesFlow = activity.filter((item) => item.side === "YES").reduce((sum, item) => sum + item.size, 0);
  const noFlow = activity.filter((item) => item.side === "NO").reduce((sum, item) => sum + item.size, 0);
  const totalFlow = Math.max(1, yesFlow + noFlow);
  const yesShare = yesFlow / totalFlow;
  const buyShare = activity.length ? activity.filter((item) => item.action === "BUY").length / activity.length : 0;

  if (isLoading) {
    return (
      <AgentsStatePanel
        icon={<Loader2 size={26} className="animate-spin text-solBlue" />}
        title="Loading agent activity"
        message={backendEnabled ? "Reading indexed activity from the ProbX API." : "Preparing local activity data."}
      />
    );
  }

  if (error && !activity.length) {
    return (
      <AgentsStatePanel
        icon={<AlertTriangle size={26} className="text-no" />}
        title="Agent activity is unavailable"
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
    <div className="grid h-full min-h-0 gap-3 overflow-y-auto 2xl:grid-rows-[auto_1fr] 2xl:overflow-hidden">
      <section className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <AgentMetric icon={<Trophy size={18} />} label="Recorded Volume" value={formatUsd(totals.volume)} tone="yes" />
        <AgentMetric icon={<Zap size={18} />} label="Avg Confidence" value={formatPercent(totals.confidence, 0)} tone="purple" />
        <AgentMetric icon={<Radio size={18} />} label="Total Trades" value={totals.trades.toLocaleString()} tone="blue" />
        <AgentMetric icon={<Bot size={18} />} label="Active Markets" value={totals.activeMarkets.toString()} tone="purple" />
      </section>

      <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)] 2xl:grid-cols-[clamp(360px,21vw,430px)_minmax(0,1fr)_clamp(380px,24vw,480px)]">
        <aside className="terminal-panel flex h-[460px] min-h-0 flex-col overflow-hidden p-4 xl:h-full">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-black">Activity Feed</h1>
            <select
              value={feedFilter}
              onChange={(event) => setFeedFilter(event.target.value as "ALL" | ActivitySide)}
              className="h-8 rounded-md border border-line bg-black/35 px-2 text-xs font-bold outline-none"
            >
              <option value="ALL">All Agents</option>
              <option value="YES">YES Trades</option>
              <option value="NO">NO Trades</option>
              <option value="VOID">Governance</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentActivityFeed activity={filteredActivity} markets={markets} />
          </div>
        </aside>

        <main className="grid min-h-[680px] grid-rows-[auto_1fr] gap-3 overflow-hidden xl:h-full xl:min-h-0">
          <section className="terminal-panel overflow-hidden p-4">
            <div className="mb-4">
              <h2 className="text-xl font-black">Activity Volume Curve</h2>
              <p className="text-sm text-muted">Cumulative recorded activity by timestamp.</p>
            </div>
            {volumeCurve.length ? (
              <PnLChart values={volumeCurve} />
            ) : (
              <EmptyBlock title="No activity volume yet" message="The curve will appear after trades are recorded." />
            )}
          </section>

          <section className="terminal-panel flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-black">Agent Comparison</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-2 p-2 md:hidden">
                {!agentStats.length ? (
                  <div className="rounded-lg bg-slate-950/35 px-4 py-10 text-center">
                    <p className="font-bold text-slate-200">No agent rows yet</p>
                    <p className="mt-1 text-sm text-muted">Agent comparison will populate from indexed activity.</p>
                  </div>
                ) : null}
                {agentStats.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => setSelectedAgent(agent.name)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selectedStats?.name === agent.name
                        ? "border-solPurple/50 bg-solPurple/15 shadow-glow"
                        : "border-line bg-slate-950/35"
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-black text-white">{agent.name}</div>
                        <div className="mt-1 text-xs text-muted">{agent.flow}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs uppercase text-muted">Volume</div>
                        <div className="font-black text-yes">{formatUsd(agent.volume)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <MobileAgentStat label="Avg Conf." value={`${agent.avgConfidence}%`} />
                      <MobileAgentStat label="Trades" value={agent.trades.toLocaleString()} />
                    </div>
                  </button>
                ))}
              </div>
              <table className="hidden w-full border-collapse text-sm md:table">
                <thead className="bg-slate-950/80 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">Agent</th>
                    <th className="px-4 py-3 text-left">Flow</th>
                    <th className="px-4 py-3 text-right">Avg Conf.</th>
                    <th className="px-4 py-3 text-right">Volume</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {!agentStats.length ? (
                    <tr className="border-t border-line bg-slate-950/35">
                      <td colSpan={5} className="px-4 py-10 text-center">
                        <p className="font-bold text-slate-200">No agent rows yet</p>
                        <p className="mt-1 text-sm text-muted">Agent comparison will populate from indexed activity.</p>
                      </td>
                    </tr>
                  ) : null}
                  {agentStats.map((agent) => (
                    <tr
                      key={agent.name}
                      onClick={() => setSelectedAgent(agent.name)}
                      className={`cursor-pointer border-t border-line transition hover:bg-slate-900/60 ${
                        selectedStats?.name === agent.name ? "bg-solPurple/15 shadow-[inset_3px_0_0_#9b5cff]" : "bg-slate-950/35"
                      }`}
                    >
                      <td className="px-4 py-3 font-black">{agent.name}</td>
                      <td className="px-4 py-3 text-muted">{agent.flow}</td>
                      <td className="px-4 py-3 text-right font-bold">{agent.avgConfidence}%</td>
                      <td className="px-4 py-3 text-right font-black text-yes">{formatUsd(agent.volume)}</td>
                      <td className="px-4 py-3 text-right">{agent.trades.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className="grid h-full min-h-[560px] grid-rows-[1fr_auto] gap-3 overflow-hidden xl:col-span-2 2xl:col-span-1 2xl:min-h-0">
          <section className="terminal-panel overflow-y-auto p-4">
            <div className="mb-4 flex items-center gap-2">
              <BrainCircuit size={18} className="text-solBlue" />
              <h2 className="font-black">Signal Engine</h2>
            </div>
            <div className="mb-4 rounded-lg border border-solPurple/30 bg-solPurple/10 p-3">
              <div className="text-xs uppercase text-muted">Selected Agent</div>
              {selectedStats ? (
                <>
                  <div className="mt-1 flex items-center justify-between">
                    <b className="text-lg">{selectedStats.name}</b>
                    <span className="font-black text-yes">{formatUsd(selectedStats.volume)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{selectedStats.flow} / {selectedStats.trades.toLocaleString()} trades</div>
                </>
              ) : (
                <div className="mt-2 text-sm text-muted">No indexed agent activity yet.</div>
              )}
            </div>
            <div className="grid gap-3">
              <SignalRow label="Market Probability" value={Math.round(signal * 100).toString()} max="100" color="from-solBlue to-yes" />
              <SignalRow label="YES Flow Share" value={Math.round(yesShare * 100).toString()} max="100" color="from-solPurple to-solBlue" />
              <SignalRow label="Avg Confidence" value={Math.round(totals.confidence * 100).toString()} max="100" color="from-yes to-emerald-300" />
            </div>
            <div className="mt-4 rounded-lg border border-line bg-black/25 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold">{signalMarket?.question ?? "No active market"}</span>
                <b className={signal >= 0.5 ? "text-yes" : "text-no"}>{signal >= 0.5 ? "YES" : "NO"}</b>
              </div>
              <ProbabilityBar probability={signal} />
            </div>
          </section>

          <section className="terminal-panel overflow-hidden p-4">
            <h2 className="mb-4 font-black">Activity Allocation</h2>
            <div className="grid gap-3">
              <Allocation label="YES flow" value={Math.round(yesShare * 100)} />
              <Allocation label="NO flow" value={Math.round((1 - yesShare) * 100)} />
              <Allocation label="BUY actions" value={Math.round(buyShare * 100)} />
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

type DerivedAgentStats = {
  name: string;
  flow: string;
  volume: number;
  avgConfidence: number;
  trades: number;
};

function deriveAgentStats(activity: AgentActivity[]): DerivedAgentStats[] {
  const grouped = new Map<string, AgentActivity[]>();
  activity.forEach((item) => {
    grouped.set(item.agent, [...(grouped.get(item.agent) ?? []), item]);
  });

  return [...grouped.entries()]
    .map(([name, items]) => {
      const yes = items.filter((item) => item.side === "YES").reduce((sum, item) => sum + item.size, 0);
      const no = items.filter((item) => item.side === "NO").reduce((sum, item) => sum + item.size, 0);
      const volume = items.reduce((sum, item) => sum + item.size, 0);
      const avgConfidence = Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, items.length));
      const flow = yes > no ? "YES flow" : no > yes ? "NO flow" : "Balanced flow";
      return { name, flow, volume, avgConfidence, trades: items.length };
    })
    .sort((a, b) => b.volume - a.volume);
}

function AgentsStatePanel({ icon, title, message, action }: { icon: React.ReactNode; title: string; message: string; action?: React.ReactNode }) {
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

function AgentMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "yes" | "blue" | "purple" }) {
  const toneClass = {
    yes: "border-yes/30 bg-yes/10 text-yes shadow-yes",
    blue: "border-solBlue/30 bg-solBlue/10 text-solBlue",
    purple: "border-solPurple/30 bg-solPurple/10 text-violet-200 shadow-glow"
  }[tone];

  return (
    <article className="terminal-panel p-3 sm:p-4">
      <div className={`mb-4 inline-flex rounded-lg border p-2 ${toneClass}`}>{icon}</div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 truncate text-2xl font-black sm:text-3xl">{value}</div>
    </article>
  );
}

function MobileAgentStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-black/20 px-2.5 py-2">
      <div className="text-[11px] uppercase text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-slate-100">{value}</div>
    </div>
  );
}

function SignalRow({ label, value, max, color }: { label: string; value: string; max: string; color: string }) {
  const width = Math.max(0, Math.min(100, Number(value)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-bold text-slate-300">{label}</span>
        <span className="text-muted">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-white/10">
        <div className={`h-full bg-gradient-to-r ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Allocation({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-black/25 p-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-bold">{label}</span>
        <b>{value}%</b>
      </div>
      <div className="h-2 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-gradient-to-r from-solPurple via-solBlue to-yes" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
