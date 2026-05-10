# ProbX Prediction Market

ProbX 是一个基于 Solana Anchor 的二元预测市场项目。仓库包含链上合约、Vite React 交易前端、Go REST API、MySQL 索引库，以及一个可 dry-run 或模拟运行的 Python 自动交易 agent。

市场使用 YES/NO 恒定乘积 AMM 表达概率，支持创建市场、买卖 outcome shares、查询 YES 概率、到期结算和赢家领取奖励。Solana 程序负责资金和结算，MySQL 负责面向前端和 agent 的查询索引。

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

## 功能概览

- Anchor 合约：创建市场、AMM 买卖份额、价格查询、结算市场、领取奖励。
- Go 后端：提供 REST API，使用 MySQL 保存市场、概率历史、持仓、交易记录和 agent 活动。
- Vite React 前端：市场列表、市场详情、交易面板、创建市场、持仓页、概率图表和 agent 活动流。
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

当访问域名匹配 `NEXT_PUBLIC_TESTNET_HOSTS`，例如 `test.probx.site`，前端会在运行时自动切到测试网模式：RPC 使用 `NEXT_PUBLIC_TESTNET_SOLANA_RPC_URL`，API 使用 `NEXT_PUBLIC_TESTNET_API_URL`，Explorer 链接使用 Solana testnet，页面顶部会显示 Testnet 标识。测试网用户需要在钱包切换到 Solana Testnet，并通过 Solana Faucet 获取测试 SOL。

Vite 配置会继续读取现有的 `NEXT_PUBLIC_*` 变量，方便从旧前端平滑迁移；也支持对应的 `VITE_*` 别名。

`NEXT_PUBLIC_X_URL`、`NEXT_PUBLIC_DISCORD_URL`、`NEXT_PUBLIC_TELEGRAM_URL`、`NEXT_PUBLIC_GITHUB_URL` 会渲染到顶部右侧和底部 ticker 右侧的社群图标入口。

`NEXT_PUBLIC_PROBX_PROGRAM_ID` 必须和当前 RPC 网络上部署的 ProbX 程序一致。`NEXT_PUBLIC_ENABLE_ONCHAIN=false` 时，交易和创建市场走前端/API 的模拟或索引流程。需要连接钱包并发送链上交易时，先启动 localnet 并部署合约，然后将 `NEXT_PUBLIC_ENABLE_ONCHAIN` 改为 `true`。

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

如果单独部署测试网 API/indexer，可以复制一套后端环境到另一台进程/域名，关键差异是：

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
PROBX_EXPECTED_API_URL=http://185.214.135.24:8081 \
bash deploy/pm2-deploy.sh
```

部署脚本会依次执行：拉取并重置到远程分支、构建 Go 后端、自动执行 `backend/migrations/` 下的 MySQL 迁移、安装并构建 Vite 前端、用 PM2 启动或重载 `probx-api`、`probx-indexer` 和 `probx-frontend`。

`probx-indexer` 是 PM2 常驻 worker，默认每 `15s` 同步一次链上市场、持仓和程序事件。需要调整频率时：

```bash
PROBX_FRONTEND_PORT=3001 PROBX_PM2_INDEXER_INTERVAL=10s bash deploy/pm2-deploy.sh
```

常用 PM2 检查命令：

```bash
pm2 list
pm2 logs probx-api --lines 80
pm2 logs probx-indexer --lines 120
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
PROBX_EXPECTED_API_URL=http://185.214.135.24:8081
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
