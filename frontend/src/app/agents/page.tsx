"use client";

import { useMemo, useState } from "react";
import { Bot, BrainCircuit, Radio, Trophy, Zap } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { PnLChart } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { mockAgents } from "@/lib/mockData";
import { formatPercent, formatUsd, probability } from "@/lib/format";

export default function AgentsPage() {
  const { markets, activity } = useMarkets();
  const [feedFilter, setFeedFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [selectedAgent, setSelectedAgent] = useState(mockAgents[0].name);

  const totals = useMemo(() => {
    const pnl = mockAgents.reduce((sum, agent) => sum + agent.pnl, 0);
    const trades = mockAgents.reduce((sum, agent) => sum + agent.trades, 0);
    const winRate = mockAgents.reduce((sum, agent) => sum + agent.winRate, 0) / mockAgents.length / 100;
    return { pnl, trades, winRate, activeMarkets: markets.length };
  }, [markets.length]);

  const signalMarket = markets[0];
  const signal = signalMarket ? probability(signalMarket) : 0.5;
  const selectedStats = mockAgents.find((agent) => agent.name === selectedAgent) ?? mockAgents[0];
  const filteredActivity = feedFilter === "ALL" ? activity : activity.filter((item) => item.side === feedFilter);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-3 overflow-hidden">
      <section className="grid grid-cols-4 gap-3">
        <AgentMetric icon={<Trophy size={18} />} label="Total Agent PnL" value={formatUsd(totals.pnl)} tone="yes" />
        <AgentMetric icon={<Zap size={18} />} label="Win Rate" value={formatPercent(totals.winRate)} tone="purple" />
        <AgentMetric icon={<Radio size={18} />} label="Total Trades" value={totals.trades.toLocaleString()} tone="blue" />
        <AgentMetric icon={<Bot size={18} />} label="Active Markets" value={totals.activeMarkets.toString()} tone="purple" />
      </section>

      <section className="grid min-h-0 grid-cols-[390px_minmax(0,1fr)_430px] gap-3">
        <aside className="terminal-panel h-full overflow-hidden p-4">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-black">Live Trading Feed</h1>
            <select
              value={feedFilter}
              onChange={(event) => setFeedFilter(event.target.value as "ALL" | "YES" | "NO")}
              className="h-8 rounded-md border border-line bg-black/35 px-2 text-xs font-bold outline-none"
            >
              <option value="ALL">All Agents</option>
              <option value="YES">YES Trades</option>
              <option value="NO">NO Trades</option>
            </select>
          </div>
          <AgentActivityFeed activity={filteredActivity.slice(0, 6)} markets={markets} />
        </aside>

        <main className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-3 overflow-hidden">
          <section className="terminal-panel overflow-hidden p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">Agent PnL Curve</h2>
                <p className="text-sm text-muted">Cumulative profit across momentum, mean reversion, and external signal engines.</p>
              </div>
              <span className="rounded-lg border border-solPurple/40 bg-solPurple/15 px-3 py-2 text-xs font-black text-violet-200 shadow-glow">
                Ensemble mode
              </span>
            </div>
            <PnLChart values={Array.from({ length: 100 }, (_, i) => Math.cos(i / 11) * 520 + i * 42 + Math.sin(i / 4) * 170)} />
          </section>

          <section className="terminal-panel min-h-0 overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-black">Agent Comparison</h2>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-950/80 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Agent</th>
                  <th className="px-4 py-3 text-left">Strategy</th>
                  <th className="px-4 py-3 text-right">Win Rate</th>
                  <th className="px-4 py-3 text-right">PnL</th>
                  <th className="px-4 py-3 text-right">Trades</th>
                </tr>
              </thead>
              <tbody>
                {mockAgents.map((agent) => (
                  <tr
                    key={agent.name}
                    onClick={() => setSelectedAgent(agent.name)}
                    className={`cursor-pointer border-t border-line transition hover:bg-slate-900/60 ${
                      selectedAgent === agent.name ? "bg-solPurple/15 shadow-[inset_3px_0_0_#9b5cff]" : "bg-slate-950/35"
                    }`}
                  >
                    <td className="px-4 py-3 font-black">{agent.name}</td>
                    <td className="px-4 py-3 text-muted">{agent.strategy}</td>
                    <td className="px-4 py-3 text-right font-bold">{agent.winRate.toFixed(1)}%</td>
                    <td className={agent.pnl >= 0 ? "px-4 py-3 text-right font-black text-yes" : "px-4 py-3 text-right font-black text-no"}>
                      {formatUsd(agent.pnl)}
                    </td>
                    <td className="px-4 py-3 text-right">{agent.trades.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>

        <aside className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-3 overflow-hidden">
          <section className="terminal-panel overflow-hidden p-4">
            <div className="mb-4 flex items-center gap-2">
              <BrainCircuit size={18} className="text-solBlue" />
              <h2 className="font-black">Signal Engine</h2>
            </div>
            <div className="mb-4 rounded-lg border border-solPurple/30 bg-solPurple/10 p-3">
              <div className="text-xs uppercase text-muted">Selected Agent</div>
              <div className="mt-1 flex items-center justify-between">
                <b className="text-lg">{selectedStats.name}</b>
                <span className={selectedStats.pnl >= 0 ? "font-black text-yes" : "font-black text-no"}>{formatUsd(selectedStats.pnl)}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{selectedStats.strategy} / {selectedStats.trades.toLocaleString()} trades</div>
            </div>
            <div className="grid gap-3">
              <SignalRow label="Mock Sentiment" value="78" max="100" color="from-solBlue to-yes" />
              <SignalRow label="Momentum" value={Math.round((signal - 0.35) * 120).toString()} max="100" color="from-solPurple to-solBlue" />
              <SignalRow label="Confidence" value="84" max="100" color="from-yes to-emerald-300" />
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
            <h2 className="mb-4 font-black">Strategy Allocation</h2>
            <div className="grid gap-3">
              <Allocation label="Momentum" value={42} />
              <Allocation label="Mean Reversion" value={31} />
              <Allocation label="External Signal" value={27} />
            </div>
          </section>
        </aside>
      </section>
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
    <article className="terminal-panel p-4">
      <div className={`mb-4 inline-flex rounded-lg border p-2 ${toneClass}`}>{icon}</div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 text-3xl font-black">{value}</div>
    </article>
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
