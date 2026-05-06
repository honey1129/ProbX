"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { placeBet, createMarket as createMarketIx, getMarketPda, type AnchorWalletLike } from "@/lib/anchorClient";
import { clamp, mockActivity, mockMarkets, mockPositions } from "@/lib/mockData";
import { probability } from "@/lib/format";
import type { AgentActivity, Market, Position, Side } from "@/lib/types";

type MarketContextValue = {
  markets: Market[];
  positions: Position[];
  activity: AgentActivity[];
  selectedMarket: (id: string) => Market | undefined;
  buy: (marketId: string, side: Side, amountSol: number) => Promise<string>;
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

export function MarketProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const [markets, setMarkets] = useState<Market[]>(mockMarkets);
  const [positions, setPositions] = useState<Position[]>(mockPositions);
  const [activity, setActivity] = useState<AgentActivity[]>(mockActivity);
  const marketsRef = useRef(markets);

  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
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
        return [
          {
            id: `live-${Date.now()}`,
            agent: ["OmegaAgent", "AlphaBot", "QuantMind", "StatArb", "MacroSense"][Math.floor(Math.random() * 5)],
            marketId: market.id,
            side,
            action: side === "YES" ? "BUY" : "SELL",
            size: 10_000 + Math.random() * 80_000,
            confidence: 62 + Math.round(Math.random() * 34),
            timestamp: Date.now()
          },
          ...current
        ].slice(0, 40);
      });
    }, 2500);

    return () => window.clearInterval(id);
  }, []);

  const selectedMarket = useCallback((id: string) => markets.find((market) => market.id === id), [markets]);

  const buy = useCallback(
    async (marketId: string, side: Side, amountSol: number) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");

      let signature = "simulated";
      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        signature = await placeBet({
          connection,
          wallet: wallet as AnchorWalletLike,
          market,
          side,
          amountSol
        });
      }

      setMarkets((current) =>
        current.map((item) => {
          if (item.id !== marketId) return item;
          const delta = amountSol;
          const yesPool = side === "YES" ? item.yesPool + delta : item.yesPool;
          const noPool = side === "NO" ? item.noPool + delta : item.noPool;
          return {
            ...item,
            yesPool,
            noPool,
            totalLiquidity: yesPool + noPool,
            volume24h: item.volume24h + amountSol * 1000,
            probabilityHistory: [...item.probabilityHistory.slice(-95), yesPool / (yesPool + noPool)]
          };
        })
      );

      const entryProbability = side === "YES" ? probability(market) : 1 - probability(market);
      setPositions((current) => [
        {
          id: `local-${Date.now()}`,
          marketId,
          side,
          size: amountSol,
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
    [connection, markets, onchainEnabled, wallet]
  );

  const addMockMarket = useCallback((question: string, endTime: number, options?: CreateMarketOptions) => {
    const initialLiquidity = Math.max(100, options?.initialLiquidity ?? 1000);
    setMarkets((current) => [
      {
        id: `created-${Date.now()}`,
        publicKey: options?.publicKey ?? "11111111111111111111111111111111",
        creator: options?.creator ?? "11111111111111111111111111111111",
        endTime,
        question,
        category: options?.category ?? "Crypto",
        yesPool: initialLiquidity / 2,
        noPool: initialLiquidity / 2,
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
      if (!onchainEnabled || !wallet.connected || !wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
        addMockMarket(question, endTime, options);
        return "simulated";
      }

      const creator = wallet.publicKey;
      const signature = await createMarketIx({
        connection,
        wallet: wallet as AnchorWalletLike,
        question,
        endTime
      });
      addMockMarket(question, endTime, {
        ...options,
        creator: creator.toBase58(),
        publicKey: getMarketPda(creator, endTime).toBase58()
      });
      return signature;
    },
    [addMockMarket, connection, onchainEnabled, wallet]
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
