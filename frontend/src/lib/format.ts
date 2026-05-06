export const LAMPORTS_PER_SOL = 1_000_000_000;

export function probability(market: { yesPool: number; noPool: number }) {
  const total = market.yesPool + market.noPool;
  if (total <= 0) return 0;
  return market.yesPool / total;
}

export function formatPercent(value: number, decimals = 1) {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatPrice(value: number) {
  return `${(value * 100).toFixed(1)}¢`;
}

export function formatSol(value: number, decimals = 2) {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  })} SOL`;
}

export function formatUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

export function timeRemaining(endTime: number) {
  const seconds = Math.max(0, endTime - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
