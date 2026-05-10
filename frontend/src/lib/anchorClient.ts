"use client";

import { AnchorProvider, BN, Idl, Program, web3 } from "@project-serum/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import { getRuntimeConfig } from "./runtimeConfig";
import type { Market, Side } from "./types";

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

export function getProgramId() {
  return new PublicKey(getRuntimeConfig().programId);
}

export const PROGRAM_ID = getProgramId();

const legacyIdl = {
  version: "0.1.0",
  name: "probx_prediction",
  instructions: [
    {
      name: "buy_shares",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "side", type: "u8" },
        { name: "minSharesOut", type: "u64" }
      ]
    },
    {
      name: "sell_shares",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false }
      ],
      args: [
        { name: "shares", type: "u64" },
        { name: "side", type: "u8" },
        { name: "minLamportsOut", type: "u64" }
      ]
    },
    {
      name: "redeem_winnings",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true }
      ],
      args: []
    },
    {
      name: "resolve_market",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "resolver", isMut: false, isSigner: true }
      ],
      args: [{ name: "outcome", type: "u8" }]
    },
    {
      name: "set_resolver",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "resolver", isMut: false, isSigner: true }
      ],
      args: [{ name: "newResolver", type: "publicKey" }]
    },
    {
      name: "cancel_market",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "resolver", isMut: false, isSigner: true }
      ],
      args: []
    },
    {
      name: "refund_cancelled",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true }
      ],
      args: []
    },
    {
      name: "withdraw_residual",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "creator", isMut: true, isSigner: true }
      ],
      args: []
    },
    {
      name: "place_bet",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "side", type: "u8" }
      ]
    },
    {
      name: "create_market",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "creator", isMut: true, isSigner: true },
        { name: "config", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "question", type: "string" },
        { name: "endTime", type: "i64" },
        { name: "initialLiquidity", type: "u64" }
      ]
    }
  ]
} as Idl;

export type AnchorWalletLike = {
  publicKey: PublicKey;
  signTransaction: (transaction: web3.Transaction) => Promise<web3.Transaction>;
  signAllTransactions: (transactions: web3.Transaction[]) => Promise<web3.Transaction[]>;
};

export function getProgram(connection: web3.Connection, wallet: AnchorWalletLike) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed"
  });
  return new Program(legacyIdl, getProgramId(), provider);
}

export function getPositionPda(market: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    getProgramId()
  )[0];
}

export function getProtocolConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], getProgramId())[0];
}

export function getMarketPda(creator: PublicKey, endTime: number) {
  const endTimeBytes = new BN(endTime).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), endTimeBytes], getProgramId())[0];
}

export async function placeBet(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  side: Side;
  amountSol: number;
}) {
  return buyShares(params);
}

export async function buyShares(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  side: Side;
  amountSol: number;
  slippageBps?: number;
}) {
  const program = getProgram(params.connection, params.wallet);
  const owner = params.wallet.publicKey;
  const market = new PublicKey(params.market.publicKey);
  const position = getPositionPda(market, owner);
  const treasury = new PublicKey(params.market.treasury || params.market.creator);
  const side = params.side === "YES" ? 1 : 0;
  const lamports = new BN(Math.round(params.amountSol * web3.LAMPORTS_PER_SOL));
  const quote = quoteBuyShares(params.market, params.side, params.amountSol);
  const slippageBps = Math.max(0, Math.min(10_000, params.slippageBps ?? 50));
  const minSharesOut = quote.sharesOut
    .mul(new BN(10_000 - slippageBps))
    .div(new BN(10_000));

  return program.methods
    .buyShares(lamports, side, minSharesOut)
    .accounts({
      market,
      position,
      owner,
      treasury,
      systemProgram: SystemProgram.programId
    })
    .rpc();
}

export async function createMarket(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  question: string;
  endTime: number;
  initialLiquiditySol?: number;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = getMarketPda(params.wallet.publicKey, params.endTime);
  const config = getProtocolConfigPda();
  const initialLiquidity = new BN(
    Math.round((params.initialLiquiditySol ?? 1) * web3.LAMPORTS_PER_SOL)
  );

  return program.methods
    .createMarket(params.question, new BN(params.endTime), initialLiquidity)
    .accounts({
      market,
      creator: params.wallet.publicKey,
      config,
      systemProgram: SystemProgram.programId
    })
    .rpc();
}

export async function sellShares(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  side: Side;
  sharesSol: number;
  slippageBps?: number;
}) {
  const program = getProgram(params.connection, params.wallet);
  const owner = params.wallet.publicKey;
  const market = new PublicKey(params.market.publicKey);
  const position = getPositionPda(market, owner);
  const treasury = new PublicKey(params.market.treasury || params.market.creator);
  const side = params.side === "YES" ? 1 : 0;
  const shares = new BN(Math.round(params.sharesSol * web3.LAMPORTS_PER_SOL));
  const quote = quoteSellShares(params.market, params.side, params.sharesSol);
  const slippageBps = Math.max(0, Math.min(10_000, params.slippageBps ?? 50));
  const feeBps = Math.max(0, params.market.protocolFeeBps || 0);
  const protocolFee = quote.lamportsOut.mul(new BN(feeBps)).div(new BN(10_000));
  const netLamportsOut = quote.lamportsOut.sub(protocolFee);
  const minLamportsOut = netLamportsOut
    .mul(new BN(10_000 - slippageBps))
    .div(new BN(10_000));

  return program.methods
    .sellShares(shares, side, minLamportsOut)
    .accounts({
      market,
      position,
      owner,
      treasury
    })
    .rpc();
}

