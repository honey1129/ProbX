"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { ComponentType } from "react";

type WalletMultiButtonProps = {
  className?: string;
};

const SolanaWalletMultiButton = WalletMultiButton as unknown as ComponentType<WalletMultiButtonProps>;

export function WalletConnect() {
  return <SolanaWalletMultiButton className="probx-wallet-button" />;
}
