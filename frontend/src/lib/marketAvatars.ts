import type { Market } from "./types";

export const MARKET_AVATAR_URLS = {
  "fed-rates": "https://upload.wikimedia.org/wikipedia/commons/1/1a/Seal_of_the_United_States_Federal_Reserve_System.svg",
  "btc-100k": "https://upload.wikimedia.org/wikipedia/commons/4/46/Bitcoin.svg",
  "trump-approval": "https://upload.wikimedia.org/wikipedia/commons/d/d6/Donald_Trump_official_portrait%2C_2025_%28cropped_headshot%29.jpg",
  "sol-etf": "https://upload.wikimedia.org/wikipedia/commons/e/ef/Solana-sol-logo-horizontal-2025.svg",
  "nba-finals": "https://upload.wikimedia.org/wikipedia/commons/2/25/CelticsWordmark.svg",
  "nvidia-earnings": "https://upload.wikimedia.org/wikipedia/commons/4/48/Nvidia_Logo.svg"
} as const;

export function marketAvatarUrl(market: Pick<Market, "id" | "avatarUrl">) {
  return market.avatarUrl?.trim() || MARKET_AVATAR_URLS[market.id as keyof typeof MARKET_AVATAR_URLS];
}

export function marketAvatarMode(market: Pick<Market, "id">) {
  if ("avatarUrl" in market && typeof market.avatarUrl === "string" && market.avatarUrl.startsWith("data:image/")) return "photo";
  return market.id === "trump-approval" ? "photo" : "logo";
}
