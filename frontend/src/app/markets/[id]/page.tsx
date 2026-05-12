"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, ArrowLeft, Bot, Clock3, Droplets, Loader2, Pencil, Radio, RefreshCw, Save, ShieldAlert, UsersRound, WalletCards, X } from "lucide-react";
import { TransactionProgressModal, type TransactionProgressState } from "@/components/chain/TransactionProgress";
import { MarketMediaPicker } from "@/components/market/MarketMediaPicker";
import { TradingViewKlineChart, type ChartTimeframe } from "@/components/charts/TradingViewKlineChart";
import { ProbabilityBar } from "@/components/market/ProbabilityBar";
import { type ActionConfirmationState, useMarkets } from "@/components/market/MarketProvider";
import { TradePanel } from "@/components/trade/TradePanel";
import { fetchTrades } from "@/lib/backendApi";
import { formatPercent, formatPrice, formatSol, probability, relativeTime, timeRemaining } from "@/lib/format";
import { getRuntimeConfig } from "@/lib/runtimeConfig";
import type { AgentActivity, Market, Side, Trade } from "@/lib/types";
import { RouterLink as Link, useParams } from "@/router";

const timeframes: ChartTimeframe[] = ["1H", "1D", "1W", "ALL"];
const tradeFilters = ["ALL", "YES", "NO"] as const;
const categories: Market["category"][] = ["Crypto", "Politics", "Sports", "Tech", "Macro", "On-chain"];

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const { markets, activity, isLoading, error, backendEnabled, refresh } = useMarkets();
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
      netAmountSol: trade.size / 1000,
      protocolFeeSol: 0,
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
        eyebrow="Service error"
        title="ProbX is unavailable"
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
    <div className="grid min-h-full w-full max-w-[calc(100vw-20px)] grid-cols-1 gap-3 md:max-w-none xl:grid-cols-[minmax(0,1fr)_clamp(330px,23vw,390px)]">
      <main className="flex min-h-0 w-full min-w-0 max-w-full flex-col gap-3">
        <section className="terminal-panel w-full min-w-0 max-w-full overflow-hidden p-4 sm:p-5">
          <div className="mb-4 flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-5">
            <div className="min-w-0">
              <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-solBlue">
                <ArrowLeft size={16} /> Markets
              </Link>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="rounded border border-solPurple/40 bg-solPurple/10 px-2 py-1 text-violet-200">{market.category}</span>
                <span className="flex items-center gap-1">
                  <Clock3 size={13} /> Ends in {timeRemaining(market.endTime)}
                </span>
              </div>
              <h1 className="max-w-5xl break-words text-2xl font-black leading-tight sm:text-3xl">{market.question}</h1>
            </div>
            <div className="min-w-0 rounded-lg border border-yes/30 bg-yes/10 px-4 py-3 shadow-yes md:shrink-0 md:px-5 md:py-4 md:text-right">
              <div className="text-4xl font-black text-yes md:text-5xl">{formatPrice(activePrice)}</div>
              <div className="mt-1 text-xs uppercase text-muted">{chartSide} probability</div>
            </div>
          </div>

          <ProbabilityBar probability={yesProbability} />
        </section>

        <MetadataPanel market={market} canEdit={canEditMetadata} />

        <section className="terminal-panel w-full min-w-0 max-w-full overflow-hidden p-4">
          <div className="mb-4 flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 className="text-lg font-black">TradingView K-Line</h2>
              <p className="text-xs text-muted">Candles built from market probability history.</p>
            </div>
            <div className="grid gap-2 sm:flex sm:items-center">
              <div className="grid grid-cols-2 rounded-lg border border-line bg-black/25 p-1 sm:flex">
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
              <div className="grid grid-cols-4 rounded-lg border border-line bg-black/25 p-1 sm:flex">
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

        <section className="grid w-full min-w-0 max-w-full grid-cols-2 gap-3 2xl:grid-cols-4">
          <StatCard label="Total Liquidity" value={formatSol(market.totalLiquidity)} icon={<Droplets size={16} />} />
          <StatCard label="24h Volume" value={`$${(market.volume24h / 1_000_000).toFixed(2)}M`} icon={<Radio size={16} />} />
          <StatCard label="Participants" value={market.participants.toLocaleString()} icon={<UsersRound size={16} />} />
          <StatCard label="Current YES" value={formatPercent(yesProbability)} icon={<Bot size={16} />} />
        </section>

        <ResolverPanel market={market} />
        <ResidualPanel market={market} />

        <section className="terminal-panel flex min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden">
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
            <div className="grid gap-2 p-2 md:hidden">
              {tradesLoading ? (
                <div className="rounded-lg bg-slate-950/30 px-4 py-10 text-center text-muted">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin text-solBlue" />
                  Loading trade history
                </div>
              ) : null}
              {!recentTrades.length ? (
                <div className="rounded-lg bg-slate-950/30 px-4 py-10 text-center">
                  <p className="font-bold text-slate-200">No indexed trades yet</p>
                  <p className="mt-1 text-sm text-muted">Trades will appear here after the API records market activity.</p>
                </div>
              ) : null}
              {recentTrades.map((trade) => (
                <article key={trade.id} className="rounded-lg border border-line bg-slate-950/30 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className={trade.side === "YES" ? "font-black text-yes" : "font-black text-no"}>
                      {trade.action} {trade.side}
                    </span>
                    <span className={trade.status === "confirmed" ? "rounded border border-yes/30 bg-yes/10 px-2 py-1 text-xs font-bold text-yes" : "rounded border border-solBlue/30 bg-solBlue/10 px-2 py-1 text-xs font-bold text-solBlue"}>
                      {trade.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <MobileTradeStat label="Amount" value={formatSol(trade.amountSol, 3)} strong />
                    <MobileTradeStat label="Fee" value={formatSol(trade.protocolFeeSol || 0, 4)} />
                    <MobileTradeStat label="Price" value={formatPrice(trade.price)} />
                    <MobileTradeStat label="Time" value={relativeTime(trade.createdAt)} />
                  </div>
                </article>
              ))}
            </div>
            <table className="hidden w-full border-collapse text-sm md:table">
              <thead className="bg-slate-950/80 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Fee</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Status</th>
                  <th className="px-4 py-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {tradesLoading ? (
                  <tr className="border-t border-line bg-slate-950/30">
                    <td colSpan={6} className="px-4 py-10 text-center text-muted">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin text-solBlue" />
                      Loading trade history
                    </td>
                  </tr>
                ) : null}
                {!recentTrades.length ? (
                  <tr className="border-t border-line bg-slate-950/30">
                    <td colSpan={6} className="px-4 py-10 text-center">
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
                    <td className="px-4 py-3 text-right text-muted">{formatSol(trade.protocolFeeSol || 0, 4)}</td>
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

      <aside className="min-h-[560px] overflow-hidden xl:h-full xl:min-h-0">
        <TradePanel market={market} />
      </aside>
    </div>
  );
}

