export type Side = "YES" | "NO";
export type Outcome = 0 | 1 | 2;
export type ActivitySide = Side | "VOID";

export type Market = {
  id: string;
  publicKey: string;
  creator: string;
  resolver: string;
  protocolConfig?: string;
  treasury?: string;
  protocolFeeBps: number;
  creatorLpShares: number;
  protocolFees: number;
  residualWithdrawn: number;
  residualClaimed: boolean;
  endTime: number;
  question: string;
  category: "Crypto" | "Politics" | "Sports" | "On-chain" | "Tech" | "Macro";
  avatarUrl?: string;
  yesPool: number;
  noPool: number;
  totalLiquidity: number;
  volume24h: number;
  participants: number;
  change24h: number;
  resolved?: boolean;
  outcome?: Outcome;
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

export type ActivityAction = "BUY" | "SELL" | "CREATE" | "RESOLVE" | "REDEEM" | "CANCEL" | "REFUND" | "SET_RESOLVER" | "WITHDRAW";

export type AgentActivity = {
  id: string;
  agent: string;
  marketId: string;
  side: ActivitySide;
  action: ActivityAction;
  size: number;
  confidence: number;
  timestamp: number;
};

export type Trade = {
  id: string;
  owner: string;
  marketId: string;
  side: Side;
  action: "BUY" | "SELL";
  amountSol: number;
  netAmountSol: number;
  protocolFeeSol: number;
  price: number;
  signature: string;
  status: string;
  createdAt: number;
};

export type AgentStats = {
  name: string;
  strategy: string;
  pnl: number;
  winRate: number;
  trades: number;
};
