"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, ArrowLeft, Bot, Clock3, Droplets, ImagePlus, Loader2, Pencil, Radio, RefreshCw, Save, UsersRound, X } from "lucide-react";
import { TradingViewKlineChart, type ChartTimeframe } from "@/components/charts/TradingViewKlineChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { TradePanel } from "@/components/trade/TradePanel";
import { fetchTrades } from "@/lib/backendApi";
import { formatPercent, formatPrice, formatSol, probability, timeRemaining } from "@/lib/format";
import type { AgentActivity, Market, Side, Trade } from "@/lib/types";
import { RouterLink as Link, useParams } from "@/router";

const timeframes: ChartTimeframe[] = ["1H", "1D", "1W", "ALL"];
const tradeFilters = ["ALL", "YES", "NO"] as const;
const categories: Market["category"][] = ["Crypto", "Politics", "Sports", "Tech", "Macro", "On-chain"];

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const { markets, activity, isLoading, error, backendEnabled, dataSource, refresh } = useMarkets();
  const { publicKey } = useWallet();
  const [chartSide, setChartSide] = useState<Side>("YES");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [tradeFilter, setTradeFilter] = useState<(typeof tradeFilters)[number]>("ALL");

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const market = markets.find((item) => item.id === id);
  const marketActivity = useMemo(() => (market ? activity.filter((item) => item.marketId === market.id) : []), [activity, market]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesCursor, setTradesCursor] = useState("");
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesLoadingMore, setTradesLoadingMore] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [tradesRefreshToken, setTradesRefreshToken] = useState(0);

  useEffect(() => {
    if (!market || !backendEnabled) {
      setTrades([]);
      setTradesCursor("");
      setTradesError(null);
      setTradesLoading(false);
      return;
    }

    let cancelled = false;
    setTradesLoading(true);
    setTradesError(null);
    fetchTrades({ marketId: market.id, limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setTrades(page.trades);
        setTradesCursor(page.nextCursor ?? "");
      })
      .catch((error) => {
        if (!cancelled) setTradesError(error instanceof Error ? error.message : "Trade history unavailable.");
      })
      .finally(() => {
        if (!cancelled) setTradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backendEnabled, market?.id, activity.length, tradesRefreshToken]);

  useEffect(() => {
    function handleTradesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ marketId?: string }>).detail;
      if (!detail?.marketId || detail.marketId === market?.id) {
        setTradesRefreshToken((token) => token + 1);
      }
    }

    window.addEventListener("probx:trades-updated", handleTradesUpdated);
    return () => window.removeEventListener("probx:trades-updated", handleTradesUpdated);
  }, [market?.id]);

  const recentTrades = useMemo(() => {
    if (backendEnabled) return tradeFilter === "ALL" ? trades : trades.filter((trade) => trade.side === tradeFilter);
    const tradeActivity = marketActivity.filter(isTradeActivity);
    const localTrades = tradeFilter === "ALL" ? tradeActivity : tradeActivity.filter((trade) => trade.side === tradeFilter);
    return localTrades.map((trade) => ({
      id: trade.id,
      owner: trade.agent,
      marketId: trade.marketId,
      side: trade.side,
      action: trade.action,
      amountSol: trade.size / 1000,
      price: trade.confidence / 100,
      signature: "local",
      status: "local",
      createdAt: trade.timestamp
    })) satisfies Trade[];
  }, [backendEnabled, marketActivity, tradeFilter, trades]);

  async function loadMoreTrades() {
    if (!market || !tradesCursor || tradesLoadingMore) return;
    setTradesLoadingMore(true);
    setTradesError(null);
    try {
      const page = await fetchTrades({ marketId: market.id, limit: 50, cursor: tradesCursor });
      setTrades((current) => [...current, ...page.trades]);
      setTradesCursor(page.nextCursor ?? "");
    } catch (error) {
      setTradesError(error instanceof Error ? error.message : "Trade history unavailable.");
    } finally {
      setTradesLoadingMore(false);
    }
  }

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
  const canEditMetadata = !backendEnabled || publicKey?.toBase58() === market.creator;

  return (
    <div className="grid min-h-full grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_clamp(330px,23vw,390px)]">
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

        <MetadataPanel market={market} canEdit={canEditMetadata} />

        <section className="terminal-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">TradingView K-Line</h2>
              <p className="text-xs text-muted">
                {dataSource === "api" ? "Candles built from indexed market probability history." : "Candles built from local preview probability history."}
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
          <TradingViewKlineChart market={market} side={chartSide} timeframe={timeframe} />
        </section>

        <section className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
          <StatCard label="Total Liquidity" value={formatSol(market.totalLiquidity)} icon={<Droplets size={16} />} />
          <StatCard label="24h Volume" value={`$${(market.volume24h / 1_000_000).toFixed(2)}M`} icon={<Radio size={16} />} />
          <StatCard label="Participants" value={market.participants.toLocaleString()} icon={<UsersRound size={16} />} />
          <StatCard label="Current YES" value={formatPercent(yesProbability)} icon={<Bot size={16} />} />
        </section>

        <ResolverPanel market={market} />

        <section className="terminal-panel flex min-h-0 flex-col overflow-hidden">
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
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-950/80 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Status</th>
                  <th className="px-4 py-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {tradesLoading ? (
                  <tr className="border-t border-line bg-slate-950/30">
                    <td colSpan={5} className="px-4 py-10 text-center text-muted">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin text-solBlue" />
                      Loading trade history
                    </td>
                  </tr>
                ) : null}
                {!recentTrades.length ? (
                  <tr className="border-t border-line bg-slate-950/30">
                    <td colSpan={5} className="px-4 py-10 text-center">
                      <p className="font-bold text-slate-200">No indexed trades yet</p>
                      <p className="mt-1 text-sm text-muted">Trades will appear here after the API records market activity.</p>
                    </td>
                  </tr>
                ) : null}
                {recentTrades.map((trade) => (
                  <tr key={trade.id} className="border-t border-line bg-slate-950/30">
                    <td className={trade.side === "YES" ? "px-4 py-3 font-black text-yes" : "px-4 py-3 font-black text-no"}>
                      {trade.action} {trade.side}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">{formatSol(trade.amountSol, 3)}</td>
                    <td className="px-4 py-3 text-right">{formatPrice(trade.price)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={trade.status === "confirmed" ? "rounded border border-yes/30 bg-yes/10 px-2 py-1 text-xs font-bold text-yes" : "rounded border border-solBlue/30 bg-solBlue/10 px-2 py-1 text-xs font-bold text-solBlue"}>
                        {trade.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted">{relativeTime(trade.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tradesError ? <div className="border-t border-line px-4 py-3 text-sm text-no">{tradesError}</div> : null}
            {backendEnabled && tradesCursor ? (
              <div className="border-t border-line px-4 py-3 text-center">
                <button
                  onClick={loadMoreTrades}
                  disabled={tradesLoadingMore}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-black/25 px-4 py-2 text-xs font-bold text-slate-200 transition hover:border-solBlue/50 disabled:opacity-60"
                >
                  {tradesLoadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <aside className="h-full min-h-0 overflow-hidden">
        <TradePanel market={market} />
      </aside>
    </div>
  );
}

function ResolverPanel({ market }: { market: Market }) {
  const { resolve, backendEnabled } = useMarkets();
  const [pending, setPending] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasEnded = market.endTime <= Math.floor(Date.now() / 1000);

  if (!hasEnded && !market.resolved) return null;

  async function submit(outcome: 0 | 1) {
    setMessage(null);
    setPending(outcome);
    try {
      const signature = await resolve(market.id, outcome);
      setMessage(
        signature === "local"
          ? "Market resolved locally."
          : signature === "indexed"
            ? "Market resolved in ProbX API."
            : `Resolve tx sent: ${signature.slice(0, 12)}...`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Resolve failed.");
    } finally {
      setPending(null);
    }
  }

  if (market.resolved) {
    const outcome = market.outcome === 1 ? "YES" : "NO";
    return (
      <section className="terminal-panel flex items-center justify-between gap-4 p-4">
        <div>
          <h2 className="font-black">Resolution</h2>
          <p className="mt-1 text-sm text-muted">This market is settled as {outcome}.</p>
        </div>
        <span className={outcome === "YES" ? "rounded-lg border border-yes/30 bg-yes/10 px-4 py-2 font-black text-yes" : "rounded-lg border border-no/30 bg-no/10 px-4 py-2 font-black text-no"}>
          {outcome}
        </span>
      </section>
    );
  }

  return (
    <section className="terminal-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <h2 className="font-black">Resolve Market</h2>
        <p className="mt-1 text-sm text-muted">
          {backendEnabled ? "Submit the final outcome to the ProbX API index." : "Set the final outcome for the local preview workspace."}
        </p>
        {message ? <p className="mt-2 text-sm text-slate-300">{message}</p> : null}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => submit(1)}
          disabled={pending !== null}
          className="rounded-lg border border-yes/35 bg-yes/10 px-4 py-2 text-sm font-black text-yes transition hover:bg-yes/20 disabled:opacity-60"
        >
          {pending === 1 ? "Resolving..." : "Resolve YES"}
        </button>
        <button
          onClick={() => submit(0)}
          disabled={pending !== null}
          className="rounded-lg border border-no/35 bg-no/10 px-4 py-2 text-sm font-black text-no transition hover:bg-no/20 disabled:opacity-60"
        >
          {pending === 0 ? "Resolving..." : "Resolve NO"}
        </button>
      </div>
    </section>
  );
}

function MetadataPanel({ market, canEdit }: { market: Market; canEdit: boolean }) {
  const { updateMarketMetadata, backendEnabled } = useMarkets();
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<Market["category"]>(market.category);
  const [avatarUrl, setAvatarUrl] = useState(market.avatarUrl ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setCategory(market.category);
    setAvatarUrl(market.avatarUrl ?? "");
    setMessage(null);
    setEditing(false);
  }, [market.id, market.category, market.avatarUrl]);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await updateMarketMetadata(market.id, {
        category,
        avatarUrl: avatarUrl.trim() || undefined
      });
      setMessage(backendEnabled ? "Metadata updated." : "Metadata updated locally.");
      setEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Metadata update failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="terminal-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-black">Market Metadata</h2>
          <p className="mt-1 text-sm text-muted">Category and avatar used by the indexed product UI.</p>
        </div>
        {canEdit ? (
          <button
            onClick={() => setEditing((value) => !value)}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-black/25 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-solBlue/50"
            type="button"
          >
            {editing ? <X size={14} /> : <Pencil size={14} />}
            {editing ? "Cancel" : "Edit"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1 text-xs text-muted">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as Market["category"])}
              className="h-10 rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-xs text-muted">
            Avatar URL
            <span className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-line bg-black/35 px-3">
              <ImagePlus size={15} className="shrink-0 text-muted" />
              <input
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-100 outline-none"
                placeholder="https://..."
              />
            </span>
          </label>
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-yes/35 bg-yes/10 px-4 text-sm font-black text-yes transition hover:bg-yes/20 disabled:opacity-60"
            type="button"
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded border border-solPurple/40 bg-solPurple/10 px-2 py-1 font-bold text-violet-200">{market.category}</span>
          <span className="min-w-0 truncate text-muted">{market.avatarUrl ? market.avatarUrl : "No custom avatar"}</span>
        </div>
      )}

      {message ? <p className="mt-3 rounded-lg border border-line bg-black/25 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
    </section>
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

function isTradeActivity(item: AgentActivity): item is AgentActivity & { action: "BUY" | "SELL" } {
  return item.action === "BUY" || item.action === "SELL";
}
