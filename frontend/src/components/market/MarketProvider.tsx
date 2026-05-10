"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  buyShares as buySharesIx,
  createMarket as createMarketIx,
  getMarketPda,
  quoteBuyShares,
  quoteSellShares,
  redeemWinnings as redeemWinningsIx,
  resolveMarket as resolveMarketIx,
  sellShares as sellSharesIx,
  type AnchorWalletLike
} from "@/lib/anchorClient";
import { createBackendMarket, fetchBootstrap, fetchTrades, isBackendApiConfigured, recordBackendTrade, redeemBackendPosition, resolveBackendMarket, updateBackendMarketMetadata } from "@/lib/backendApi";
import { clamp, localActivity, localMarkets, localPositions } from "@/lib/localData";
import { probability } from "@/lib/format";
import type { AgentActivity, Market, Position, Side } from "@/lib/types";

type MarketContextValue = {
  markets: Market[];
  positions: Position[];
  activity: AgentActivity[];
  isLoading: boolean;
  error: string | null;
  dataSource: "api" | "local";
  backendEnabled: boolean;
  refresh: () => void;
  selectedMarket: (id: string) => Market | undefined;
  buy: (marketId: string, side: Side, amountSol: number, options?: TradeOptions) => Promise<string>;
  sell: (marketId: string, side: Side, sharesSol: number, options?: TradeOptions) => Promise<string>;
  redeem: (positionId: string) => Promise<string>;
  resolve: (marketId: string, outcome: 0 | 1) => Promise<string>;
  createMarket: (question: string, endTime: number, options?: CreateMarketOptions) => Promise<string>;
  updateMarketMetadata: (marketId: string, metadata: MarketMetadataInput) => Promise<Market>;
  addLocalMarket: (question: string, endTime: number, options?: CreateMarketOptions) => void;
  waitForTradeConfirmation: (signature: string, options?: TradeConfirmationOptions) => Promise<TradeConfirmationState>;
};

const MarketContext = createContext<MarketContextValue | null>(null);

type CreateMarketOptions = {
  category?: Market["category"];
  initialLiquidity?: number;
  avatarUrl?: string;
  publicKey?: string;
  creator?: string;
};

type TradeOptions = {
  slippageBps?: number;
};

type MarketMetadataInput = {
  category: Market["category"];
  avatarUrl?: string;
};

export type TradeConfirmationState = "local" | "indexed" | "sent" | "confirmed" | "timeout";

type TradeConfirmationOptions = {
  marketId?: string;
  attempts?: number;
  intervalMs?: number;
};

