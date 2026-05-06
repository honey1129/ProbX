"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { buyShares as buySharesIx, createMarket as createMarketIx, getMarketPda, quoteBuyShares, type AnchorWalletLike } from "@/lib/anchorClient";
import { createBackendMarket, fetchBootstrap, isBackendApiConfigured, recordBackendTrade } from "@/lib/backendApi";
import { clamp, mockActivity, mockMarkets, mockPositions } from "@/lib/mockData";
import { probability } from "@/lib/format";
import type { AgentActivity, Market, Position, Side } from "@/lib/types";

type MarketContextValue = {
  markets: Market[];
  positions: Position[];
  activity: AgentActivity[];
  selectedMarket: (id: string) => Market | undefined;
  buy: (marketId: string, side: Side, amountSol: number, options?: TradeOptions) => Promise<string>;
  createMarket: (question: string, endTime: number, options?: CreateMarketOptions) => Promise<string>;
  addMockMarket: (question: string, endTime: number, options?: CreateMarketOptions) => void;
};

const MarketContext = createContext<MarketContextValue | null>(null);

type CreateMarketOptions = {
  category?: Market["category"];
  initialLiquidity?: number;
  publicKey?: string;
  creator?: string;
};

type TradeOptions = {
  slippageBps?: number;
};

