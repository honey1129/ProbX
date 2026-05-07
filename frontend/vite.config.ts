import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

const allowedHosts = ["probx.site", "www.probx.site", "api.probx.site"];

function publicEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "");
  const read = (nextKey: string, viteKey: string, fallback = "") => env[nextKey] ?? env[viteKey] ?? fallback;

  return {
    NODE_ENV: mode === "production" ? "production" : "development",
    NEXT_PUBLIC_SOLANA_RPC_URL: read("NEXT_PUBLIC_SOLANA_RPC_URL", "VITE_SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    NEXT_PUBLIC_PROBX_PROGRAM_ID: read("NEXT_PUBLIC_PROBX_PROGRAM_ID", "VITE_PROBX_PROGRAM_ID"),
    NEXT_PUBLIC_ENABLE_ONCHAIN: read("NEXT_PUBLIC_ENABLE_ONCHAIN", "VITE_ENABLE_ONCHAIN", "false"),
    NEXT_PUBLIC_API_URL: read("NEXT_PUBLIC_API_URL", "VITE_API_URL"),
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
  }
}));
