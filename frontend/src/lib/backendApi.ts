import type { AgentActivity, Market, Position, Side, Trade } from "./types";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export type BootstrapPayload = {
  markets: Market[];
  positions: Position[];
  activity: AgentActivity[];
};

export type ApiStatus = {
  ok: boolean;
  database?: {
    ok: boolean;
    error?: string;
  };
  marketCount: number;
  solanaRpcUrl: string;
  programId: string;
  tradeVerification: string;
  indexer?: {
    cursor?: {
      signature?: string;
      slot?: number;
      updatedAt?: number;
    };
    lagSeconds?: number;
  };
  corsOrigins?: string[];
  corsAllowAll?: boolean;
};

export type CreateMarketPayload = {
  id?: string;
  publicKey?: string;
  creator?: string;
  question: string;
  category?: Market["category"];
  avatarUrl?: string;
  endTime: number;
  initialLiquidity?: number;
  signature?: string;
  status?: string;
};

export type TradePayload = {
  marketId: string;
  owner: string;
  side: Side;
  amountSol: number;
  action?: "BUY" | "SELL";
  signature?: string;
  status?: string;
};

export type UpdateMarketMetadataPayload = {
  actor: string;
  category: Market["category"];
  avatarUrl?: string;
  message?: string;
  signature?: string;
};

export type TradeResult = {
  signature: string;
  status: string;
  market: Market;
  position: Position;
  activity: AgentActivity;
};

export type TradePage = {
  trades: Trade[];
  nextCursor?: string;
};

export type IndexedEventRecord = {
  id: string;
  signature: string;
  slot: number;
  type: string;
  createdAt: number;
};

export type IndexedEventPage = {
  events: IndexedEventRecord[];
};

export type MediaUploadResult = {
  url: string;
  path: string;
  contentType: string;
  size: number;
};

export type IndexedEventQuery = {
  signature: string;
  type?: string;
  limit?: number;
};

export type TradeQuery = {
  marketId?: string;
  owner?: string;
  signature?: string;
  side?: Side | "ALL";
  action?: "BUY" | "SELL";
  status?: string;
  limit?: number;
  cursor?: string;
};

export type ResolveMarketPayload = {
  resolver: string;
  outcome: 0 | 1;
  signature?: string;
  status?: string;
};

export type SetMarketResolverPayload = {
  actor: string;
  newResolver: string;
  signature?: string;
  status?: string;
};

export type CancelMarketPayload = {
  resolver: string;
  signature?: string;
  status?: string;
};

export type RedeemPositionPayload = {
  owner: string;
  signature?: string;
  status?: string;
};

export type RedeemPositionResult = {
  signature: string;
  status: string;
  market: Market;
  position: Position;
};

export type RefundPositionPayload = RedeemPositionPayload;

export type WithdrawResidualPayload = {
  creator: string;
  signature?: string;
  status?: string;
};

export function isBackendApiConfigured() {
  return configuredApiUrl.length > 0;
}

export async function fetchBootstrap(owner?: string) {
  const query = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  return apiFetch<BootstrapPayload>(`/api/bootstrap${query}`);
}

export async function fetchApiStatus() {
  return apiFetch<ApiStatus>("/api/status");
}

export async function createBackendMarket(payload: CreateMarketPayload) {
  return apiFetch<Market>("/api/markets", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateBackendMarketMetadata(marketId: string, payload: UpdateMarketMetadataPayload) {
  return apiFetch<Market>(`/api/markets/${encodeURIComponent(marketId)}/metadata`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function recordBackendTrade(payload: TradePayload) {
  return apiFetch<TradeResult>("/api/trades", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchTrades(query: TradeQuery) {
  const params = new URLSearchParams();
  if (query.marketId) params.set("marketId", query.marketId);
  if (query.owner) params.set("owner", query.owner);
  if (query.signature) params.set("signature", query.signature);
  if (query.side && query.side !== "ALL") params.set("side", query.side);
  if (query.action) params.set("action", query.action);
  if (query.status) params.set("status", query.status);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<TradePage>(`/api/trades${suffix}`);
}

export async function fetchIndexedEvents(query: IndexedEventQuery) {
  const params = new URLSearchParams();
  params.set("signature", query.signature);
  if (query.type) params.set("type", query.type);
  if (query.limit) params.set("limit", String(query.limit));
  return apiFetch<IndexedEventPage>(`/api/indexed-events?${params.toString()}`);
}

export async function resolveBackendMarket(marketId: string, payload: ResolveMarketPayload) {
  return apiFetch<Market>(`/api/markets/${encodeURIComponent(marketId)}/resolve`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function setBackendMarketResolver(marketId: string, payload: SetMarketResolverPayload) {
  return apiFetch<Market>(`/api/markets/${encodeURIComponent(marketId)}/resolver`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function cancelBackendMarket(marketId: string, payload: CancelMarketPayload) {
  return apiFetch<Market>(`/api/markets/${encodeURIComponent(marketId)}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function redeemBackendPosition(positionId: string, payload: RedeemPositionPayload) {
  return apiFetch<RedeemPositionResult>(`/api/positions/${encodeURIComponent(positionId)}/redeem`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function refundBackendPosition(positionId: string, payload: RefundPositionPayload) {
  return apiFetch<RedeemPositionResult>(`/api/positions/${encodeURIComponent(positionId)}/refund`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function withdrawBackendResidual(marketId: string, payload: WithdrawResidualPayload) {
  return apiFetch<RedeemPositionResult>(`/api/markets/${encodeURIComponent(marketId)}/withdraw-residual`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadBackendMedia(file: Blob, filename = "market-image.jpg") {
  if (!configuredApiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  }
  const form = new FormData();
  form.set("file", file, filename);
  const response = await fetch(`${configuredApiUrl}/api/media`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    let message = `API request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as MediaUploadResult;
  if (payload.url?.startsWith("/")) {
    return { ...payload, url: `${configuredApiUrl}${payload.url}` };
  }
  return payload;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!configuredApiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  }

  const response = await fetch(`${configuredApiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    let message = `API request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
