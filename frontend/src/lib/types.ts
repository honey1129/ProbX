export type Side = "YES" | "NO";

export type Market = {
  id: string;
  publicKey: string;
  creator: string;
  endTime: number;
  question: string;
  category: "Crypto" | "Politics" | "Sports" | "On-chain" | "Tech" | "Macro";
  yesPool: number;
  noPool: number;
  totalLiquidity: number;
  volume24h: number;
  participants: number;
  change24h: number;
  resolved?: boolean;
  outcome?: 0 | 1;
  probabilityHistory: number[];
};

export type Position = {
  id: string;
  marketId: string;
  side: Side;
  size: number;
  entryProbability: number;
  currentProbability: number;
  pnl: number;
  resolved?: boolean;
};

export type AgentActivity = {
  id: string;
  agent: string;
  marketId: string;
  side: Side;
  action: "BUY" | "SELL";
  size: number;
  confidence: number;
  timestamp: number;
};

export type AgentStats = {
  name: string;
  strategy: string;
  pnl: number;
  winRate: number;
  trades: number;
};
