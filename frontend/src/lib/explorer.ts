export function explorerUrlForSignature(signature: string, explorerCluster: string) {
  if (signature === "local" || signature === "indexed" || signature === "simulated") return null;
  const clusterQuery = explorerCluster === "mainnet-beta" ? "" : `?cluster=${explorerCluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterQuery}`;
}

export function shortSignature(signature: string) {
  if (signature.length <= 18) return signature;
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}