export function MarketProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const onchainEnabled = process.env.NEXT_PUBLIC_ENABLE_ONCHAIN === "true";
  const backendEnabled = isBackendApiConfigured();
  const ownerId = wallet.publicKey?.toBase58() ?? "local";
  const [apiReady, setApiReady] = useState(false);
  const [isLoading, setIsLoading] = useState(backendEnabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [markets, setMarkets] = useState<Market[]>(backendEnabled ? [] : localMarkets);
  const [positions, setPositions] = useState<Position[]>(backendEnabled ? [] : localPositions);
  const [activity, setActivity] = useState<AgentActivity[]>(backendEnabled ? [] : localActivity);
  const marketsRef = useRef(markets);

  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    if (!backendEnabled) {
      setApiReady(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchBootstrap(ownerId)
      .then((payload) => {
        if (cancelled) return;
        setMarkets(payload.markets);
        setPositions(payload.positions);
        setActivity(payload.activity);
        setApiReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setApiReady(false);
        setError(errorMessage(error, "ProbX API is unavailable."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backendEnabled, ownerId, reloadToken]);

  useEffect(() => {
    if (backendEnabled) return;

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
            change24h: clamp(market.change24h * 0.92 + (nextP - p) * 2.2, -0.18, 0.18),
            volume24h: Math.max(100_000, market.volume24h + (Math.random() - 0.35) * 90_000),
            probabilityHistory: [...market.probabilityHistory.slice(-95), nextP]
          };
        })
      );

      setActivity((current) => {
        const liveMarkets = marketsRef.current;
        const market = liveMarkets[Math.floor(Math.random() * liveMarkets.length)] ?? localMarkets[0];
        const side: Side = Math.random() > probability(market) ? "NO" : "YES";
        const action: AgentActivity["action"] = side === "YES" ? "BUY" : "SELL";
        return [
          {
            id: `local-${Date.now()}`,
            agent: ["OmegaAgent", "AlphaBot", "QuantMind", "StatArb", "MacroSense", "EventHorizon"][Math.floor(Math.random() * 6)],
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
  }, [backendEnabled]);

  const selectedMarket = useCallback((id: string) => markets.find((market) => market.id === id), [markets]);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const buy = useCallback(
    async (marketId: string, side: Side, amountSol: number, options?: TradeOptions) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");

      let signature = backendEnabled ? "indexed" : "local";
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

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        try {
          const result = await recordBackendTrade({
            marketId,
            owner: ownerId,
            side,
            amountSol,
            action: "BUY",
            signature,
            status: signature === "indexed" ? "indexed" : "sent"
          });

          setMarkets((current) => upsertById(current, result.market));
          setPositions((current) => upsertById(current, result.position));
          setActivity((current) => [result.activity, ...current.filter((item) => item.id !== result.activity.id)].slice(0, 40));
          setError(null);
          return result.signature;
        } catch (error) {
          const message = errorMessage(error, "ProbX API trade indexing failed.");
          setApiReady(false);
          setError(message);
          throw new Error(message);
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
      setPositions((current) =>
        upsertLocalPosition(current, {
          id: localPositionId(marketId, side),
          marketId,
          side,
          size: shares,
          entryProbability,
          currentProbability: entryProbability,
          pnl: 0
        })
      );

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
    [apiReady, backendEnabled, connection, error, markets, onchainEnabled, ownerId, wallet]
  );

  const sell = useCallback(
    async (marketId: string, side: Side, sharesSol: number, options?: TradeOptions) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");
      if (market.resolved) throw new Error("Market is resolved");

      const availableShares = positions
        .filter((position) => position.marketId === marketId && position.side === side && !position.resolved)
        .reduce((total, position) => total + position.size, 0);
      if (sharesSol > availableShares + 1e-9) {
        throw new Error("Not enough shares to sell.");
      }

      let signature = backendEnabled ? "indexed" : "local";
      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        signature = await sellSharesIx({
          connection,
          wallet: wallet as AnchorWalletLike,
          market,
          side,
          sharesSol,
          slippageBps: options?.slippageBps
        });
      }

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        try {
          const result = await recordBackendTrade({
            marketId,
            owner: ownerId,
            side,
            amountSol: sharesSol,
            action: "SELL",
            signature,
            status: signature === "indexed" ? "indexed" : "sent"
          });

          setMarkets((current) => upsertById(current, result.market));
          setPositions((current) => upsertById(current, result.position));
          setActivity((current) => [result.activity, ...current.filter((item) => item.id !== result.activity.id)].slice(0, 40));
          setError(null);
          return result.signature;
        } catch (error) {
          const message = errorMessage(error, "ProbX API sell indexing failed.");
          setApiReady(false);
          setError(message);
          throw new Error(message);
        }
      }

      const quote = quoteSellShares(market, side, sharesSol);
      const lamportsOut = bnToSol(quote.lamportsOut);
      setMarkets((current) =>
        current.map((item) => {
          if (item.id !== marketId) return item;
          const yesPool = quote.nextYesPool;
          const noPool = quote.nextNoPool;
          return {
            ...item,
            yesPool,
            noPool,
            totalLiquidity: Math.max(0, item.totalLiquidity - lamportsOut),
            volume24h: item.volume24h + lamportsOut * 1000,
            probabilityHistory: [...item.probabilityHistory.slice(-95), yesPool / (yesPool + noPool)]
          };
        })
      );
      setPositions((current) => reduceLocalPositions(current, marketId, side, sharesSol));
      setActivity((current) => [
        {
          id: `you-${Date.now()}`,
          agent: wallet.publicKey?.toBase58().slice(0, 6) ?? "You",
          marketId,
          side,
          action: "SELL",
          size: lamportsOut * 1000,
          confidence: 99,
          timestamp: Date.now()
        },
        ...current
      ]);

      return signature;
    },
    [apiReady, backendEnabled, connection, error, markets, onchainEnabled, ownerId, positions, wallet]
  );

  const redeem = useCallback(
    async (positionId: string) => {
      const position = positions.find((item) => item.id === positionId);
      if (!position) throw new Error("Position not found");
      const market = markets.find((item) => item.id === position.marketId);
      if (!market) throw new Error("Market not found");

      const winningSide = market.outcome === 1 ? "YES" : market.outcome === 0 ? "NO" : position.side;
      if (market.resolved && position.side !== winningSide) {
        throw new Error("This position is not on the winning side.");
      }

      let signature = backendEnabled ? "indexed" : "local";
      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        signature = await redeemWinningsIx({
          connection,
          wallet: wallet as AnchorWalletLike,
          market
        });
      }

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        try {
          const result = await redeemBackendPosition(positionId, {
            owner: ownerId,
            signature,
            status: signature === "indexed" ? "indexed" : "sent"
          });
          setMarkets((current) => upsertById(current, result.market));
          setPositions((current) => upsertById(current, result.position));
          setError(null);
          return result.signature;
        } catch (error) {
          const message = errorMessage(error, "ProbX API redeem indexing failed.");
          setApiReady(false);
          setError(message);
          throw new Error(message);
        }
      }

      setMarkets((current) =>
        current.map((item) => {
          if (item.id !== market.id) return item;
          return {
            ...item,
            totalLiquidity: Math.max(0, item.totalLiquidity - position.size)
          };
        })
      );
      setPositions((current) =>
        current.map((item) =>
          item.id === positionId
            ? {
                ...item,
                size: 0,
                pnl: 0,
                resolved: true
              }
            : item
        )
      );

      return signature;
    },
    [apiReady, backendEnabled, connection, error, markets, onchainEnabled, ownerId, positions, wallet]
  );

  const resolve = useCallback(
    async (marketId: string, outcome: 0 | 1) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");
      if (market.resolved) throw new Error("Market is already resolved");
      if (market.endTime > Math.floor(Date.now() / 1000)) throw new Error("Market has not ended yet.");

      let signature = backendEnabled ? "indexed" : "local";
      if (onchainEnabled && wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
        signature = await resolveMarketIx({
          connection,
          wallet: wallet as AnchorWalletLike,
          market,
          outcome
        });
      }

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        try {
          const nextMarket = await resolveBackendMarket(marketId, {
            resolver: ownerId,
            outcome,
            signature,
            status: signature === "indexed" ? "indexed" : "sent"
          });
          setMarkets((current) => upsertById(current, nextMarket));
          setPositions((current) => current.map((position) => (position.marketId === marketId ? { ...position, resolved: true } : position)));
          setError(null);
          return signature;
        } catch (error) {
          const message = errorMessage(error, "ProbX API resolve indexing failed.");
          setApiReady(false);
          setError(message);
          throw new Error(message);
        }
      }

      setMarkets((current) =>
        current.map((item) =>
          item.id === marketId
            ? {
                ...item,
                resolved: true,
                outcome
              }
            : item
        )
      );
      setPositions((current) => current.map((position) => (position.marketId === marketId ? { ...position, resolved: true } : position)));
      return signature;
    },
    [apiReady, backendEnabled, connection, error, markets, onchainEnabled, ownerId, wallet]
  );

  const addLocalMarket = useCallback((question: string, endTime: number, options?: CreateMarketOptions) => {
    const initialLiquidity = Math.max(0.01, options?.initialLiquidity ?? 1);
    setMarkets((current) => [
      {
        id: `created-${Date.now()}`,
        publicKey: options?.publicKey ?? "11111111111111111111111111111111",
        creator: options?.creator ?? "11111111111111111111111111111111",
        endTime,
        question,
        category: options?.category ?? "Crypto",
        avatarUrl: options?.avatarUrl,
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
      let signature = backendEnabled ? "indexed" : "local";
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

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        try {
          const market = await createBackendMarket({
            question,
            endTime,
            category: options?.category,
            avatarUrl: options?.avatarUrl,
            initialLiquidity: options?.initialLiquidity,
            creator,
            publicKey,
            signature,
            status: signature === "indexed" ? "indexed" : "sent"
          });
          setMarkets((current) => upsertById(current, market));
          setError(null);
          return signature;
        } catch (error) {
          const message = errorMessage(error, "ProbX API market indexing failed.");
          setApiReady(false);
          setError(message);
          throw new Error(message);
        }
      }

      addLocalMarket(question, endTime, {
        ...options,
        creator,
        publicKey
      });
      return signature;
    },
    [addLocalMarket, apiReady, backendEnabled, connection, error, onchainEnabled, ownerId, wallet]
  );

  const updateMarketMetadata = useCallback(
    async (marketId: string, metadata: MarketMetadataInput) => {
      const market = markets.find((item) => item.id === marketId);
      if (!market) throw new Error("Market not found");
      const avatarUrl = metadata.avatarUrl?.trim() ?? "";

      if (backendEnabled) {
        if (!apiReady) throw new Error(error ?? "ProbX API is not ready.");
        const payload = {
          actor: ownerId,
          category: metadata.category,
          avatarUrl
        };
        if (ownerId !== "local" && !wallet.signMessage) {
          throw new Error("Connected wallet does not support message signing.");
        }
        const signedPayload =
          wallet.publicKey && wallet.signMessage
            ? await signMetadataPayload({
                ...payload,
                marketId
              }, wallet.signMessage)
            : payload;

        try {
          const updated = await updateBackendMarketMetadata(marketId, signedPayload);
          setMarkets((current) => upsertById(current, updated));
          setError(null);
          return updated;
        } catch (error) {
          const message = errorMessage(error, "ProbX API metadata update failed.");
          setError(message);
          throw new Error(message);
        }
      }

      const updated = { ...market, category: metadata.category, avatarUrl: avatarUrl || undefined };
      setMarkets((current) => upsertById(current, updated));
      return updated;
    },
    [apiReady, backendEnabled, error, markets, ownerId, wallet.publicKey, wallet.signMessage]
  );

  const waitForTradeConfirmation = useCallback(
    async (signature: string, options?: TradeConfirmationOptions): Promise<TradeConfirmationState> => {
      const normalized = signature.trim();
      if (!backendEnabled) return "local";
      if (normalized === "" || normalized === "local") return "local";
      if (normalized === "indexed" || normalized === "simulated") return "indexed";

      const attempts = options?.attempts ?? 10;
      const intervalMs = options?.intervalMs ?? 1600;
      let sawSent = false;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) await delay(intervalMs);
        try {
          const page = await fetchTrades({
            signature: normalized,
            marketId: options?.marketId,
            owner: ownerId,
            limit: 1
          });
          const trade = page.trades.find((item) => item.signature === normalized);
          if (trade?.status === "confirmed") {
            notifyTradesUpdated(options?.marketId);
            refresh();
            return "confirmed";
          }
          if (trade?.status === "sent") {
            sawSent = true;
            continue;
          }
          if (trade) return "indexed";
        } catch {
          // Polling is best-effort; the submitted transaction remains visible by signature.
        }
      }
      return sawSent ? "sent" : "timeout";
    },
    [backendEnabled, ownerId, refresh]
  );

  const value = useMemo(
    () => {
      const dataSource: MarketContextValue["dataSource"] = backendEnabled ? "api" : "local";
      return {
        markets,
        positions,
        activity,
        isLoading,
        error,
        dataSource,
        backendEnabled,
        refresh,
        selectedMarket,
        buy,
        sell,
        redeem,
        resolve,
        createMarket,
        updateMarketMetadata,
        addLocalMarket,
        waitForTradeConfirmation
      };
    },
    [markets, positions, activity, isLoading, error, backendEnabled, refresh, selectedMarket, buy, sell, redeem, resolve, createMarket, updateMarketMetadata, addLocalMarket, waitForTradeConfirmation]
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

function localPositionId(marketId: string, side: Side) {
  return `local-${marketId}-${side.toLowerCase()}`;
}

function upsertLocalPosition(items: Position[], next: Position) {
  const existing = items.find((item) => item.marketId === next.marketId && item.side === next.side && !item.resolved);
  if (!existing) return [next, ...items];

  const totalSize = existing.size + next.size;
  const entryProbability =
    totalSize > 0
      ? (existing.entryProbability * existing.size + next.entryProbability * next.size) / totalSize
      : next.entryProbability;

  return items.map((item) =>
    item.id === existing.id
      ? {
          ...item,
          size: totalSize,
          entryProbability,
          currentProbability: next.currentProbability,
          pnl: (next.currentProbability - entryProbability) * totalSize * 100
        }
      : item
  );
}

function reduceLocalPositions(items: Position[], marketId: string, side: Side, sharesSol: number) {
  let remaining = sharesSol;
  return items
    .map((position) => {
      if (remaining <= 0 || position.marketId !== marketId || position.side !== side || position.resolved) {
        return position;
      }
      const sold = Math.min(position.size, remaining);
      remaining -= sold;
      return {
        ...position,
        size: Math.max(0, position.size - sold)
      };
    })
    .filter((position) => position.size > 1e-9 || position.resolved);
}

async function signMetadataPayload(
  payload: { marketId: string; actor: string; category: Market["category"]; avatarUrl: string },
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
) {
  const message = metadataMessage(payload);
  const encoded = new TextEncoder().encode(message);
  const signature = await signMessage(encoded);
  return {
    actor: payload.actor,
    category: payload.category,
    avatarUrl: payload.avatarUrl,
    message,
    signature: base58Encode(signature)
  };
}

function metadataMessage(payload: { marketId: string; actor: string; category: string; avatarUrl: string }) {
  return [
    "ProbX metadata update",
    `market=${payload.marketId.trim()}`,
    `actor=${payload.actor.trim()}`,
    `category=${payload.category.trim()}`,
    `avatarUrl=${payload.avatarUrl.trim()}`
  ].join("\n");
}

function base58Encode(input: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  let output = "";
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = digits.length - 1; index >= 0; index--) {
    output += alphabet[digits[index]];
  }
  for (const byte of input) {
    if (byte !== 0) break;
    output = alphabet[0] + output;
  }
  return output || alphabet[0];
}

function notifyTradesUpdated(marketId?: string) {
  window.dispatchEvent(new CustomEvent("probx:trades-updated", { detail: { marketId } }));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
