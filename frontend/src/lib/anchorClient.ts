"use client";

import { AnchorProvider, BN, Idl, Program, web3 } from "@project-serum/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { Market, Side } from "./types";

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

export const PROGRAM_ID = new PublicKey("4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL");

const legacyIdl = {
  version: "0.1.0",
  name: "probx_prediction",
  instructions: [
    {
      name: "place_bet",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "position", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true },
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
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "question", type: "string" },
        { name: "endTime", type: "i64" }
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
  return new Program(legacyIdl, PROGRAM_ID, provider);
}

export function getPositionPda(market: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function getMarketPda(creator: PublicKey, endTime: number) {
  const endTimeBytes = new BN(endTime).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), endTimeBytes], PROGRAM_ID)[0];
}

export async function placeBet(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  market: Market;
  side: Side;
  amountSol: number;
}) {
  const program = getProgram(params.connection, params.wallet);
  const owner = params.wallet.publicKey;
  const market = new PublicKey(params.market.publicKey);
  const position = getPositionPda(market, owner);
  const side = params.side === "YES" ? 1 : 0;
  const lamports = new BN(Math.round(params.amountSol * web3.LAMPORTS_PER_SOL));

  return program.methods
    .placeBet(lamports, side)
    .accounts({
      market,
      position,
      owner,
      systemProgram: SystemProgram.programId
    })
    .rpc();
}

export async function createMarket(params: {
  connection: web3.Connection;
  wallet: AnchorWalletLike;
  question: string;
  endTime: number;
}) {
  const program = getProgram(params.connection, params.wallet);
  const market = getMarketPda(params.wallet.publicKey, params.endTime);

  return program.methods
    .createMarket(params.question, new BN(params.endTime))
    .accounts({
      market,
      creator: params.wallet.publicKey,
      systemProgram: SystemProgram.programId
    })
    .rpc();
}

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
