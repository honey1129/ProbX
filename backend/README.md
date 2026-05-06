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
```

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

## Checks

```bash
go test ./...
```
