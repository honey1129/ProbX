import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

const allowedHosts = ["probx.site", "www.probx.site", "test.probx.site", "api.probx.site", "test-api.probx.site"];

function publicEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "");
  const read = (nextKey: string, viteKey: string, fallback = "") => env[nextKey] ?? env[viteKey] ?? fallback;

  return {
    NODE_ENV: mode === "production" ? "production" : "development",
    NEXT_PUBLIC_SOLANA_RPC_URL: read("NEXT_PUBLIC_SOLANA_RPC_URL", "VITE_SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    NEXT_PUBLIC_SOLANA_CLUSTER: read("NEXT_PUBLIC_SOLANA_CLUSTER", "VITE_SOLANA_CLUSTER"),
    NEXT_PUBLIC_PROBX_PROGRAM_ID: read("NEXT_PUBLIC_PROBX_PROGRAM_ID", "VITE_PROBX_PROGRAM_ID"),
    NEXT_PUBLIC_ENABLE_ONCHAIN: read("NEXT_PUBLIC_ENABLE_ONCHAIN", "VITE_ENABLE_ONCHAIN", "false"),
    NEXT_PUBLIC_API_URL: read("NEXT_PUBLIC_API_URL", "VITE_API_URL"),
    NEXT_PUBLIC_TESTNET_HOSTS: read("NEXT_PUBLIC_TESTNET_HOSTS", "VITE_TESTNET_HOSTS", "test.probx.site"),
    NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL: read("NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL", "VITE_TESTNET_SOLANA_RPC_URL", "https://api.testnet.solana.com"),
    NEXT_PUBLIC_TESTNET_API_URL: read("NEXT_PUBLIC_TESTNET_API_URL", "VITE_TESTNET_API_URL", "https://test-api.probx.site"),
    NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID: read("NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID", "VITE_TESTNET_PROBX_PROGRAM_ID"),
    NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN: read("NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN", "VITE_TESTNET_ENABLE_ONCHAIN", "true"),
    NEXT_PUBLIC_X_URL: read("NEXT_PUBLIC_X_URL", "VITE_X_URL"),
    NEXT_PUBLIC_DISCORD_URL: read("NEXT_PUBLIC_DISCORD_URL", "VITE_DISCORD_URL"),
    NEXT_PUBLIC_TELEGRAM_URL: read("NEXT_PUBLIC_TELEGRAM_URL", "VITE_TELEGRAM_URL"),
    NEXT_PUBLIC_GITHUB_URL: read("NEXT_PUBLIC_GITHUB_URL", "VITE_GITHUB_URL")
  };
}

export default defineConfig(({ mode }) => ({
  define: {
    "process.env": JSON.stringify(publicEnv(mode))
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    allowedHosts,
    host: "0.0.0.0",
    port: 3000
  },
  preview: {
    allowedHosts,
    host: "0.0.0.0"
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          walletSolana: [
            "@solana/web3.js",
            "@project-serum/anchor",
            "@solana/wallet-adapter-base",
            "@solana/wallet-adapter-react",
            "@solana/wallet-adapter-react-ui",
            "@solana/wallet-adapter-wallets"
          ]
        }
      }
    }
  }
}));
