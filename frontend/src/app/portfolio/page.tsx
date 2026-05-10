"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, ArrowDownUp, BadgeDollarSign, Landmark, Loader2, RefreshCw, ScrollText, WalletCards } from "lucide-react";
import { PnLChart } from "@/components/charts/ProbabilityChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { useMarkets } from "@/components/market/MarketProvider";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { fetchTrades } from "@/lib/backendApi";
import { formatPercent, formatPrice, formatSol, probability, relativeTime } from "@/lib/format";
import type { AgentActivity, Position, Side, Trade } from "@/lib/types";

type SortKey = "pnl" | "size" | "market";
type MainTab = "positions" | "trades";

export default function PortfolioPage() {
  const { markets, positions, activity, isLoading, error, backendEnabled, refresh } = useMarkets();
  const { publicKey } = useWallet();
  const ownerId = publicKey?.toBase58() ?? "local";
  const [sortKey, setSortKey] = useState<SortKey>("pnl");
  const [mainTab, setMainTab] = useState<MainTab>("positions");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesCursor, setTradesCursor] = useState("");
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesLoadingMore, setTradesLoadingMore] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [tradesRefreshToken, setTradesRefreshToken] = useState(0);

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
  const localTrades = useMemo<Trade[]>(() => {
    return activity
      .filter(isTradeActivity)
      .map((trade) => ({
        id: trade.id,
        owner: trade.agent,
        marketId: trade.marketId,
        side: trade.side,
        action: trade.action,
        amountSol: trade.size / 1000,
        netAmountSol: trade.size / 1000,
        protocolFeeSol: 0,
        price: trade.confidence / 100,
        signature: "local",
        status: "local",
        createdAt: trade.timestamp
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [activity]);
  const portfolioTrades = backendEnabled ? trades : localTrades;

  useEffect(() => {
    if (!backendEnabled) {
      setTrades([]);
      setTradesCursor("");
      setTradesError(null);
      setTradesLoading(false);
      return;
    }

    let cancelled = false;
    setTradesLoading(true);
    setTradesError(null);
    fetchTrades({ owner: ownerId, limit: 50 })
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
  }, [backendEnabled, ownerId, tradesRefreshToken]);

  useEffect(() => {
    function handleTradesUpdated() {
      setTradesRefreshToken((token) => token + 1);
    }

    window.addEventListener("probx:trades-updated", handleTradesUpdated);
    return () => window.removeEventListener("probx:trades-updated", handleTradesUpdated);
  }, []);

  async function loadMoreTrades() {
    if (!tradesCursor || tradesLoadingMore) return;
    setTradesLoadingMore(true);
    setTradesError(null);
    try {
      const page = await fetchTrades({ owner: ownerId, limit: 50, cursor: tradesCursor });
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
              <p className="text-sm text-muted">Open positions, claimable markets, and your indexed trade history.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-line bg-black/25 p-1">
                {(["positions", "trades"] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setMainTab(item)}
                    className={`rounded-md px-3 py-1.5 text-xs font-black uppercase transition ${
                      mainTab === item ? "bg-solBlue/20 text-white shadow-glow" : "text-muted hover:text-white"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              {mainTab === "positions" ? (
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
              ) : (
                <button
                  onClick={() => setTradesRefreshToken((token) => token + 1)}
                  disabled={tradesLoading}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-black/25 px-3 text-xs font-black uppercase text-slate-200 transition hover:border-solBlue/50 disabled:opacity-60"
                >
                  <RefreshCw size={13} className={tradesLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
              )}
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
            {mainTab === "positions" ? (
              <PositionTable positions={sorted} markets={markets} />
            ) : (
              <PortfolioTradeHistory
                trades={portfolioTrades}
                markets={markets}
                loading={tradesLoading}
                loadingMore={tradesLoadingMore}
                error={tradesError}
                hasMore={backendEnabled && Boolean(tradesCursor)}
                onLoadMore={loadMoreTrades}
              />
            )}
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

function PortfolioTradeHistory({
  trades,
  markets,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore
}: {
  trades: Trade[];
  markets: { id: string; question: string }[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-950/80 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3 text-left">Market</th>
            <th className="px-4 py-3 text-left">Side</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-right">Status</th>
            <th className="px-4 py-3 text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr className="border-t border-line bg-slate-950/35">
              <td colSpan={6} className="px-4 py-10 text-center text-muted">
                <Loader2 size={18} className="mx-auto mb-2 animate-spin text-solBlue" />
                Loading your trade history
              </td>
            </tr>
          ) : null}
          {!loading && !trades.length ? (
            <tr className="border-t border-line bg-slate-950/35">
              <td colSpan={6} className="px-4 py-10 text-center">
                <ScrollText size={20} className="mx-auto mb-2 text-muted" />
                <p className="font-bold text-slate-200">No trades yet</p>
                <p className="mt-1 text-sm text-muted">Your completed buys and sells will appear here after the API records them.</p>
              </td>
            </tr>
          ) : null}
          {trades.map((trade) => {
            const market = markets.find((item) => item.id === trade.marketId);
            return (
              <tr key={trade.id} className="border-t border-line bg-slate-950/35 transition hover:bg-slate-900/60">
                <td className="max-w-[420px] px-4 py-3">
                  <div className="truncate font-semibold text-white">{market?.question ?? trade.marketId}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{shortSignature(trade.signature)}</div>
                </td>
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
            );
          })}
        </tbody>
      </table>
      {error ? <div className="border-t border-line px-4 py-3 text-sm text-no">{error}</div> : null}
      {hasMore ? (
        <div className="border-t border-line px-4 py-3 text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-black/25 px-4 py-2 text-xs font-bold text-slate-200 transition hover:border-solBlue/50 disabled:opacity-60"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatSignedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function shortSignature(signature: string) {
  if (signature === "local" || signature === "indexed") return signature;
  if (signature.length <= 16) return signature;
  return `${signature.slice(0, 8)}...${signature.slice(-6)}`;
}

function isTradeActivity(item: AgentActivity): item is AgentActivity & { action: "BUY" | "SELL"; side: Side } {
  return (item.action === "BUY" || item.action === "SELL") && (item.side === "YES" || item.side === "NO");
}
