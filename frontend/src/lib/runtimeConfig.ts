const DEFAULT_PROGRAM_ID = "4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL";
const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_TESTNET_RPC_URL = "https://api.testnet.solana.com";
const DEFAULT_TESTNET_API_URL = "https://test-api.probx.site";
const DEFAULT_TESTNET_HOSTS = "test.probx.site";

export type NetworkMode = "localnet" | "devnet" | "testnet" | "mainnet-beta";

export type RuntimeConfig = {
  apiUrl: string;
  cluster: NetworkMode;
  enableOnchain: boolean;
  explorerCluster: string;
  faucetUrl: string;
  isTestnetMode: boolean;
  label: string;
  programId: string;
  solanaRpcUrl: string;
};

export function getRuntimeConfig(): RuntimeConfig {
  const testnetMode = isTestnetMode();
  const solanaRpcUrl = testnetMode
    ? readEnv("NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL", DEFAULT_TESTNET_RPC_URL)
    : readEnv("NEXT_PUBLIC_SOLANA_RPC_URL", DEFAULT_DEVNET_RPC_URL);
  const apiUrl = testnetMode
    ? readEnv("NEXT_PUBLIC_TESTNET_API_URL", DEFAULT_TESTNET_API_URL)
    : readEnv("NEXT_PUBLIC_API_URL", "");
  const programId = testnetMode
    ? readEnv("NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID", readEnv("NEXT_PUBLIC_PROBX_PROGRAM_ID", DEFAULT_PROGRAM_ID))
    : readEnv("NEXT_PUBLIC_PROBX_PROGRAM_ID", DEFAULT_PROGRAM_ID);
  const cluster = testnetMode ? "testnet" : explicitCluster() || inferCluster(solanaRpcUrl);
  const enableOnchain = testnetMode
    ? readBoolean("NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN", true)
    : readBoolean("NEXT_PUBLIC_ENABLE_ONCHAIN", false);

  return {
    apiUrl,
    cluster,
    enableOnchain,
    explorerCluster: cluster,
    faucetUrl: cluster === "testnet" ? "https://faucet.solana.com/" : "",
    isTestnetMode: testnetMode,
    label: cluster === "testnet" ? "Testnet" : cluster === "devnet" ? "Devnet" : cluster === "localnet" ? "Localnet" : "Mainnet",
    programId,
    solanaRpcUrl
  };
}

export function isTestnetMode() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  const hosts = readEnv("NEXT_PUBLIC_TESTNET_HOSTS", DEFAULT_TESTNET_HOSTS)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(host);
}

function explicitCluster(): NetworkMode | null {
  const value = readEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "").toLowerCase();
  if (value === "mainnet" || value === "mainnet-beta") return "mainnet-beta";
  if (value === "testnet") return "testnet";
  if (value === "devnet") return "devnet";
  if (value === "localnet" || value === "local") return "localnet";
  return null;
}

function inferCluster(rpcUrl: string): NetworkMode {
  const lower = rpcUrl.toLowerCase();
  if (lower.includes("mainnet")) return "mainnet-beta";
  if (lower.includes("testnet")) return "testnet";
  if (lower.includes("localhost") || lower.includes("127.0.0.1")) return "localnet";
  return "devnet";
}

function readEnv(key: string, fallback: string) {
  return process.env[key]?.trim() || fallback;
}

function readBoolean(key: string, fallback: boolean) {
  const value = process.env[key]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
