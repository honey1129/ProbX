"use client";

import { useMemo, useState } from "react";
import { Bot, Flame, Search } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { ProbabilityChart, PnLChart } from "@/components/charts/ProbabilityChart";
import { MarketCard } from "@/components/market/MarketCard";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { TradePanel } from "@/components/trade/TradePanel";
import { formatPrice, formatSol, probability } from "@/lib/format";

const categories = ["All", "Crypto", "Politics", "Sports", "On-chain"] as const;

export default function MarketListPage() {
  const { markets, positions, activity } = useMarkets();
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [sort, setSort] = useState("Trending");
  const [selectedId, setSelectedId] = useState(markets[0]?.id);

  const filtered = useMemo(() => {
    const base = category === "All" ? markets : markets.filter((market) => market.category === category);
    return [...base].sort((a, b) => {
      if (sort === "New") return b.endTime - a.endTime;
      if (sort === "Volume") return b.volume24h - a.volume24h;
      return Math.abs(b.change24h) + b.volume24h / 20_000_000 - (Math.abs(a.change24h) + a.volume24h / 20_000_000);
    });
  }, [category, markets, sort]);

  const selected = markets.find((market) => market.id === selectedId) ?? markets[0];

  return (
    <div className="grid grid-cols-[390px_minmax(520px,1fr)_360px] gap-3 pb-16">
      <aside className="terminal-panel h-[calc(100vh-116px)] overflow-hidden">
        <div className="border-b border-line p-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-black/25 px-3 py-2">
            <Search size={16} className="text-muted" />
            <input className="w-full bg-transparent text-sm outline-none" placeholder="Search markets" />
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-md border px-3 py-1.5 text-xs font-bold transition ${
                  category === item ? "border-solPurple bg-solPurple/20 text-white shadow-glow" : "border-line bg-slate-950/70 text-slate-300"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {["Trending", "New", "Volume"].map((item) => (
              <button
                key={item}
                onClick={() => setSort(item)}
                className={`rounded-md border px-3 py-1 text-xs ${
                  sort === item ? "border-yes/40 bg-yes/10 text-yes" : "border-line text-muted"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="grid max-h-[calc(100%-150px)] gap-2 overflow-auto p-3">
          {filtered.map((market) => (
            <div key={market.id} onMouseEnter={() => setSelectedId(market.id)}>
              <MarketCard market={market} />
            </div>
          ))}
        </div>
      </aside>

      <section className="grid gap-3">
        {selected ? (
          <article className="terminal-panel p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                  <span className="rounded border border-solPurple/40 bg-solPurple/10 px-2 py-1 text-violet-200">{selected.category}</span>
                  <span className={selected.change24h >= 0 ? "text-yes" : "text-no"}>
                    {selected.change24h >= 0 ? "▲" : "▼"} {Math.abs(selected.change24h * 100).toFixed(1)}% 24h
                  </span>
                </div>
                <h1 className="text-2xl font-black">{selected.question}</h1>
              </div>
              <div className="text-right">
                <div className="text-4xl font-black text-yes">{formatPrice(probability(selected))}</div>
                <div className="text-xs text-muted">YES probability</div>
              </div>
            </div>
            <ProbabilityBar probability={probability(selected)} />
            <div className="mt-4">
              <ProbabilityChart market={selected} compact />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              <Metric label="YES Pool" value={formatSol(selected.yesPool)} />
              <Metric label="NO Pool" value={formatSol(selected.noPool)} />
              <Metric label="Liquidity" value={formatSol(selected.totalLiquidity)} />
              <Metric label="24h Volume" value={`$${(selected.volume24h / 1_000_000).toFixed(2)}M`} />
            </div>
          </article>
        ) : null}

        <div className="grid grid-cols-[1fr_1.1fr] gap-3">
          <article className="terminal-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Portfolio PnL</h2>
              <span className="text-xs text-muted">24H</span>
            </div>
            <div className="mb-3 text-3xl font-black">$3,842.67</div>
            <div className="mb-4 text-sm font-bold text-yes">▲ $732.14 (23.54%)</div>
            <PnLChart values={Array.from({ length: 80 }, (_, i) => Math.sin(i / 7) * 450 + Math.cos(i / 3) * 90 + i * 31)} />
          </article>
          <article className="terminal-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Positions</h2>
              <span className="text-xs text-muted">{positions.length} open</span>
            </div>
            <PositionTable positions={positions.slice(0, 4)} markets={markets} />
          </article>
        </div>
      </section>

      <aside className="grid h-[calc(100vh-116px)] grid-rows-[auto_1fr] gap-3">
        {selected ? <TradePanel market={selected} /> : null}
        <section className="terminal-panel overflow-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold">
              <Bot size={17} className="text-solPurple" /> Agent Activity
            </h2>
            <span className="flex items-center gap-2 rounded border border-yes/20 bg-yes/10 px-2 py-1 text-xs text-yes">
              <Flame size={13} /> Live
            </span>
          </div>
          <AgentActivityFeed activity={activity.slice(0, 8)} markets={markets} />
        </section>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/25 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}
