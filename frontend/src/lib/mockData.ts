import type { AgentActivity, AgentStats, Market, Position, Side } from "./types";

const now = Math.floor(Date.now() / 1000);

function series(start: number, points = 72, volatility = 0.018) {
  const out: number[] = [];
  let value = start;
  for (let i = 0; i < points; i += 1) {
    const anchor = start + Math.sin(i / 9) * 0.035;
    value = clamp(value + (anchor - value) * 0.08 + seededNoise(i, start) * volatility, 0.03, 0.97);
    out.push(value);
  }
  return out;
}

function seededNoise(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

export const mockMarkets: Market[] = [
  {
    id: "fed-rates",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Fed111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqFedCreator111",
    endTime: now + 3600 * 24 * 23,
    question: "Will the Fed cut rates in June 2025?",
    category: "Macro",
    yesPool: 1_320,
    noPool: 805,
    totalLiquidity: 2_125,
    volume24h: 8_240_000,
    participants: 1428,
    change24h: 0.043,
    probabilityHistory: series(0.621)
  },
  {
    id: "btc-100k",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Btc111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqBtcCreator111",
    endTime: now + 3600 * 24 * 8,
    question: "Bitcoin above $100k by May 31?",
    category: "Crypto",
    yesPool: 1_670,
    noPool: 1_360,
    totalLiquidity: 3_030,
    volume24h: 12_470_000,
    participants: 2910,
    change24h: -0.021,
    probabilityHistory: series(0.551)
  },
  {
    id: "trump-approval",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Pol111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqPolCreator111",
    endTime: now + 3600 * 24 * 18,
    question: "Trump approval rating above 50% by June?",
    category: "Politics",
    yesPool: 690,
    noPool: 960,
    totalLiquidity: 1_650,
    volume24h: 6_310_000,
    participants: 1804,
    change24h: -0.017,
    probabilityHistory: series(0.418)
  },
  {
    id: "sol-etf",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Sol111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqSolCreator111",
    endTime: now + 3600 * 24 * 71,
    question: "Solana ETF approved in 2025?",
    category: "Crypto",
    yesPool: 322,
    noPool: 798,
    totalLiquidity: 1_120,
    volume24h: 4_920_000,
    participants: 936,
    change24h: 0.068,
    probabilityHistory: series(0.287, 72, 0.026)
  },
  {
    id: "nba-finals",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Nba111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqNbaCreator111",
    endTime: now + 3600 * 24 * 39,
    question: "NBA Finals 2025: Celtics win title?",
    category: "Sports",
    yesPool: 280,
    noPool: 562,
    totalLiquidity: 842,
    volume24h: 3_210_000,
    participants: 785,
    change24h: -0.034,
    probabilityHistory: series(0.332)
  },
  {
    id: "nvidia-earnings",
    publicKey: "6r4Ph92qKZ7sF2C9o5Z7k9S74L9u2f1XfeDf3Nvda111",
    creator: "7KxG4yqX8Ky8g5pNFr25xXrbR6dcXqNvdaCreator111",
    endTime: now + 3600 * 24 * 19,
    question: "NVIDIA earnings beat in May?",
    category: "Tech",
    yesPool: 982,
    noPool: 388,
    totalLiquidity: 1_370,
    volume24h: 5_780_000,
    participants: 1221,
    change24h: 0.029,
    probabilityHistory: series(0.617)
  }
];

export const mockPositions: Position[] = [
  { id: "p1", marketId: "fed-rates", side: "YES", size: 16.0, entryProbability: 0.58, currentProbability: 0.621, pnl: 70.4 },
  { id: "p2", marketId: "btc-100k", side: "YES", size: 12.0, entryProbability: 0.48, currentProbability: 0.551, pnl: 85.2 },
  { id: "p3", marketId: "trump-approval", side: "NO", size: 9.0, entryProbability: 0.52, currentProbability: 0.582, pnl: -55.8 },
  { id: "p4", marketId: "sol-etf", side: "YES", size: 20.0, entryProbability: 0.25, currentProbability: 0.287, pnl: 74.0 },
  { id: "p5", marketId: "nvidia-earnings", side: "YES", size: 11.0, entryProbability: 0.63, currentProbability: 0.716, pnl: 94.6 }
];

export const mockAgents: AgentStats[] = [
  { name: "OmegaAgent", strategy: "Momentum", pnl: 1284, winRate: 68.4, trades: 412 },
  { name: "AlphaBot", strategy: "Mean Reversion", pnl: 944, winRate: 63.2, trades: 377 },
  { name: "QuantMind", strategy: "Hybrid", pnl: 2188, winRate: 71.1, trades: 529 },
  { name: "StatArb", strategy: "Arbitrage", pnl: -184, winRate: 54.6, trades: 298 },
  { name: "MacroSense", strategy: "External Signal", pnl: 738, winRate: 61.8, trades: 244 },
  { name: "EventHorizon", strategy: "News Flow", pnl: 1094, winRate: 66.7, trades: 331 }
];

export const mockActivity: AgentActivity[] = mockAgents.flatMap((agent, index) => {
  const market = mockMarkets[index % mockMarkets.length];
  const side: Side = index % 3 === 0 ? "NO" : "YES";
  return {
    id: `a-${agent.name}`,
    agent: agent.name,
    marketId: market.id,
    side,
    action: side === "YES" ? "BUY" : "SELL",
    size: 18_000 + index * 8_500,
    confidence: 72 + index * 4,
    timestamp: Date.now() - index * 7_000
  };
});

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
