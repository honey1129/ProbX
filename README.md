# ProbX Prediction Market

Language: [中文](#中文) | [English](#english)

<a id="中文"></a>

## 中文

ProbX 是一个基于 Solana Anchor 的二元预测市场项目。仓库包含链上合约、Vite React 交易前端、Go REST API、MySQL 索引库，以及一个可 dry-run 或模拟运行的 Python 自动交易 agent。

市场使用 YES/NO 恒定乘积 AMM 表达概率，支持创建市场、买卖 outcome shares、查询 YES 概率、到期结算和赢家领取奖励。

## 项目组成

```text
.
├── programs/probx_prediction/   # Anchor 预测市场合约
├── tests/                       # Anchor TypeScript 测试
├── idl/                         # 合约 IDL
├── backend/                     # Go API、MySQL store 和 migrations
├── frontend/                    # Vite React 交易前端
├── agent.py                     # Python 交易 agent
├── config.yaml                  # agent、RPC 和风控配置
├── scripts/run_agent.sh         # agent 启动脚本
└── docker-compose.yml           # 本地 MySQL
```

默认 localnet 程序 ID：

```text
4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
```

## 当前测试环境

当前已上线的测试环境：

```text
Frontend: https://test.probx.site
API:      https://test-api.probx.site
Network:  Solana Testnet
Program:  4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
```

`test.probx.site` 会在运行时自动切到 testnet 配置，使用 `https://test-api.probx.site` 和 `https://api.testnet.solana.com`。

测试环境已切成只允许真实链上交易：创建 market、Buy/Sell YES/NO、Claim/Refund、Resolve、Cancel、Set Resolver、Withdraw Residual 等触发钱包的动作都会发送 Solana testnet 交易。

使用测试站交易前，请确认钱包网络是 Solana Testnet，并准备 testnet SOL。

## 功能概览

- Anchor 合约：创建市场、AMM 买卖份额、价格查询、结算市场、领取奖励。
- Go 后端：提供 REST API，使用 MySQL 保存市场、概率历史、持仓、交易记录和 agent 活动。
- Vite React 前端：市场列表、市场详情、交易面板、创建市场、持仓页、概率图表、agent 活动流、移动端布局和链上交易进度弹窗。
- Python agent：从链上或 API 拉取市场，基于动量、均值回归和外部信号生成交易决策，支持 dry-run、循环轮询和多 agent 模拟。

## 环境要求

- Rust 和 Solana CLI
- Anchor CLI `0.31.x`
- Node.js `18+`
- Go `1.22+`
- MySQL `8+`，也可以使用仓库里的 Docker Compose
- Python `3.10+`
- Solana keypair，默认路径为 `~/.config/solana/id.json`

## 快速启动

安装根目录合约测试依赖：

```bash
npm install
```

安装前端依赖：

```bash
(cd frontend && npm install)
```

准备 Python agent 环境：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

启动 MySQL：

```bash
docker compose up -d mysql
```

首次创建数据库时，MySQL 容器会自动执行 `backend/migrations/*.sql`，包括建表和示例数据。
如果服务器上已经安装了 MySQL，可以跳过 Docker，手动创建数据库并在 `backend/` 目录运行迁移脚本。

启动 Go API：

```bash
(cd backend && go run ./cmd/server)
```

默认监听 `http://localhost:8080`。

启动前端：

```bash
test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
(cd frontend && npm run dev)
```

打开 `http://localhost:3000`。

## 环境变量

### Go API

后端默认值与 `backend/.env.example` 一致。`cmd/server` 和 `cmd/indexer` 启动时会自动读取当前目录的 `.env`；从仓库根目录运行时也会尝试读取 `backend/.env`。系统环境变量优先级更高，可以临时覆盖 `.env`。

首次配置可以这样做：

```bash
cd backend
cp .env.example .env
```

然后编辑 `backend/.env`：

```bash
PROBX_HTTP_ADDR=:8080
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://localhost:3000
PROBX_SOLANA_RPC_URL=http://127.0.0.1:8899
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=off
PROBX_MEDIA_DIR=data/media
PROBX_PUBLIC_BASE_URL=http://localhost:8080
PROBX_INDEXER_INTERVAL=0s
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

`PROBX_TRADE_VERIFICATION=off` 适合本地 demo。testnet 或生产类环境建议设为 `confirmed`，此时创建市场、交易、结算和赎回请求都必须提供已确认的 Solana 交易签名、真实钱包身份，并且交易需要引用 `PROBX_PROGRAM_ID`。

`PROBX_MEDIA_DIR` 是市场图片上传后的本地存储目录；`PROBX_PUBLIC_BASE_URL` 是 API 的公网地址，用来生成 `/media/...` 图片 URL。线上建议设成和 `NEXT_PUBLIC_API_URL` 一致的 API 域名。

`PROBX_INDEXER_INTERVAL=0s` 表示 `cmd/indexer` 只同步一次。设成 `15s` 这类 duration 后会作为常驻 worker 循环同步；`PROBX_INDEXER_TIMEOUT` 控制单次同步超时，`PROBX_INDEXER_EVENT_LIMIT` 控制每轮最多拉取的事件签名数。

### 前端

前端运行时配置位于 `frontend/.env.local`：

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

`NEXT_PUBLIC_API_URL` 为空时，前端会进入本地预览模式。设置为 Go API 地址后，前端会通过 MySQL 索引读写市场、持仓和交易活动；API 加载、空数据和错误会在页面上明确展示。

当访问域名匹配 `NEXT_PUBLIC_TESTNET_HOSTS`，例如 `test.probx.site`，前端会在运行时自动切到测试网模式：RPC 使用 `NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL`，API 使用 `NEXT_PUBLIC_TESTNET_API_URL`，Explorer 链接使用 Solana testnet，页面顶部会显示红色 testnet 横幅，左上角 logo 旁显示 `Testnet` 标识。测试网用户需要在钱包切换到 Solana Testnet，并通过 Solana Faucet 获取测试 SOL。

Vite 配置会继续读取现有的 `NEXT_PUBLIC_*` 变量，方便从旧前端平滑迁移；也支持对应的 `VITE_*` 别名。

`NEXT_PUBLIC_X_URL`、`NEXT_PUBLIC_DISCORD_URL`、`NEXT_PUBLIC_TELEGRAM_URL`、`NEXT_PUBLIC_GITHUB_URL` 会渲染到顶部右侧和底部 ticker 右侧的社群图标入口。

`NEXT_PUBLIC_PROBX_PROGRAM_ID` 必须和当前 RPC 网络上部署的 ProbX 程序一致。`NEXT_PUBLIC_ENABLE_ONCHAIN=false` 时，交易和创建市场走前端/API 的模拟或索引流程。需要连接钱包并发送链上交易时，先启动 localnet 并部署合约，然后将 `NEXT_PUBLIC_ENABLE_ONCHAIN` 改为 `true`。测试网环境通过 `NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN=true` 强制走真实链上交易，钱包确认后会显示交易进度弹窗和 Solana Explorer 链接。

## 链上开发

启动本地验证器：

```bash
solana-test-validator
```

构建合约：

```bash
anchor build
```

部署到 localnet：

```bash
anchor deploy
```

运行完整测试：

```bash
anchor test
```

只运行 TypeScript 测试脚本：

```bash
npm run test:ts
```

`Anchor.toml` 当前配置为：

```toml
[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
```

如果使用 `anchor test` 时本机缺少 `yarn`，请安装 yarn，或将 `Anchor.toml` 中的测试脚本改为等价的 npm 命令。

## 测试网部署

仓库提供了测试网合约部署脚本：

```bash
PROBX_TESTNET_TREASURY=<接收协议手续费的钱包公钥> \
PROBX_TESTNET_WALLET=~/.config/solana/id.json \
bash deploy/deploy-testnet-program.sh
```

脚本会切到 Solana testnet、构建并部署 Anchor 程序，然后执行 `npm run protocol:config` 初始化或更新协议 treasury 和 fee。部署钱包需要提前准备 testnet SOL，脚本完成后会打印：

```text
PROBX_PROGRAM_ID=<testnet program id>
NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=<testnet program id>
```

把同一个 program id 填到 VPS 的 `backend/.env.testnet` 和 `frontend/.env.local`。测试网后端建议独立数据库，例如：

```bash
# backend/.env.testnet
PROBX_HTTP_ADDR=:8082
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx_test?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=https://test.probx.site
PROBX_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_PROGRAM_ID=<testnet program id>
PROBX_TRADE_VERIFICATION=confirmed
PROBX_MEDIA_DIR=data/media-test
PROBX_PUBLIC_BASE_URL=https://test-api.probx.site
PROBX_INDEXER_INTERVAL=15s
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

`PROBX_ENV_FILE=backend/.env.testnet backend/scripts/migrate.sh` 会读取这份文件并迁移测试网数据库；PM2 部署脚本会自动分别迁移主环境和测试网环境。

测试站当前由 PM2 进程 `probx-frontend`、`probx-test-api` 和 `probx-test-indexer` 提供服务。常用检查命令：

```bash
curl -sSI https://test.probx.site
curl -sS https://test-api.probx.site/api/status
pm2 logs probx-test-api --lines 80
pm2 logs probx-test-indexer --lines 120
```

DNS 需要指向 VPS：

```text
test.probx.site     A 185.214.135.24
test-api.probx.site A 185.214.135.24
```

## Go API

常用接口：

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

创建市场示例：

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

记录交易示例：

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

更新市场 metadata 示例：

```bash
curl -X PATCH http://localhost:8080/api/markets/fed-rates/metadata \
  -H 'Content-Type: application/json' \
  -d '{
    "actor": "local",
    "category": "Macro",
    "avatarUrl": "https://probx.site/market.png"
  }'
```

`PROBX_TRADE_VERIFICATION=confirmed` 时，`actor` 必须是市场 creator，并且请求需要带钱包签名的 `message` 和 base58 `signature`。签名消息格式为：

```text
ProbX metadata update
market=<market id>
actor=<creator wallet>
category=<category>
avatarUrl=<avatar URL>
```

查询交易历史示例：

```bash
curl 'http://localhost:8080/api/trades?marketId=fed-rates&limit=50'
```

查询交易动作是否已被索引：

```bash
curl 'http://localhost:8080/api/indexed-events?signature=tx_sig&type=MarketCreated'
```

## 链上索引器

索引器会从 `PROBX_SOLANA_RPC_URL` 读取 `PROBX_PROGRAM_ID` 下的 Anchor `Market` 和 `Position` 账户，并重放 ProbX 程序事件到 MySQL。事件重放是幂等的，会更新市场历史、交易、活动、结算和赎回状态。

在已有 MySQL 的 VPS 上运行一次同步：

```bash
cd /root/ProbX/backend
go run ./cmd/indexer
```

作为常驻 worker 运行：

```bash
PROBX_INDEXER_INTERVAL=15s go run ./cmd/indexer
```

上面的命令会读取 `backend/.env`，所以 `PROBX_DATABASE_DSN`、`PROBX_SOLANA_RPC_URL` 和 `PROBX_PROGRAM_ID` 可以直接写在 `.env` 里。

如果 API 已经跑在 `:8081`，索引器不用占用 HTTP 端口，可以直接并行执行。`GET /api/status` 会返回 program-event cursor 和 indexer lag，方便确认 worker 是否在追链。

## PM2 自动部署

仓库提供了 PM2 部署脚本和 GitHub Actions workflow：

```text
deploy/pm2-deploy.sh
deploy/pm2/ecosystem.config.cjs
.github/workflows/deploy-vps.yml
```

VPS 首次准备：

```bash
npm install -g pm2
cd /root/ProbX
git pull
```

确认这两个文件只存在于 VPS 本地，不提交到仓库：

```text
/root/ProbX/backend/.env
/root/ProbX/backend/.env.testnet
/root/ProbX/frontend/.env.local
```

当前前端如果跑 `3001`，后端 CORS 和前端 API 建议这样配：

```bash
# backend/.env
PROBX_HTTP_ADDR=:8081
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://185.214.135.24:3001
PROBX_SOLANA_RPC_URL=https://api.devnet.solana.com
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=confirmed
PROBX_MEDIA_DIR=data/media
PROBX_PUBLIC_BASE_URL=https://api.probx.site
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

```bash
# frontend/.env.local
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_API_URL=https://api.probx.site
NEXT_PUBLIC_ENABLE_ONCHAIN=true
NEXT_PUBLIC_TESTNET_HOSTS=test.probx.site
NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL=https://api.testnet.solana.com
NEXT_PUBLIC_TESTNET_API_URL=https://test-api.probx.site
NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN=true
```

测试网 API/indexer 使用 `backend/.env.testnet`，关键差异是：

```bash
PROBX_HTTP_ADDR=:8082
PROBX_CORS_ORIGINS=https://test.probx.site
PROBX_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_PROGRAM_ID=<testnet 上部署的 ProbX program id>
PROBX_PUBLIC_BASE_URL=https://test-api.probx.site
PROBX_TRADE_VERIFICATION=confirmed
```

手动执行一次部署：

```bash
cd /root/ProbX
PROBX_FRONTEND_PORT=3001 \
PROBX_EXPECTED_API_URL=https://api.probx.site \
bash deploy/pm2-deploy.sh
```

部署脚本会依次执行：拉取并重置到远程分支、构建 Go 后端、自动执行 `backend/migrations/` 下的 MySQL 迁移、安装并构建 Vite 前端、用 PM2 启动或重载 `probx-api`、`probx-indexer`、`probx-test-api`、`probx-test-indexer` 和 `probx-frontend`。

`probx-indexer` 是 PM2 常驻 worker，默认每 `15s` 同步一次链上市场、持仓和程序事件。需要调整频率时：

```bash
PROBX_FRONTEND_PORT=3001 PROBX_PM2_INDEXER_INTERVAL=10s bash deploy/pm2-deploy.sh
```

常用 PM2 检查命令：

```bash
pm2 list
pm2 logs probx-api --lines 80
pm2 logs probx-indexer --lines 120
pm2 logs probx-test-api --lines 80
pm2 logs probx-test-indexer --lines 120
pm2 restart probx-indexer --update-env
```

API 的 `GET /api/status` 会返回 indexer cursor 和 lag，可以用来确认 worker 是否在追链。

设置 PM2 开机自启：

```bash
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行命令，把那行命令复制执行一次。

GitHub 自动部署需要在仓库 Settings -> Secrets and variables -> Actions 里添加 Secrets：

```text
VPS_HOST=185.214.135.24
VPS_USER=root
VPS_SSH_KEY=用于登录 VPS 的私钥
VPS_SSH_PORT=22
VPS_PROJECT_DIR=/root/ProbX
```

可选添加 Variables：

```text
PROBX_FRONTEND_PORT=3001
PROBX_PM2_INDEXER_INTERVAL=15s
PROBX_PM2_TESTNET_INDEXER_INTERVAL=15s
PROBX_EXPECTED_API_URL=https://api.probx.site
PROBX_EXPECTED_TESTNET_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_EXPECTED_TESTNET_API_URL=https://test-api.probx.site
PROBX_EXPECTED_TESTNET_HOSTS=test.probx.site
```

之后每次 push 到 `main`，GitHub Actions 会先执行 `go test ./...` 和前端 `npm run typecheck`，通过后再 SSH 到 VPS 并执行 `deploy/pm2-deploy.sh`。

手动迁移已有数据库：

```bash
cd /root/ProbX/backend
set -a
. ./.env
set +a
./scripts/migrate.sh
```

## Python Agent

agent 配置位于 `config.yaml`。默认 `dry_run: true`，交易日志写入 `data/trades.csv`。

运行多 agent 模拟：

```bash
./scripts/run_agent.sh simulate
```

运行一次 dry-run 交易循环：

```bash
./scripts/run_agent.sh once
```

持续轮询运行：

```bash
./scripts/run_agent.sh loop
```

也可以直接传参：

```bash
python3 agent.py --config config.yaml --simulate --agents 5 --steps 100
python3 agent.py --config config.yaml --once --dry-run
python3 agent.py --config config.yaml --loop
```

如果希望 agent 从 Go API 拉取市场，把 `config.yaml` 中的 `api_endpoint` 设置为 API 地址，例如 `http://localhost:8080/api/markets`。如果 `api_endpoint` 为空，agent 会从 Solana 程序账户读取市场。

## 合约模型

### Market

保存市场问题、创建者、结算者、YES/NO AMM 池子、总流动性、已发行份额、结束时间、结算状态和结算结果。

### Position

保存用户在指定市场中的 YES/NO outcome shares。市场结算后，胜出方可按持有份额领取奖励。

### 指令

- `create_market(question, end_time, initial_liquidity)`：创建未来到期的 AMM 市场，并注入初始 SOL 流动性。
- `buy_shares(amount, side, min_shares_out)`：按恒定乘积曲线买入 YES 或 NO 份额，`side = 1` 表示 YES，`side = 0` 表示 NO。
- `sell_shares(shares, side, min_lamports_out)`：在市场结束前把持仓份额卖回 AMM。
- `get_price()`：返回 YES 概率，按 `1_000_000_000` 定点数缩放。
- `resolve_market(outcome)`：市场到期后由 resolver 结算结果。
- `redeem_winnings()`：胜出方按持有份额领取奖励。
- `place_bet(amount, side)` 和 `claim_reward()`：兼容旧客户端的别名，新代码建议使用 `buy_shares` 和 `redeem_winnings`。

## 检查命令

```bash
# 合约
anchor build
anchor test
npm run test:ts

# Go API
(cd backend && go test ./...)

# 前端
(cd frontend && npm run typecheck)
(cd frontend && npm run build)

# Agent
./scripts/run_agent.sh simulate
```

## 注意事项

- `end_time` 必须是未来 Unix 时间戳。
- 市场问题文本最长为 280 bytes。
- 市场未到期不能结算，已结算市场不能继续交易。
- `sell_shares` 和 `redeem_winnings` 会保留 Market 账户租金豁免余额，只支付可用 lamports。
- `docker compose up -d mysql` 只启动 MySQL；Go API 和前端需要分别启动。
- MySQL 初始化脚本只会在数据卷首次创建时自动执行。已有数据卷需要手动运行迁移，或自行重建本地开发数据库。

<a id="english"></a>

## English

ProbX is a binary prediction market project built on Solana Anchor. This repository includes the on-chain program, a Vite React trading frontend, a Go REST API, a MySQL index store, and a Python trading agent that can run in dry-run or simulation mode.

Markets use a YES/NO constant-product AMM to express probability. The project supports market creation, buying and selling outcome shares, querying the YES probability, settlement after expiry, and winner redemption.

## Project Structure

```text
.
├── programs/probx_prediction/   # Anchor prediction market program
├── tests/                       # Anchor TypeScript tests
├── idl/                         # Program IDL
├── backend/                     # Go API, MySQL store, and migrations
├── frontend/                    # Vite React trading frontend
├── agent.py                     # Python trading agent
├── config.yaml                  # Agent, RPC, and risk configuration
├── scripts/run_agent.sh         # Agent runner
└── docker-compose.yml           # Local MySQL
```

Default localnet program ID:

```text
4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
```

## Current Test Environment

The current test environment is:

```text
Frontend: https://test.probx.site
API:      https://test-api.probx.site
Network:  Solana Testnet
Program:  4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
```

`test.probx.site` switches to the testnet configuration at runtime and uses `https://test-api.probx.site` plus `https://api.testnet.solana.com`.

The test environment only allows real on-chain transactions. Actions that trigger a wallet, including creating markets, Buy/Sell YES/NO, Claim/Refund, Resolve, Cancel, Set Resolver, and Withdraw Residual, send Solana testnet transactions.

Before trading on the test site, make sure your wallet is set to Solana Testnet and has testnet SOL.

## Features

- Anchor program: market creation, AMM share trading, price queries, market settlement, and reward redemption.
- Go backend: REST API backed by MySQL for markets, probability history, positions, trades, and agent activity.
- Vite React frontend: market list, market detail, trading panel, market creation, portfolio page, probability charts, agent activity feed, mobile layout, and on-chain transaction progress modal.
- Python agent: reads markets from chain or API, generates decisions from momentum, mean reversion, and external signals, and supports dry-run, polling loops, and multi-agent simulation.

## Requirements

- Rust and Solana CLI
- Anchor CLI `0.31.x`
- Node.js `18+`
- Go `1.22+`
- MySQL `8+`, or the Docker Compose service in this repo
- Python `3.10+`
- Solana keypair, default path `~/.config/solana/id.json`

## Quick Start

Install root contract test dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
(cd frontend && npm install)
```

Prepare the Python agent environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start MySQL:

```bash
docker compose up -d mysql
```

When the database is created for the first time, the MySQL container automatically runs `backend/migrations/*.sql`, including schema creation and seed data. If MySQL is already installed on your server, you can skip Docker, create the database manually, and run the migration script from `backend/`.

Start the Go API:

```bash
(cd backend && go run ./cmd/server)
```

The default address is `http://localhost:8080`.

Start the frontend:

```bash
test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
(cd frontend && npm run dev)
```

Open `http://localhost:3000`.

## Environment Variables

### Go API

Backend defaults match `backend/.env.example`. `cmd/server` and `cmd/indexer` automatically read `.env` from the current directory; when launched from the repository root, they also try `backend/.env`. System environment variables have higher priority and can override `.env`.

Initial setup:

```bash
cd backend
cp .env.example .env
```

Then edit `backend/.env`:

```bash
PROBX_HTTP_ADDR=:8080
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://localhost:3000
PROBX_SOLANA_RPC_URL=http://127.0.0.1:8899
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=off
PROBX_MEDIA_DIR=data/media
PROBX_PUBLIC_BASE_URL=http://localhost:8080
PROBX_INDEXER_INTERVAL=0s
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

`PROBX_TRADE_VERIFICATION=off` is suitable for a local demo. For testnet or production-like environments, use `confirmed`. In that mode, market creation, trading, settlement, and redemption requests must include a confirmed Solana transaction signature, the real wallet identity, and a transaction that references `PROBX_PROGRAM_ID`.

`PROBX_MEDIA_DIR` is the local storage directory for uploaded market images. `PROBX_PUBLIC_BASE_URL` is the public API base URL used to generate `/media/...` image URLs. In production, set it to the same API domain used by `NEXT_PUBLIC_API_URL`.

`PROBX_INDEXER_INTERVAL=0s` makes `cmd/indexer` sync once and exit. Set it to a duration such as `15s` to run it as a long-lived worker. `PROBX_INDEXER_TIMEOUT` controls the timeout for one sync round, and `PROBX_INDEXER_EVENT_LIMIT` limits the number of event signatures fetched per round.

### Frontend

Frontend runtime configuration lives in `frontend/.env.local`:

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

When `NEXT_PUBLIC_API_URL` is empty, the frontend enters local preview mode. When it points to the Go API, the frontend reads and writes markets, positions, and trade activity through the MySQL index. Loading, empty-data, and error states are shown in the UI.

When the current host matches `NEXT_PUBLIC_TESTNET_HOSTS`, such as `test.probx.site`, the frontend automatically switches to testnet mode: RPC uses `NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL`, API uses `NEXT_PUBLIC_TESTNET_API_URL`, Solana Explorer links target testnet, a red testnet banner appears at the top, and a `Testnet` badge appears next to the logo. Testnet users need to switch their wallet to Solana Testnet and get test SOL from a Solana faucet.

The Vite setup continues to read existing `NEXT_PUBLIC_*` variables for easier migration from older frontend setups. Matching `VITE_*` aliases are also supported.

`NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_DISCORD_URL`, `NEXT_PUBLIC_TELEGRAM_URL`, and `NEXT_PUBLIC_GITHUB_URL` render social links in the top-right header and the bottom ticker.

`NEXT_PUBLIC_PROBX_PROGRAM_ID` must match the deployed ProbX program on the current RPC network. When `NEXT_PUBLIC_ENABLE_ONCHAIN=false`, trading and market creation use frontend/API simulation or indexing flows. To connect a wallet and send on-chain transactions, start localnet, deploy the program, and set `NEXT_PUBLIC_ENABLE_ONCHAIN=true`. The testnet environment forces real on-chain transactions through `NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN=true`; after wallet confirmation, the UI shows a transaction progress modal and Solana Explorer link.

## On-Chain Development

Start a local validator:

```bash
solana-test-validator
```

Build the program:

```bash
anchor build
```

Deploy to localnet:

```bash
anchor deploy
```

Run the full test suite:

```bash
anchor test
```

Run only the TypeScript test script:

```bash
npm run test:ts
```

`Anchor.toml` is currently configured as:

```toml
[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
```

If `anchor test` fails because `yarn` is missing, install yarn or change the test script in `Anchor.toml` to an equivalent npm command.

## Testnet Deployment

The repository includes a testnet program deployment script:

```bash
PROBX_TESTNET_TREASURY=<wallet public key that receives protocol fees> \
PROBX_TESTNET_WALLET=~/.config/solana/id.json \
bash deploy/deploy-testnet-program.sh
```

The script switches to Solana testnet, builds and deploys the Anchor program, then runs `npm run protocol:config` to initialize or update the protocol treasury and fee. The deploy wallet must have testnet SOL. When the script finishes, it prints:

```text
PROBX_PROGRAM_ID=<testnet program id>
NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=<testnet program id>
```

Put the same program ID into the VPS `backend/.env.testnet` and `frontend/.env.local`. The testnet backend should use a separate database, for example:

```bash
# backend/.env.testnet
PROBX_HTTP_ADDR=:8082
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx_test?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=https://test.probx.site
PROBX_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_PROGRAM_ID=<testnet program id>
PROBX_TRADE_VERIFICATION=confirmed
PROBX_MEDIA_DIR=data/media-test
PROBX_PUBLIC_BASE_URL=https://test-api.probx.site
PROBX_INDEXER_INTERVAL=15s
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

`PROBX_ENV_FILE=backend/.env.testnet backend/scripts/migrate.sh` reads this file and migrates the testnet database. The PM2 deployment script automatically migrates both the main environment and the testnet environment.

The test site is currently served by PM2 processes `probx-frontend`, `probx-test-api`, and `probx-test-indexer`. Common checks:

```bash
curl -sSI https://test.probx.site
curl -sS https://test-api.probx.site/api/status
pm2 logs probx-test-api --lines 80
pm2 logs probx-test-indexer --lines 120
```

DNS should point to the VPS:

```text
test.probx.site     A 185.214.135.24
test-api.probx.site A 185.214.135.24
```

## Go API

Common endpoints:

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

Create a market:

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

Record a trade:

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

Update market metadata:

```bash
curl -X PATCH http://localhost:8080/api/markets/fed-rates/metadata \
  -H 'Content-Type: application/json' \
  -d '{
    "actor": "local",
    "category": "Macro",
    "avatarUrl": "https://probx.site/market.png"
  }'
```

When `PROBX_TRADE_VERIFICATION=confirmed`, `actor` must be the market creator, and the request must include a wallet-signed `message` and base58 `signature`. The signed message format is:

```text
ProbX metadata update
market=<market id>
actor=<creator wallet>
category=<category>
avatarUrl=<avatar URL>
```

Query trade history:

```bash
curl 'http://localhost:8080/api/trades?marketId=fed-rates&limit=50'
```

Check whether a trade action has been indexed:

```bash
curl 'http://localhost:8080/api/indexed-events?signature=tx_sig&type=MarketCreated'
```

## On-Chain Indexer

The indexer reads Anchor `Market` and `Position` accounts under `PROBX_PROGRAM_ID` from `PROBX_SOLANA_RPC_URL`, then replays ProbX program events into MySQL. Event replay is idempotent and updates market history, trades, activity, settlement, and redemption state.

Run one sync on a VPS with an existing MySQL database:

```bash
cd /root/ProbX/backend
go run ./cmd/indexer
```

Run as a long-lived worker:

```bash
PROBX_INDEXER_INTERVAL=15s go run ./cmd/indexer
```

The commands above read `backend/.env`, so `PROBX_DATABASE_DSN`, `PROBX_SOLANA_RPC_URL`, and `PROBX_PROGRAM_ID` can be stored there.

If the API is already running on `:8081`, the indexer does not need an HTTP port and can run in parallel. `GET /api/status` returns the program-event cursor and indexer lag, which helps verify whether the worker is catching up with the chain.

## PM2 Deployment

The repository includes a PM2 deployment script and GitHub Actions workflow:

```text
deploy/pm2-deploy.sh
deploy/pm2/ecosystem.config.cjs
.github/workflows/deploy-vps.yml
```

Initial VPS preparation:

```bash
npm install -g pm2
cd /root/ProbX
git pull
```

Make sure these files exist only locally on the VPS and are not committed:

```text
/root/ProbX/backend/.env
/root/ProbX/backend/.env.testnet
/root/ProbX/frontend/.env.local
```

If the frontend runs on `3001`, the backend CORS and frontend API settings can look like this:

```bash
# backend/.env
PROBX_HTTP_ADDR=:8081
PROBX_DATABASE_DSN=probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true
PROBX_CORS_ORIGINS=http://185.214.135.24:3001
PROBX_SOLANA_RPC_URL=https://api.devnet.solana.com
PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
PROBX_TRADE_VERIFICATION=confirmed
PROBX_MEDIA_DIR=data/media
PROBX_PUBLIC_BASE_URL=https://api.probx.site
PROBX_INDEXER_TIMEOUT=30s
PROBX_INDEXER_EVENT_LIMIT=5000
```

```bash
# frontend/.env.local
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_API_URL=https://api.probx.site
NEXT_PUBLIC_ENABLE_ONCHAIN=true
NEXT_PUBLIC_TESTNET_HOSTS=test.probx.site
NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL=https://api.testnet.solana.com
NEXT_PUBLIC_TESTNET_API_URL=https://test-api.probx.site
NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL
NEXT_PUBLIC_TESTNET_ENABLE_ONCHAIN=true
```

The testnet API/indexer uses `backend/.env.testnet`. Key differences:

```bash
PROBX_HTTP_ADDR=:8082
PROBX_CORS_ORIGINS=https://test.probx.site
PROBX_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_PROGRAM_ID=<ProbX program id deployed on testnet>
PROBX_PUBLIC_BASE_URL=https://test-api.probx.site
PROBX_TRADE_VERIFICATION=confirmed
```

Run a manual deployment:

```bash
cd /root/ProbX
PROBX_FRONTEND_PORT=3001 \
PROBX_EXPECTED_API_URL=https://api.probx.site \
bash deploy/pm2-deploy.sh
```

The deployment script pulls and resets to the remote branch, builds the Go backend, applies MySQL migrations from `backend/migrations/`, installs and builds the Vite frontend, and starts or reloads `probx-api`, `probx-indexer`, `probx-test-api`, `probx-test-indexer`, and `probx-frontend` through PM2.

`probx-indexer` is a long-lived PM2 worker and syncs on-chain markets, positions, and program events every `15s` by default. To change the interval:

```bash
PROBX_FRONTEND_PORT=3001 PROBX_PM2_INDEXER_INTERVAL=10s bash deploy/pm2-deploy.sh
```

Common PM2 checks:

```bash
pm2 list
pm2 logs probx-api --lines 80
pm2 logs probx-indexer --lines 120
pm2 logs probx-test-api --lines 80
pm2 logs probx-test-indexer --lines 120
pm2 restart probx-indexer --update-env
```

The API `GET /api/status` endpoint returns the indexer cursor and lag, which can be used to confirm whether the worker is catching up with the chain.

Enable PM2 startup on boot:

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints one command. Copy and run that command once.

For GitHub auto-deploy, add these Secrets in repository Settings -> Secrets and variables -> Actions:

```text
VPS_HOST=185.214.135.24
VPS_USER=root
VPS_SSH_KEY=private key used to log in to the VPS
VPS_SSH_PORT=22
VPS_PROJECT_DIR=/root/ProbX
```

Optional Variables:

```text
PROBX_FRONTEND_PORT=3001
PROBX_PM2_INDEXER_INTERVAL=15s
PROBX_PM2_TESTNET_INDEXER_INTERVAL=15s
PROBX_EXPECTED_API_URL=https://api.probx.site
PROBX_EXPECTED_TESTNET_SOLANA_RPC_URL=https://api.testnet.solana.com
PROBX_EXPECTED_TESTNET_API_URL=https://test-api.probx.site
PROBX_EXPECTED_TESTNET_HOSTS=test.probx.site
```

After that, every push to `main` runs `go test ./...` and frontend `npm run typecheck` in GitHub Actions. If both pass, the workflow SSHs into the VPS and runs `deploy/pm2-deploy.sh`.

Manually migrate an existing database:

```bash
cd /root/ProbX/backend
set -a
. ./.env
set +a
./scripts/migrate.sh
```

## Python Agent

The agent configuration is in `config.yaml`. The default is `dry_run: true`, and trade logs are written to `data/trades.csv`.

Run a multi-agent simulation:

```bash
./scripts/run_agent.sh simulate
```

Run one dry-run trading loop:

```bash
./scripts/run_agent.sh once
```

Run continuous polling:

```bash
./scripts/run_agent.sh loop
```

You can also pass arguments directly:

```bash
python3 agent.py --config config.yaml --simulate --agents 5 --steps 100
python3 agent.py --config config.yaml --once --dry-run
python3 agent.py --config config.yaml --loop
```

To make the agent fetch markets from the Go API, set `api_endpoint` in `config.yaml`, for example `http://localhost:8080/api/markets`. If `api_endpoint` is empty, the agent reads markets from Solana program accounts.

## Contract Model

### Market

Stores the market question, creator, resolver, YES/NO AMM pools, total liquidity, issued shares, end time, settlement status, and settlement outcome.

### Position

Stores a user's YES/NO outcome shares for a specific market. After the market is settled, the winning side can redeem rewards according to held shares.

### Instructions

- `create_market(question, end_time, initial_liquidity)`: creates a future-expiring AMM market and injects initial SOL liquidity.
- `buy_shares(amount, side, min_shares_out)`: buys YES or NO shares from the constant-product curve. `side = 1` means YES, and `side = 0` means NO.
- `sell_shares(shares, side, min_lamports_out)`: sells held shares back to the AMM before the market ends.
- `get_price()`: returns the YES probability, scaled as a `1_000_000_000` fixed-point value.
- `resolve_market(outcome)`: lets the resolver settle the outcome after expiry.
- `redeem_winnings()`: lets the winning side redeem rewards according to held shares.
- `place_bet(amount, side)` and `claim_reward()`: compatibility aliases for older clients. New code should use `buy_shares` and `redeem_winnings`.

## Check Commands

```bash
# Contract
anchor build
anchor test
npm run test:ts

# Go API
(cd backend && go test ./...)

# Frontend
(cd frontend && npm run typecheck)
(cd frontend && npm run build)

# Agent
./scripts/run_agent.sh simulate
```

## Notes

- `end_time` must be a future Unix timestamp.
- Market question text is limited to 280 bytes.
- Markets cannot be settled before expiry, and settled markets cannot continue trading.
- `sell_shares` and `redeem_winnings` preserve the Market account rent-exempt balance and only pay available lamports.
- `docker compose up -d mysql` only starts MySQL. The Go API and frontend need to be started separately.
- MySQL initialization scripts only run automatically when the data volume is created for the first time. Existing volumes require manual migrations or a rebuilt local development database.
