"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import type { ConnectionConfig } from "@solana/web3.js";
import type { ComponentType, ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
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

const WalletErrorContext = createContext<{
  error: string;
  clearError: () => void;
}>({
  error: "",
  clearError: () => {}
});

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  const [walletError, setWalletError] = useState("");

  function handleWalletError(error: WalletError, adapter?: Adapter) {
    const walletName = adapter?.name ?? "Wallet";
    const message = error.message || error.name || "Unable to connect wallet.";
    setWalletError(`${walletName}: ${message}`);
    console.warn("Wallet error", error);
  }

  return (
    <WalletErrorContext.Provider value={{ error: walletError, clearError: () => setWalletError("") }}>
      <SolanaConnectionProvider endpoint={endpoint}>
        <SolanaWalletProvider wallets={wallets} autoConnect={false} localStorageKey="probx.wallet" onError={handleWalletError}>
          <SolanaWalletModalProvider>
            <MarketProvider>{children}</MarketProvider>
          </SolanaWalletModalProvider>
        </SolanaWalletProvider>
      </SolanaConnectionProvider>
    </WalletErrorContext.Provider>
  );
}

export function useWalletError() {
  return useContext(WalletErrorContext);
}