export function MarketProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const backendEnabled = isBackendApiConfigured();
  const ownerId = wallet.publicKey?.toBase58() ?? "local";
  const [backendReady, setBackendReady] = useState(backendEnabled);
  const [markets, setMarkets] = useState<Market[]>(mockMarkets);
  const [positions, setPositions] = useState<Position[]>(mockPositions);
  const [activity, setActivity] = useState<AgentActivity[]>(mockActivity);
  const marketsRef = useRef(markets);

  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    if (!backendEnabled) return;

    let cancelled = false;
    let timer: number | null = null;

    const load = () => {
      fetchBootstrap(ownerId)
        .then((payload) => {
          if (cancelled) return;
          setMarkets(payload.markets);
          setPositions(payload.positions);
          setActivity(payload.activity);
          setBackendReady(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setBackendReady(false);
          console.warn("ProbX API bootstrap failed, using local mock data.", error);
          timer = window.setTimeout(load, 5000);
        });
    };

    load();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [backendEnabled, ownerId]);

  useEffect(() => {
    if (backendReady) return;

    const id = window.setInterval(() => {
      setMarkets((current) =>
        current.map((market) => {
          const p = probability(market);
          const nextP = clamp(p + (Math.random() - 0.5) * 0.018 + market.change24h * 0.01, 0.03, 0.97);
          const total = market.yesPool + market.noPool;
          const yesPool = Math.max(1, Math.round(total * nextP));
          const noPool = Math.max(1, total - yesPool);
          return {
            ...market,
            yesPool,
            noPool,
            totalLiquidity: yesPool + noPool,
            change24h: clamp(market.change24h * 0.92 + (nextP - p) * 2.2, -0.18, 0.18),
            volume24h: Math.max(100_000, market.volume24h + (Math.random() - 0.35) * 90_000),
            probabilityHistory: [...market.probabilityHistory.slice(-95), nextP]
          };
        })
      );

      setActivity((current) => {
        const liveMarkets = marketsRef.current;
        const market = liveMarkets[Math.floor(Math.random() * liveMarkets.length)] ?? mockMarkets[0];
        const side: Side = Math.random() > probability(market) ? "NO" : "YES";
        const action: AgentActivity["action"] = side === "YES" ? "BUY" : "SELL";
        return [
          {
            id: `live-${Date.now()}`,
            agent: ["OmegaAgent", "AlphaBot", "QuantMind", "StatArb", "MacroSense"][Math.floor(Math.random() * 5)],
            marketId: market.id,
            side,
            action,
            size: 10_000 + Math.random() * 80_000,
            confidence: 62 + Math.round(Math.random() * 34),
            timestamp: Date.now()
          },
          ...current
        ].slice(0, 40);
      });
    }, 2500);

    return () => window.clearInterval(id);
  }, [backendReady]);

  const selectedMarket = useCallback((id: string) => markets.find((market) => market.id === id), [markets]);

  const buy = useCallback(
    async (marketId: string, side: Side, amountSol: number, options?: TradeOptions) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");

      let signature = "simulated";
      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        signature = await buySharesIx({
          connection,
          wallet: wallet as AnchorWalletLike,
          market,
          side,
          amountSol,
          slippageBps: options?.slippageBps
        });
      }

      if (backendReady) {
        try {
          const result = await recordBackendTrade({
            marketId,
            owner: ownerId,
            side,
            amountSol,
            signature: signature === "simulated" ? "indexed" : signature,
            status: signature === "simulated" ? "indexed" : "sent"
          });

          setMarkets((current) => upsertById(current, result.market));
          setPositions((current) => upsertById(current, result.position));
          setActivity((current) => [result.activity, ...current.filter((item) => item.id !== result.activity.id)].slice(0, 40));
          return result.signature;
        } catch (error) {
          setBackendReady(false);
          console.warn("ProbX API trade indexing failed, using local simulation.", error);
        }
      }

      setMarkets((current) =>
        current.map((item) => {
          if (item.id !== marketId) return item;
          const quote = quoteBuyShares(item, side, amountSol);
          const yesPool = quote.nextYesPool;
          const noPool = quote.nextNoPool;
          return {
            ...item,
            yesPool,
            noPool,
            totalLiquidity: item.totalLiquidity + amountSol,
            volume24h: item.volume24h + amountSol * 1000,
            probabilityHistory: [...item.probabilityHistory.slice(-95), yesPool / (yesPool + noPool)]
          };
        })
      );

      const entryProbability = side === "YES" ? probability(market) : 1 - probability(market);
      const shares = bnToSol(quoteBuyShares(market, side, amountSol).sharesOut);
      setPositions((current) => [
        {
          id: `local-${Date.now()}`,
          marketId,
          side,
          size: shares,
          entryProbability,
          currentProbability: entryProbability,
          pnl: 0
        },
        ...current
      ]);

      setActivity((current) => [
        {
          id: `you-${Date.now()}`,
          agent: wallet.publicKey?.toBase58().slice(0, 6) ?? "You",
          marketId,
          side,
          action: "BUY",
          size: amountSol * 1000,
          confidence: 99,
          timestamp: Date.now()
        },
        ...current
      ]);

      return signature;
    },
    [backendReady, connection, markets, onchainEnabled, ownerId, wallet]
  );

  const addMockMarket = useCallback((question: string, endTime: number, options?: CreateMarketOptions) => {
    const initialLiquidity = Math.max(0.01, options?.initialLiquidity ?? 1);
    setMarkets((current) => [
      {
        id: `created-${Date.now()}`,
        publicKey: options?.publicKey ?? "11111111111111111111111111111111",
        creator: options?.creator ?? "11111111111111111111111111111111",
        endTime,
        question,
        category: options?.category ?? "Crypto",
        yesPool: initialLiquidity,
        noPool: initialLiquidity,
        totalLiquidity: initialLiquidity,
        volume24h: 0,
        participants: 1,
        change24h: 0,
        probabilityHistory: Array.from({ length: 72 }, () => 0.5)
      },
      ...current
    ]);
  }, []);

  const createMarket = useCallback(
    async (question: string, endTime: number, options?: CreateMarketOptions) => {
      let signature = "simulated";
      let publicKey = options?.publicKey;
      let creator = options?.creator ?? ownerId;

      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        const creatorKey = wallet.publicKey;
        signature = await createMarketIx({
          connection,
          wallet: wallet as AnchorWalletLike,
          question,
          endTime,
          initialLiquiditySol: options?.initialLiquidity
        });
        creator = creatorKey.toBase58();
        publicKey = getMarketPda(creatorKey, endTime).toBase58();
      }

      if (backendReady) {
        try {
          const market = await createBackendMarket({
            question,
            endTime,
            category: options?.category,
            initialLiquidity: options?.initialLiquidity,
            creator,
            publicKey
          });
          setMarkets((current) => upsertById(current, market));
          return signature === "simulated" ? "indexed" : signature;
        } catch (error) {
          setBackendReady(false);
          console.warn("ProbX API market indexing failed, using local simulation.", error);
        }
      }

      addMockMarket(question, endTime, {
        ...options,
        creator,
        publicKey
      });
      return signature;
    },
    [addMockMarket, backendReady, connection, onchainEnabled, ownerId, wallet]
  );

  const value = useMemo(
    () => ({ markets, positions, activity, selectedMarket, buy, createMarket, addMockMarket }),
    [markets, positions, activity, selectedMarket, buy, createMarket, addMockMarket]
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarkets() {
  const value = useContext(MarketContext);
  if (!value) throw new Error("useMarkets must be used within MarketProvider");
  return value;
}

function upsertById<T extends { id: string }>(items: T[], next: T) {
  const exists = items.some((item) => item.id === next.id);
  if (!exists) return [next, ...items];
  return items.map((item) => (item.id === next.id ? next : item));
}

function bnToSol(value: { toString: () => string }) {
  return Number(value.toString()) / LAMPORTS_PER_SOL;
}
