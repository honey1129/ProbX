# ProbX Frontend

Next.js trading terminal for the ProbX Solana prediction market.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` when you want custom runtime settings.

```bash
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
NEXT_PUBLIC_ENABLE_ONCHAIN=false
NEXT_PUBLIC_API_URL=http://localhost:8080
```

The UI runs in local preview mode when `NEXT_PUBLIC_API_URL` is empty. Set `NEXT_PUBLIC_API_URL` to use the Go backend and MySQL index, set `NEXT_PUBLIC_PROBX_PROGRAM_ID` to the deployed program for the selected RPC network, and set `NEXT_PUBLIC_ENABLE_ONCHAIN=true` to route connected wallet trades through the Anchor `buy_shares` and `create_market` calls.
