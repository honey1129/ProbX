"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Bot, ChevronDown, Flame, Maximize2, Plus, Settings, Share2, Star } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/AgentActivityFeed";
import { ProbabilityChart, type ChartTimeframe } from "@/components/charts/ProbabilityChart";
import { MarketCard } from "@/components/market/MarketCard";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { TradePanel } from "@/components/trade/TradePanel";
import { formatPrice, formatSol, probability } from "@/lib/format";
import type { Side } from "@/lib/types";

const categories = ["All", "Politics", "Crypto", "Sports", "Tech", "Macro"] as const;
const featuredOrder = ["fed-rates", "btc-100k", "trump-approval", "sol-etf", "nba-finals", "nvidia-earnings"];
const overviewTimeframes: ChartTimeframe[] = ["1H", "4H", "1D", "1W", "1M", "ALL"];
const chartSides: Array<Side | "BOTH"> = ["BOTH", "YES", "NO"];

export default function MarketListPage() {
  const { markets, positions, activity } = useMarkets();
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [sort, setSort] = useState("Trending");
  const [selectedId, setSelectedId] = useState(markets[0]?.id);
  const [deskTab, setDeskTab] = useState("Markets");
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [chartSide, setChartSide] = useState<Side | "BOTH">("BOTH");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  const filtered = useMemo(() => {
    const categoryMarkets = category === "All" ? markets : markets.filter((market) => market.category === category);
    const base = deskTab === "Watchlist" ? categoryMarkets.filter((market) => watchlist.has(market.id)) : categoryMarkets;
    return [...base].sort((a, b) => {
      if (sort === "New") return b.endTime - a.endTime;
      if (sort === "Volume") return b.volume24h - a.volume24h;
      return featuredRank(a.id) - featuredRank(b.id);
    });
  }, [category, deskTab, markets, sort, watchlist]);

  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((market) => market.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("probx.watchlist");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as string[];
      setWatchlist(new Set(parsed.filter(Boolean)));
    } catch {
      window.localStorage.removeItem("probx.watchlist");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("probx.watchlist", JSON.stringify([...watchlist]));
  }, [watchlist]);

  const selected = filtered.find((market) => market.id === selectedId) ?? filtered[0] ?? markets[0];
  const yesPrice = selected ? probability(selected) : 0;
  const noPrice = 1 - yesPrice;

  useEffect(() => {
    setSettingsOpen(false);
  }, [selected?.id]);

  const selectedPath = selected ? `/markets/${encodeURIComponent(selected.id)}` : "/";
  const selectedUrl = useMemo(() => {
    if (typeof window === "undefined") return selectedPath;
    return `${window.location.origin}${selectedPath}`;
  }, [selectedPath]);

  const toggleWatchlist = useCallback((marketId: string) => {
    setWatchlist((current) => {
      const next = new Set(current);
      if (next.has(marketId)) next.delete(marketId);
      else next.add(marketId);
      return next;
    });
  }, []);

  const copyShareLink = useCallback(async () => {
    if (!selected) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "ProbX market", text: selected.question, url: selectedUrl });
        setShareStatus("Shared");
      } else {
        await navigator.clipboard.writeText(selectedUrl);
        setShareStatus("Link copied");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(selectedUrl);
        setShareStatus("Link copied");
      } catch {
        setShareStatus("Copy failed");
      }
    }
    window.setTimeout(() => setShareStatus(""), 1500);
  }, [selected, selectedUrl]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[360px_minmax(430px,1fr)_260px_270px] gap-2.5 overflow-hidden">
      <aside className="terminal-panel flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-3.5 pb-3 pt-3">
          <div className="mb-3 flex items-center gap-6 text-sm">
            {["Markets", "Watchlist", "Trending"].map((item) => (
              <button
                key={item}
                onClick={() => setDeskTab(item)}
                className={`relative pb-2 transition ${
                  deskTab === item ? "text-violet-200" : "text-muted hover:text-white"
                }`}
              >
                {item}
                {item === "Watchlist" && watchlist.size ? <span className="ml-1 text-xs text-solBlue">{watchlist.size}</span> : null}
                {item === "Trending" ? <span className="ml-1 text-xs text-no">hot</span> : null}
                {deskTab === item ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-solPurple shadow-glow" /> : null}
              </button>
            ))}
          </div>
          <div className="mb-2 grid grid-cols-6 gap-1.5">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`min-w-0 rounded-md border px-1.5 py-1.5 text-xs font-bold transition ${
                  category === item ? "border-solPurple bg-solPurple/20 text-white shadow-glow" : "border-line bg-slate-950/70 text-slate-300 hover:border-solBlue/40"
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
        <div className="scroll-surface grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-2">
          {filtered.length ? (
            filtered.map((market) => (
              <div
                key={market.id}
                onMouseEnter={() => setSelectedId(market.id)}
                onFocus={() => setSelectedId(market.id)}
                className={selected?.id === market.id ? "rounded-lg ring-1 ring-solBlue/60 shadow-[0_0_24px_rgba(49,185,255,0.10)]" : ""}
              >
                <MarketCard market={market} />
              </div>
            ))
          ) : (
            <div className="grid h-48 place-items-center rounded-lg border border-line bg-black/25 p-6 text-center">
              <div>
                <p className="font-bold text-slate-200">No markets found</p>
                <p className="mt-1 text-sm text-muted">Try another keyword or category.</p>
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center border-t border-line px-4 py-2.5 text-sm">
          <Link href="/create" className="inline-flex items-center gap-2 text-slate-300 transition hover:text-white">
            <Plus size={14} /> Create Market
          </Link>
          <Link href="/markets" className="inline-flex items-center gap-2 text-muted transition hover:text-solBlue">
            View All Markets <ArrowRight size={13} />
          </Link>
        </div>
      </aside>

      <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(230px,0.52fr)] gap-2.5 overflow-hidden">
        {selected ? (
          <article className="terminal-panel flex min-h-0 flex-col overflow-hidden p-4">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                  <span className="rounded border border-solPurple/40 bg-solPurple/10 px-2 py-1 text-violet-200">{selected.category}</span>
                  <span className="font-black text-yes">{Math.round(yesPrice * 100)}% chance</span>
                  <span className={selected.change24h >= 0 ? "text-yes" : "text-no"}>
                    {selected.change24h >= 0 ? "▲" : "▼"} {Math.abs(selected.change24h * 100).toFixed(1)}% 24h
                  </span>
                  <span>Volume ${(selected.volume24h / 1_000_000).toFixed(2)}M</span>
                  <span>Open Interest ${((selected.yesPool + selected.noPool) / 1000).toFixed(2)}M</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-[22px] font-black">{selected.question}</h1>
                  <button
                    onClick={() => toggleWatchlist(selected.id)}
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition ${
                      watchlist.has(selected.id)
                        ? "border-solPurple/50 bg-solPurple/20 text-violet-200 shadow-glow"
                        : "border-transparent text-muted hover:border-line hover:text-white"
                    }`}
                    aria-label={watchlist.has(selected.id) ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    <Star size={17} className={watchlist.has(selected.id) ? "fill-current" : ""} />
                  </button>
                </div>
              </div>
              <div className="relative flex shrink-0 items-center gap-2">
                <button
                  onClick={copyShareLink}
                  className="inline-flex h-9 min-w-[86px] items-center justify-center gap-2 rounded-lg border border-line bg-slate-950/70 px-3 text-xs font-bold text-slate-200 transition hover:border-solBlue/45 hover:text-white"
                >
                  <Share2 size={14} /> {shareStatus || "Share"}
                </button>
                <button
                  onClick={() => setSettingsOpen((value) => !value)}
                  className={`grid h-9 w-9 place-items-center rounded-lg border bg-slate-950/70 transition ${
                    settingsOpen ? "border-solPurple/60 text-violet-200 shadow-glow" : "border-line text-slate-300 hover:border-solBlue/45 hover:text-white"
                  }`}
                  aria-expanded={settingsOpen}
                  aria-label="Chart settings"
                >
                  <Settings size={14} />
                </button>
                <Link
                  href={selectedPath}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-slate-950/70 text-slate-300 transition hover:border-solBlue/45 hover:text-white"
                  aria-label="Open market detail"
                >
                  <Maximize2 size={14} />
                </Link>
                {settingsOpen ? (
                  <div className="absolute right-0 top-11 z-20 w-52 rounded-lg border border-line bg-slate-950/95 p-3 shadow-2xl">
                    <div className="mb-2 text-xs font-black uppercase text-muted">Chart Curve</div>
                    <div className="grid grid-cols-3 gap-1">
                      {chartSides.map((item) => (
                        <button
                          key={item}
                          onClick={() => setChartSide(item)}
                          className={`rounded-md border px-2 py-1.5 text-xs font-black transition ${
                            chartSide === item
                              ? "border-solPurple/50 bg-solPurple/20 text-white shadow-glow"
                              : "border-line bg-black/30 text-muted hover:text-white"
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-slate-400">
                      {timeframe} range · {chartSide === "BOTH" ? "YES/NO" : chartSide} line
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex gap-2">
                <span className="price-pill yes">YES {formatPrice(yesPrice)}</span>
                <span className="price-pill no">NO {formatPrice(noPrice)}</span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-black/25 p-1 text-xs">
                {overviewTimeframes.map((item) => (
                  <button
                    key={item}
                    onClick={() => setTimeframe(item)}
                    className={`rounded-md px-2.5 py-1 font-black transition ${timeframe === item ? "bg-solPurple/20 text-white shadow-glow" : "text-muted hover:text-white"}`}
                  >
                    {item}
                  </button>
                ))}
                <button
                  onClick={() => setChartSide(nextChartSide(chartSide))}
                  className="ml-1 grid h-7 w-8 place-items-center rounded-md border border-solPurple/45 text-violet-200 transition hover:bg-solPurple/15"
                  aria-label="Switch chart curve"
                  title={`Chart: ${chartSide}`}
                >
                  <Activity size={14} />
                </button>
              </div>
            </div>
            <ProbabilityBar probability={yesPrice} />
            <div className="mt-3 min-h-0 flex-1">
              <ProbabilityChart market={selected} compact side={chartSide} timeframe={timeframe} />
            </div>
            <div className="mt-3 grid grid-cols-6 divide-x divide-line rounded-lg border border-line bg-black/20">
              <Metric label="Last Price" value={formatPrice(yesPrice)} strong />
              <Metric label="24h Change" value={`${selected.change24h >= 0 ? "+" : "-"}${Math.abs(selected.change24h * 100).toFixed(1)}%`} positive={selected.change24h >= 0} />
              <Metric label="High (24h)" value={formatPrice(Math.min(0.98, yesPrice + 0.035))} />
              <Metric label="Low (24h)" value={formatPrice(Math.max(0.02, yesPrice - 0.041))} />
              <Metric label="Volume (24h)" value={`$${(selected.volume24h / 1_000_000).toFixed(2)}M`} />
              <Metric label="Liquidity" value={formatSol(selected.totalLiquidity)} />
            </div>
          </article>
        ) : null}

        <article className="terminal-panel min-h-0 overflow-hidden p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Positions ({positions.length})</h2>
            <span className="text-xs text-muted">{positions.length} open</span>
          </div>
          <PositionTable positions={positions.slice(0, 5)} markets={markets} compact />
        </article>
      </section>

      <aside className="h-full min-h-0 overflow-hidden">
        {selected ? <TradePanel market={selected} /> : null}
      </aside>

      <aside className="h-full min-h-0 overflow-hidden">
        <section className="terminal-panel flex h-full min-h-0 flex-col overflow-hidden p-3.5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold">
              <Bot size={17} className="text-solPurple" /> Agent Activity
            </h2>
            <span className="live-badge flex items-center gap-2 rounded border border-yes/20 bg-yes/10 px-2 py-1 text-xs text-yes">
              <Flame size={13} /> Live
            </span>
          </div>
          <button className="mb-3 flex h-9 items-center justify-between rounded-lg border border-line bg-black/25 px-3 text-xs text-slate-300">
            All Agents <ChevronDown size={13} className="text-muted" />
          </button>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentActivityFeed activity={activity.slice(0, 20)} markets={markets} />
          </div>
          <Link href="/agents" className="mt-3 flex items-center justify-between rounded-lg border border-line bg-black/25 px-3 py-2 text-xs text-muted transition hover:border-solBlue/40 hover:text-white">
            <span>View All Activity</span>
            <ArrowRight size={13} />
          </Link>
        </section>
      </aside>
    </div>
  );
}

function featuredRank(id: string) {
  const index = featuredOrder.indexOf(id);
  return index === -1 ? featuredOrder.length : index;
}

function nextChartSide(side: Side | "BOTH"): Side | "BOTH" {
  if (side === "BOTH") return "YES";
  if (side === "YES") return "NO";
  return "BOTH";
}

function Metric({ label, value, strong, positive }: { label: string; value: string; strong?: boolean; positive?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-xs text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${strong ? "text-yes" : positive === undefined ? "text-slate-100" : positive ? "text-yes" : "text-no"}`}>{value}</div>
    </div>
  );
}