export async function redeemWinnings(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
}) {
  const program = getProgram(params.connection, params.wallet);
  const owner = params.wallet.publicKey;
  const market = new PublicKey(params.market.publicKey);
  const position = getPositionPda(market, owner);

  return program.methods
    .redeemWinnings()
    .accounts({
      market,
      position,
      owner
    })
    .rpc();
}

export async function refundCancelled(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
}) {
  const program = getProgram(params.connection, params.wallet);
  const owner = params.wallet.publicKey;
  const market = new PublicKey(params.market.publicKey);
  const position = getPositionPda(market, owner);

  return program.methods
    .refundCancelled()
    .accounts({
      market,
      position,
      owner
    })
    .rpc();
}

export async function resolveMarket(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  outcome: 0 | 1;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = new PublicKey(params.market.publicKey);

  return program.methods
    .resolveMarket(params.outcome)
    .accounts({
      market,
      resolver: params.wallet.publicKey
    })
    .rpc();
}

export async function setMarketResolver(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  newResolver: string;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = new PublicKey(params.market.publicKey);

  return program.methods
    .setResolver(new PublicKey(params.newResolver))
    .accounts({
      market,
      resolver: params.wallet.publicKey
    })
    .rpc();
}

export async function cancelMarket(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = new PublicKey(params.market.publicKey);

  return program.methods
    .cancelMarket()
    .accounts({
      market,
      resolver: params.wallet.publicKey
    })
    .rpc();
}

export async function withdrawResidual(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = new PublicKey(params.market.publicKey);

  return program.methods
    .withdrawResidual()
    .accounts({
      market,
      creator: params.wallet.publicKey
    })
    .rpc();
}

export function protocolFeeSol(market: Market, grossSol: number) {
  const feeBps = Math.max(0, market.protocolFeeBps || 0);
  if (!Number.isFinite(grossSol) || grossSol <= 0 || feeBps <= 0) return 0;
  return (grossSol * feeBps) / 10_000;
}

export function quoteBuyShares(market: Market, side: Side, amountSol: number) {
  const yesPool = solToLamportsBigInt(market.yesPool);
  const noPool = solToLamportsBigInt(market.noPool);
  const fee = solToLamportsBigInt(protocolFeeSol(market, amountSol));
  const amount = solToLamportsBigInt(amountSol) - fee;
  const invariant = yesPool * noPool;

  if (side === "YES") {
    const nextYesPool = yesPool + amount;
    const nextNoPool = ceilDiv(invariant, nextYesPool);
    return {
      sharesOut: bnFromBigInt(noPool - nextNoPool),
      nextYesPool: lamportsBigIntToSol(nextYesPool),
      nextNoPool: lamportsBigIntToSol(nextNoPool)
    };
  }

  const nextNoPool = noPool + amount;
  const nextYesPool = ceilDiv(invariant, nextNoPool);
  return {
    sharesOut: bnFromBigInt(yesPool - nextYesPool),
    nextYesPool: lamportsBigIntToSol(nextYesPool),
    nextNoPool: lamportsBigIntToSol(nextNoPool)
  };
}

export function quoteSellShares(market: Market, side: Side, sharesSol: number) {
  const yesPool = solToLamportsBigInt(market.yesPool);
  const noPool = solToLamportsBigInt(market.noPool);
  const shares = solToLamportsBigInt(sharesSol);
  const invariant = yesPool * noPool;

  if (side === "YES") {
    const nextNoPool = noPool + shares;
    const nextYesPool = ceilDiv(invariant, nextNoPool);
    return {
      lamportsOut: bnFromBigInt(yesPool - nextYesPool),
      nextYesPool: lamportsBigIntToSol(nextYesPool),
      nextNoPool: lamportsBigIntToSol(nextNoPool)
    };
  }

  const nextYesPool = yesPool + shares;
  const nextNoPool = ceilDiv(invariant, nextYesPool);
  return {
    lamportsOut: bnFromBigInt(noPool - nextNoPool),
    nextYesPool: lamportsBigIntToSol(nextYesPool),
    nextNoPool: lamportsBigIntToSol(nextNoPool)
  };
}

function solToLamportsBigInt(value: number) {
  const lamports = Number.isFinite(value) ? Math.max(0, Math.round(value * web3.LAMPORTS_PER_SOL)) : 0;
  return BigInt(lamports);
}

function lamportsBigIntToSol(value: bigint) {
  return Number(value) / web3.LAMPORTS_PER_SOL;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  const zero = BigInt(0);
  const one = BigInt(1);
  if (denominator <= zero) return zero;
  return (numerator + denominator - one) / denominator;
}

function bnFromBigInt(value: bigint) {
  return new BN(value.toString());
}

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
