# ProbX Prediction Market

ProbX 是一个基于 Solana Anchor 的二元预测市场项目，包含链上合约、Next.js 交易前端、Go API 后端、MySQL 索引库和 Python 自动交易 agent。市场以 YES/NO 两侧资金池表达概率，支持创建市场、下注、查询 YES 概率、到期结算和赢家领取奖励。

## 功能概览

- Anchor 合约：创建预测市场、下注、价格查询、结算市场、领取奖励。
- Go 后端：提供 REST API，使用 MySQL 存市场索引、持仓、交易记录和 agent 活动。
- Next.js 前端：市场列表、交易面板、持仓、概率图表、agent 活动流。
- Python agent：从链上或 API 拉取市场，基于动量、均值回归和外部信号做 dry-run/实盘下注，也支持多 agent 模拟。
- 本地开发：默认使用 localnet 程序 ID `4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL`。

## 目录结构

```text
.
├── programs/probx_prediction/   # Anchor 预测市场合约
├── tests/                       # Anchor TypeScript 测试
├── idl/                         # 合约 IDL
├── backend/                     # Go API + MySQL migrations
├── frontend/                    # Next.js 前端应用
├── agent.py                     # Python 交易 agent
├── config.yaml                  # agent 和 RPC 配置
└── scripts/run_agent.sh         # agent 启动脚本
```

## 环境要求

- Rust 和 Solana CLI
- Anchor CLI `0.31.x`
- Node.js `18+`
- Go `1.22+`
- MySQL `8+`，也可以直接使用仓库里的 Docker Compose
- Python `3.10+`
- 一个 Solana keypair，默认路径为 `~/.config/solana/id.json`

## 安装依赖

根目录合约测试依赖：

```bash
npm install
```

前端依赖：

```bash
cd frontend
npm install
```

Go 后端依赖：

```bash
cd backend
go mod tidy
```

Python agent 依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Go API 与 MySQL

启动 MySQL：

```bash
docker compose up -d mysql
```

`docker-compose.yml` 会在首次创建数据库时执行 `backend/migrations/*.sql`，包括建表和示例数据。

手动迁移已有数据库：

```bash
cd backend
PROBX_MYSQL_CLI_DSN=mysql://probx:probx@127.0.0.1:3306/probx ./scripts/migrate.sh
```

启动 Go API：

```bash
cd backend
PROBX_DATABASE_DSN='probx:probx@tcp(127.0.0.1:3306)/probx?parseTime=true&multiStatements=true' go run ./cmd/server
```

默认监听 `http://localhost:8080`。

常用接口：

```text
GET  /health
GET  /api/bootstrap?owner=local
GET  /api/markets
POST /api/markets
GET  /api/positions?owner=local
GET  /api/activity?limit=40
POST /api/trades
```

## 合约开发

构建合约：

```bash
anchor build
```

运行完整测试：

```bash
anchor test
```

只运行 TypeScript 测试脚本：

```bash
npm run test:ts
```

`Anchor.toml` 当前配置为 localnet：

```toml
[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
```

## 前端开发

创建前端环境文件：

```bash
cd frontend
cp .env.example .env.local
```

默认配置：

```bash
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_ENABLE_ONCHAIN=false
NEXT_PUBLIC_API_URL=http://localhost:8080
```

启动开发服务器：

```bash
npm run dev
```

打开 `http://localhost:3000`。

前端默认可以直接使用模拟市场数据。设置 `NEXT_PUBLIC_API_URL` 后，前端会通过 Go API 读写 MySQL；不设置时会回退到浏览器内存中的 mock 数据。需要连接链上交易时，先启动本地验证器并部署合约，然后将 `frontend/.env.local` 中的 `NEXT_PUBLIC_ENABLE_ONCHAIN` 改为 `true`。

```bash
solana-test-validator
anchor deploy
```

## Python Agent

agent 配置位于 `config.yaml`，默认 `dry_run: true`，交易日志写入 `data/trades.csv`。

运行模拟：

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

## 核心合约模型

### Market

保存市场问题、创建者、结算者、YES/NO 资金池、总流动性、结束时间和结算结果。

### Position

保存用户在指定市场中的 YES/NO 仓位，用于结算后按胜出池份额领取奖励。

### 指令

- `create_market(question, end_time)`：创建一个未来到期的预测市场。
- `place_bet(amount, side)`：下注到 YES 或 NO，`side = 1` 表示 YES，`side = 0` 表示 NO。
- `get_price()`：返回 YES 概率，按 `1_000_000_000` 定点数缩放。
- `resolve_market(outcome)`：市场到期后由 resolver 结算结果。
- `claim_reward()`：胜出方按份额领取奖励。

## 常用命令

```bash
# 合约
anchor build
anchor test

# 前端
cd frontend
npm run dev
npm run build
npm run typecheck

# Go API
docker compose up -d mysql
cd backend
go run ./cmd/server

# Agent
./scripts/run_agent.sh simulate
./scripts/run_agent.sh once
./scripts/run_agent.sh loop
```

## 注意事项

- `end_time` 必须是未来 Unix 时间戳。
- 问题文本最长为 280 bytes。
- 市场未到期不能结算，已结算市场不能继续下注。
- `claim_reward` 会保留 Market 账户租金豁免余额，只支付可用 lamports。
- 如果使用 `anchor test` 时本机缺少 `yarn`，请安装 yarn，或将 `Anchor.toml` 的测试脚本改为等价的 npm 命令。
