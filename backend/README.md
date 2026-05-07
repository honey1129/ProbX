# ProbX Go API

Go backend for the ProbX frontend. It exposes a small REST API and stores query-friendly application data in MySQL:

- markets
- probability history
- positions
- trades
- agent activity

The Solana program remains the source of truth for funds and settlement. MySQL is an index/cache layer for the product UI and agent workflows.

## Configuration

```bash
PROBX_HTTP_ADDR=:8080
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://localhost:3000
PROBX_SOLANA_RPC_URL=http://127.0.0.1:8899
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=off
```

`PROBX_TRADE_VERIFICATION=off` keeps the local demo flow available. Set it to `confirmed` for testnet/prod-like environments; in that mode `POST /api/trades` requires a confirmed Solana signature, a non-local owner wallet, and a transaction that references `PROBX_PROGRAM_ID`.

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
PROBX_MYSQL_CLI_DSN=mysql://probx:probx@127.0.0.1:3306/probx ./scripts/migrate.sh
go run ./cmd/server
```

## Run The Indexer

The indexer reads on-chain Anchor `Market` accounts from `PROBX_SOLANA_RPC_URL` and upserts them into MySQL by `public_key`. This first version indexes Market accounts only; Position accounts and full trade history are still separate follow-up work.

Run it from `backend/`:

```bash
PROBX_DATABASE_DSN='probx:your-password@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true' \
PROBX_SOLANA_RPC_URL='http://127.0.0.1:8899' \
PROBX_PROGRAM_ID='4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL' \
go run ./cmd/indexer
```

It is a one-shot sync command, so production can run it from cron or a systemd timer while the API keeps serving requests on its own port.

## API

```text
GET  /health
GET  /api/bootstrap?owner=local
GET  /api/markets
POST /api/markets
GET  /api/markets/{id}
GET  /api/positions?owner=local
GET  /api/activity?marketId=fed-rates&limit=40
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

## Checks

```bash
go test ./...
```
