# ProbX Go API

Go backend for the ProbX frontend. It exposes a small REST API and stores query-friendly application data in MySQL:

- markets
- probability history
- positions
- trades
- agent activity

The Solana program remains the source of truth for funds and settlement. MySQL is an index/cache layer for the product UI and agent workflows.

## Configuration

`cmd/server` and `cmd/indexer` automatically load `.env` from the current directory. When run from the repository root, they also try `backend/.env`. Existing shell environment variables win over values from `.env`.

```bash
cp .env.example .env
```

```bash
PROBX_HTTP_ADDR=:8080
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://localhost:3000
PROBX_SOLANA_RPC_URL=http://127.0.0.1:8899
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=off
PROBX_INDEXER_INTERVAL=0s
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

`PROBX_TRADE_VERIFICATION=off` keeps the local demo flow available. Set it to `confirmed` for testnet/prod-like environments; in that mode create, trade, resolve, and redeem requests require a confirmed Solana signature, a non-local wallet, and a transaction that references `PROBX_PROGRAM_ID`.

`PROBX_INDEXER_INTERVAL=0s` keeps `cmd/indexer` as a one-shot sync. Set it to a duration such as `15s` to run it as a long-lived worker. `PROBX_INDEXER_TIMEOUT` caps each cycle and `PROBX_INDEXER_EVENT_LIMIT` caps event signatures fetched per cycle.

## Run With Docker MySQL

From the repository root:

```bash
docker compose up -d mysql
cd backend
go run ./cmd/server
```

The MySQL container runs all files in `backend/migrations/` on first database creation.

## Run With Existing MySQL

Create a database and user, then apply migrations:

```bash
CREATE DATABASE probx;
CREATE USER 'probx'@'%' IDENTIFIED BY 'probx';
GRANT ALL PRIVILEGES ON probx.* TO 'probx'@'%';
```

```bash
PROBX_DATABASE_DSN='probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true' ./scripts/migrate.sh
go run ./cmd/server
```

## Run The Indexer

The indexer reads on-chain Anchor `Market` and `Position` accounts from `PROBX_SOLANA_RPC_URL`, then replays ProbX program events into MySQL. Event replay is idempotent and updates market history, trades, activity, settlement, and redemption state.

Run one sync from `backend/`:

```bash
go run ./cmd/indexer
```

Run it as a worker:

```bash
PROBX_INDEXER_INTERVAL=15s go run ./cmd/indexer
```

The API exposes the saved program-event cursor and indexer lag through `GET /api/status`.

## API

```text
GET  /health
GET  /api/status
GET  /api/bootstrap?owner=local
GET  /api/markets
POST /api/markets
GET  /api/markets/{id}
PATCH /api/markets/{id}/metadata
GET  /api/positions?owner=local
GET  /api/activity?marketId=fed-rates&limit=40
GET  /api/trades?marketId=fed-rates&owner=local&limit=50
GET  /api/indexed-events?signature=tx_sig&type=MarketCreated
POST /api/trades
```

Example create market:

```bash
curl -X POST http://localhost:8080/api/markets \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Will SOL close above $250 this month?",
    "category": "Crypto",
    "endTime": 1893456000,
    "initialLiquidity": 1000,
    "creator": "local"
  }'
```

Example trade:

```bash
curl -X POST http://localhost:8080/api/trades \
  -H 'Content-Type: application/json' \
  -d '{
    "marketId": "fed-rates",
    "owner": "local",
    "side": "YES",
    "amountSol": 1.25,
    "signature": "indexed",
    "status": "indexed"
  }'
```

When trade verification is enabled, replace the demo `owner` and `signature` values with the connected wallet public key and confirmed transaction signature from the frontend.

Example metadata update:

```bash
curl -X PATCH http://localhost:8080/api/markets/fed-rates/metadata \
  -H 'Content-Type: application/json' \
  -d '{
    "actor": "local",
    "category": "Macro",
    "avatarUrl": "https://probx.site/market.png"
  }'
```

When verification is `confirmed`, `actor` must be the market creator and the payload must include a wallet-signed message plus base58 signature. The signed message format is:

```text
ProbX metadata update
market=<market id>
actor=<creator wallet>
category=<category>
avatarUrl=<avatar URL>
```

Example trade history:

```bash
curl 'http://localhost:8080/api/trades?marketId=fed-rates&limit=50'
```

Example indexed event lookup:

```bash
curl 'http://localhost:8080/api/indexed-events?signature=tx_sig&type=MarketCreated'
```

## Checks

```bash
go test ./...
```