function ResolverPanel({ market }: { market: Market }) {
  const { resolve, cancelMarket, setMarketResolver, waitForActionConfirmation, backendEnabled } = useMarkets();
  const { publicKey } = useWallet();
  const runtimeConfig = useMemo(() => getRuntimeConfig(), []);
  const [pending, setPending] = useState<0 | 1 | "cancel" | "resolver" | null>(null);
  const [newResolver, setNewResolver] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [chainProgress, setChainProgress] = useState<TransactionProgressState | null>(null);
  const hasEnded = market.endTime <= Math.floor(Date.now() / 1000);
  const walletKey = publicKey?.toBase58() ?? "";
  const canGovern = !backendEnabled || walletKey === market.resolver;

  if (!canGovern && !hasEnded && !market.resolved) return null;

  async function submit(outcome: 0 | 1) {
    setMessage(null);
    setChainProgress(null);
    setPending(outcome);
    try {
      const signature = await resolve(market.id, outcome);
      if (signature !== "local" && signature !== "indexed") {
        setChainProgress({
          title: `Resolve ${outcome === 1 ? "YES" : "NO"}`,
          phase: "confirming",
          signature,
          message: "Transaction broadcasted. Waiting for confirmation and ProbX indexing."
        });
        setMessage(`Resolve tx sent: ${signature.slice(0, 12)}... waiting for indexer.`);
        const confirmation = await waitForActionConfirmation(signature, { eventType: "MarketResolved", marketId: market.id });
        setChainProgress(actionProgressState(`Resolve ${outcome === 1 ? "YES" : "NO"}`, signature, confirmation, "Resolution"));
        setMessage(actionStatusMessage("Resolve", signature, confirmation));
        return;
      }
      setMessage(
        signature === "local"
          ? "Market resolved locally."
          : "Market resolved in ProbX API."
      );
    } catch (error) {
      setChainProgress(null);
      setMessage(error instanceof Error ? error.message : "Resolve failed.");
    } finally {
      setPending(null);
    }
  }

  async function submitCancel() {
    setMessage(null);
    setChainProgress(null);
    setPending("cancel");
    try {
      const signature = await cancelMarket(market.id);
      if (signature !== "local" && signature !== "indexed") {
        setChainProgress({
          title: "Cancel Market",
          phase: "confirming",
          signature,
          message: "Transaction broadcasted. Waiting for confirmation and ProbX indexing."
        });
        setMessage(`Cancel tx sent: ${signature.slice(0, 12)}... waiting for indexer.`);
        const confirmation = await waitForActionConfirmation(signature, { eventType: "MarketCancelled", marketId: market.id });
        setChainProgress(actionProgressState("Cancel Market", signature, confirmation, "Cancellation"));
        setMessage(actionStatusMessage("Cancel", signature, confirmation));
        return;
      }
      setMessage(signature === "local" ? "Market cancelled locally." : "Market cancelled in ProbX API.");
    } catch (error) {
      setChainProgress(null);
      setMessage(error instanceof Error ? error.message : "Cancel failed.");
    } finally {
      setPending(null);
    }
  }

  async function submitResolver() {
    setMessage(null);
    setChainProgress(null);
    setPending("resolver");
    try {
      const signature = await setMarketResolver(market.id, newResolver);
      if (signature !== "local" && signature !== "indexed") {
        setChainProgress({
          title: "Set Resolver",
          phase: "confirming",
          signature,
          message: "Transaction broadcasted. Waiting for confirmation and ProbX indexing."
        });
        setMessage(`Resolver tx sent: ${signature.slice(0, 12)}... waiting for indexer.`);
        const confirmation = await waitForActionConfirmation(signature, { eventType: "MarketResolverUpdated", marketId: market.id });
        setChainProgress(actionProgressState("Set Resolver", signature, confirmation, "Resolver update"));
        setMessage(actionStatusMessage("Resolver update", signature, confirmation));
        setNewResolver("");
        return;
      }
      setMessage(signature === "local" ? "Resolver updated locally." : "Resolver updated in ProbX API.");
      setNewResolver("");
    } catch (error) {
      setChainProgress(null);
      setMessage(error instanceof Error ? error.message : "Resolver update failed.");
    } finally {
      setPending(null);
    }
  }

  if (market.resolved) {
    const outcome = market.outcome === 2 ? "VOID" : market.outcome === 1 ? "YES" : "NO";
    return (
      <section className="terminal-panel flex items-center justify-between gap-4 p-4">
        <div>
          <h2 className="font-black">Resolution</h2>
          <p className="mt-1 text-sm text-muted">
            {outcome === "VOID" ? "This market was cancelled. Positions can be refunded." : `This market is settled as ${outcome}.`}
          </p>
        </div>
        <span className={outcome === "YES" ? "rounded-lg border border-yes/30 bg-yes/10 px-4 py-2 font-black text-yes" : outcome === "NO" ? "rounded-lg border border-no/30 bg-no/10 px-4 py-2 font-black text-no" : "rounded-lg border border-line bg-white/5 px-4 py-2 font-black text-slate-200"}>
          {outcome}
        </span>
      </section>
    );
  }

  return (
    <section className="terminal-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <TransactionProgressModal
        state={chainProgress}
        explorerCluster={runtimeConfig.explorerCluster}
        onClose={() => setChainProgress(null)}
      />
      <div>
        <h2 className="font-black">Settlement Governance</h2>
        <p className="mt-1 text-sm text-muted">
          Current resolver: <span className="font-mono text-slate-300">{market.resolver ? `${market.resolver.slice(0, 6)}...${market.resolver.slice(-4)}` : "creator"}</span>
        </p>
        {message ? <p className="mt-2 text-sm text-slate-300">{message}</p> : null}
      </div>
      <div className="grid gap-2">
        {canGovern ? (
          <div className="flex flex-wrap justify-end gap-2">
            {hasEnded ? (
              <>
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
              </>
            ) : null}
            <button
              onClick={submitCancel}
              disabled={pending !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-200 transition hover:bg-amber-300/20 disabled:opacity-60"
            >
              {pending === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
              {pending === "cancel" ? "Cancelling..." : "Cancel / Void"}
            </button>
          </div>
        ) : null}
        {canGovern ? (
          <div className="flex min-w-0 gap-2">
            <input
              value={newResolver}
              onChange={(event) => setNewResolver(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-black/35 px-3 text-sm font-bold text-slate-100 outline-none"
              placeholder="New resolver public key"
            />
            <button
              onClick={submitResolver}
              disabled={pending !== null || !newResolver.trim()}
              className="rounded-lg border border-solBlue/35 bg-solBlue/10 px-4 py-2 text-sm font-black text-solBlue transition hover:bg-solBlue/20 disabled:opacity-60"
            >
              {pending === "resolver" ? "Updating..." : "Set Resolver"}
            </button>
          </div>
        ) : (
          <p className="text-right text-sm text-muted">{hasEnded ? "Connect the resolver wallet to settle this market." : "Resolver controls settlement after close."}</p>
        )}
      </div>
    </section>
  );
}

function ResidualPanel({ market }: { market: Market }) {
  const { withdrawResidual, waitForActionConfirmation, backendEnabled, positions } = useMarkets();
  const { publicKey } = useWallet();
  const runtimeConfig = useMemo(() => getRuntimeConfig(), []);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [chainProgress, setChainProgress] = useState<TransactionProgressState | null>(null);
  const walletKey = publicKey?.toBase58() ?? "";
  const canWithdraw = !backendEnabled || walletKey === market.creator;
  const outstanding = useMemo(() => {
    if (!market.resolved || market.outcome === undefined) return 0;
    return positions
      .filter((position) => {
        if (position.marketId !== market.id || position.resolved || position.size <= 0) return false;
        if (market.outcome === 2) return true;
        return position.side === (market.outcome === 1 ? "YES" : "NO");
      })
      .reduce((total, position) => total + position.size, 0);
  }, [market.id, market.outcome, market.resolved, positions]);
  const ready = market.resolved && !market.residualClaimed && market.totalLiquidity > 0 && outstanding <= 1e-9;

  if (!market.resolved && !canWithdraw) return null;

  async function submit() {
    setPending(true);
    setMessage(null);
    setChainProgress(null);
    try {
      const signature = await withdrawResidual(market.id);
      if (signature !== "local" && signature !== "indexed") {
        setChainProgress({
          title: "Withdraw Residual",
          phase: "confirming",
          signature,
          message: "Transaction broadcasted. Waiting for confirmation and ProbX indexing."
        });
        setMessage(`Withdrawal tx sent: ${signature.slice(0, 12)}... waiting for indexer.`);
        const confirmation = await waitForActionConfirmation(signature, { eventType: "ResidualWithdrawn", marketId: market.id });
        setChainProgress(actionProgressState("Withdraw Residual", signature, confirmation, "Withdrawal"));
        setMessage(actionStatusMessage("Withdrawal", signature, confirmation));
        return;
      }
      setMessage(signature === "local" ? "Residual withdrawal updated locally." : "Residual withdrawal saved.");
    } catch (error) {
      setChainProgress(null);
      setMessage(error instanceof Error ? error.message : "Residual withdrawal failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="terminal-panel grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <TransactionProgressModal
        state={chainProgress}
        explorerCluster={runtimeConfig.explorerCluster}
        onClose={() => setChainProgress(null)}
      />
      <div>
        <h2 className="flex items-center gap-2 font-black"><WalletCards size={16} className="text-solBlue" /> Funds Economics</h2>
        <p className="mt-1 text-sm text-muted">
          Fee {((market.protocolFeeBps || 0) / 100).toFixed(2)}%, treasury {shortAddress(market.treasury || market.creator)}, creator LP {formatSol(market.creatorLpShares || 0, 4)}.
        </p>
        <p className="mt-1 text-sm text-muted">
          Residual: {market.residualClaimed ? `claimed ${formatSol(market.residualWithdrawn || 0, 4)}` : formatSol(market.totalLiquidity || 0, 4)}
          {outstanding > 0 ? `, outstanding claims ${outstanding.toFixed(4)}` : ""}
        </p>
        {message ? <p className="mt-2 text-sm text-slate-300">{message}</p> : null}
      </div>
      {canWithdraw ? (
        <button
          onClick={submit}
          disabled={!ready || pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-solBlue/35 bg-solBlue/10 px-4 py-2 text-sm font-black text-solBlue transition hover:bg-solBlue/20 disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <WalletCards size={14} />}
          {market.residualClaimed ? "Residual Claimed" : "Withdraw Residual"}
        </button>
      ) : (
        <p className="text-right text-sm text-muted">Creator wallet controls residual withdrawal.</p>
      )}
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
        <div className="mt-4 grid gap-3">
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
          <MarketMediaPicker value={avatarUrl} onChange={setAvatarUrl} />
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
    <article className="terminal-panel p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between text-muted">
        <span className="text-xs uppercase">{label}</span>
        <span className="text-solBlue">{icon}</span>
      </div>
      <div className="truncate text-xl font-black sm:text-2xl">{value}</div>
    </article>
  );
}

function MobileTradeStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-black/20 px-2.5 py-2">
      <div className="text-[11px] uppercase text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${strong ? "text-white" : "text-slate-200"}`}>{value}</div>
    </div>
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

function isTradeActivity(item: AgentActivity): item is AgentActivity & { action: "BUY" | "SELL"; side: Side } {
  return (item.action === "BUY" || item.action === "SELL") && (item.side === "YES" || item.side === "NO");
}

function actionProgressState(
  title: string,
  signature: string,
  confirmation: ActionConfirmationState,
  noun: string
): TransactionProgressState {
  const confirmed = confirmation === "confirmed";
  const chainConfirmed = confirmation === "chain-confirmed";
  const failed = confirmation === "failed";
  return {
    title,
    phase: confirmed ? "confirmed" : chainConfirmed ? "chain-confirmed" : failed ? "error" : "timeout",
    signature,
    message: confirmed
      ? `${noun} is confirmed and indexed by ProbX.`
      : chainConfirmed
        ? `${noun} is confirmed on Solana. ProbX indexing is still catching up.`
        : failed
          ? "Solana reported this transaction as failed."
          : "Transaction was sent; indexing is still catching up."
  };
}

function actionStatusMessage(label: string, signature: string, confirmation: ActionConfirmationState) {
  if (confirmation === "confirmed") return `${label} confirmed and indexed: ${signature.slice(0, 12)}...`;
  if (confirmation === "chain-confirmed") return `${label} confirmed on-chain: ${signature.slice(0, 12)}... indexing is catching up.`;
  if (confirmation === "failed") return `${label} transaction failed: ${signature.slice(0, 12)}...`;
  if (confirmation === "timeout") return `${label} tx sent: ${signature.slice(0, 12)}... indexer still catching up.`;
  return `${label} saved.`;
}

function shortAddress(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
