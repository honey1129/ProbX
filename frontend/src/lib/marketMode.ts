import { PublicKey } from "@solana/web3.js";
import type { Market } from "./types";

const LOCAL_PROTOCOL_CONFIG = "local";

export function isValidPublicKey(value?: string) {
  if (!value) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export function isIndexedOnchainMarket(market: Market) {
  return (
    market.protocolConfig !== undefined &&
    market.protocolConfig !== LOCAL_PROTOCOL_CONFIG &&
    isValidPublicKey(market.publicKey) &&
    isValidPublicKey(market.creator) &&
    isValidPublicKey(market.resolver) &&
    isValidPublicKey(market.treasury || market.creator)
  );
}

export function isPendingOnchainMarket(market: Market) {
  return (
    market.id === market.publicKey &&
    market.protocolConfig === LOCAL_PROTOCOL_CONFIG &&
    isValidPublicKey(market.publicKey) &&
    isValidPublicKey(market.creator)
  );
}
