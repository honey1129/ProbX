"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import type { ConnectionConfig } from "@solana/web3.js";
import type { ComponentType, ReactNode } from "react";
import { useMemo } from "react";
import { MarketProvider } from "@/components/market/MarketProvider";

type SolanaConnectionProviderProps = {
  children: ReactNode;
  endpoint: string;
  config?: ConnectionConfig;
};

type SolanaWalletProviderProps = {
  children: ReactNode;
  wallets: Adapter[];
  autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>);
  localStorageKey?: string;
  onError?: (error: WalletError, adapter?: Adapter) => void;
};

type SolanaWalletModalProviderProps = {
  children: ReactNode;
};

const SolanaConnectionProvider = ConnectionProvider as unknown as ComponentType<SolanaConnectionProviderProps>;
const SolanaWalletProvider = WalletProvider as unknown as ComponentType<SolanaWalletProviderProps>;
const SolanaWalletModalProvider = WalletModalProvider as unknown as ComponentType<SolanaWalletModalProviderProps>;

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <SolanaConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <SolanaWalletModalProvider>
          <MarketProvider>{children}</MarketProvider>
        </SolanaWalletModalProvider>
      </SolanaWalletProvider>
    </SolanaConnectionProvider>
  );
}
