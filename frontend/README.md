# ProbX Frontend

Vite React trading terminal for the ProbX Solana prediction market. It includes the market list, detail trading view, create-market flow, portfolio, mobile navigation, testnet labeling, and transaction-progress modals for wallet actions.

## Testnet Deployment

Current test frontend:

```text
https://test.probx.site
```

When the browser host matches `NEXT_PUBLIC_TESTNET_HOSTS`, the app automatically switches to Solana Testnet:

```text
API:      https://test-api.probx.site
RPC:      https://api.testnet.solana.com
Explorer: Solana Explorer testnet links
```

The test site shows a red full-width testnet banner and a small `Testnet` badge beside the ProbX logo. API/indexer debug summaries are intentionally hidden from the main UI.

All wallet-triggering testnet actions use real on-chain transactions: create market, Buy/Sell YES/NO, claim/refund, resolve, cancel, set resolver, and withdraw residual. After the user confirms in their wallet, the UI opens a transaction modal with the signature, Explorer link, Solana confirmation status, and ProbX indexer sync status.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Build and preview the production bundle:

```bash
npm run build
npm run preview -- --port 3000
```

## Environment

Copy `.env.example` to `.env.local` when you want custom runtime settings.

```bash
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_SOLANA_CLUSTER=localnet
NEXT_PUBLIC_PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
NEXT_PUBLIC_ENABLE_ONCHAIN=false
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_TESTNET_HOSTS=test.probx.site
NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL=https://api.testnet.solana.com
NEXT_PUBLIC_TESTNET_API_URL=https://test-api.probx.site
NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN=true
NEXT_PUBLIC_X_URL=
NEXT_PUBLIC_DISCORD_URL=
NEXT_PUBLIC_TELEGRAM_URL=
NEXT_PUBLIC_GITHUB_URL=https://github.com/honey1129/ProbX
```

The UI runs in local preview mode when `NEXT_PUBLIC_API_URL` is empty. Set `NEXT_PUBLIC_API_URL` to use the Go backend and MySQL index, set `NEXT_PUBLIC_PROBX_PROGRAM_ID` to the deployed program for the selected RPC network, and set `NEXT_PUBLIC_ENABLE_ONCHAIN=true` to route connected wallet trades through the Anchor `buy_shares` and `create_market` calls.

Testnet overrides are selected at runtime by hostname. On `test.probx.site`, `NEXT_PUBLIC_TESTNET_*` values replace the default RPC/API/program/on-chain settings. Users must switch their wallet to Solana Testnet and fund it with testnet SOL before trading.

The Vite config keeps the existing `NEXT_PUBLIC_*` keys for compatibility and also accepts matching `VITE_*` aliases.

Social links render in the header and bottom ticker when their `NEXT_PUBLIC_*_URL` values are set.

## Checks

```bash
npm run typecheck
npm run build
```
