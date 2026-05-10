#!/usr/bin/env bash
set -euo pipefail

BRANCH="${PROBX_DEPLOY_BRANCH:-main}"
PROJECT_DIR="${PROBX_PROJECT_DIR:-/root/ProbX}"
FRONTEND_PORT="${PROBX_FRONTEND_PORT:-3001}"
PM2_INDEXER_INTERVAL="${PROBX_PM2_INDEXER_INTERVAL:-15s}"
ECOSYSTEM_FILE="$PROJECT_DIR/deploy/pm2/ecosystem.config.cjs"
FRONTEND_ENV_FILE="$PROJECT_DIR/frontend/.env.local"
FRONTEND_ENV_BACKUP=""
EXPECTED_SOLANA_RPC_URL="${PROBX_EXPECTED_SOLANA_RPC_URL:-https://api.devnet.solana.com}"
EXPECTED_PROGRAM_ID="${PROBX_EXPECTED_PROGRAM_ID:-4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL}"
EXPECTED_API_URL="${PROBX_EXPECTED_API_URL:-https://api.probx.site}"

export PATH="/usr/local/go/bin:/usr/lib/go/bin:/snap/bin:$HOME/go/bin:$PATH"

log() {
  printf '[probx-deploy] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_file() {
  if [ ! -f "$1" ]; then
    printf 'Missing required file: %s\n' "$1" >&2
    exit 1
  fi
}

load_env_file() {
  local env_file="$1"
  while IFS= read -r -d '' entry; do
    export "$entry"
  done < <(node - "$env_file" <<'NODE'
const fs = require("fs");

const envFile = process.argv[2];
if (!envFile || !fs.existsSync(envFile)) process.exit(0);

for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  process.stdout.write(`${match[1]}=${value}\0`);
}
NODE
)
}

require_cmd git
require_cmd go
require_cmd node
require_cmd npm
require_cmd pm2
require_cmd curl
require_cmd mysql

if [ ! -d "$PROJECT_DIR/.git" ]; then
  printf 'Project directory is not a git checkout: %s\n' "$PROJECT_DIR" >&2
  exit 1
fi

require_file "$PROJECT_DIR/backend/.env"
require_file "$PROJECT_DIR/frontend/.env.local"

restore_frontend_env() {
  if [ -n "$FRONTEND_ENV_BACKUP" ] && [ -f "$FRONTEND_ENV_BACKUP" ]; then
    mv -f "$FRONTEND_ENV_BACKUP" "$FRONTEND_ENV_FILE"
  fi
}

trap restore_frontend_env EXIT

if [ -f "$FRONTEND_ENV_FILE" ]; then
  FRONTEND_ENV_BACKUP="$(mktemp "${TMPDIR:-/tmp}/probx-frontend-env.XXXXXX")"
  cp "$FRONTEND_ENV_FILE" "$FRONTEND_ENV_BACKUP"
fi

cd "$PROJECT_DIR"

log "updating repository in $PROJECT_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

restore_frontend_env
FRONTEND_ENV_BACKUP=""

DEPLOY_COMMIT="$(git rev-parse --short HEAD)"
DEPLOY_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "checked out commit $DEPLOY_COMMIT"

log "building backend"
cd "$PROJECT_DIR/backend"
go build -o probx-api ./cmd/server
go build -o probx-indexer ./cmd/indexer

log "applying backend migrations"
load_env_file "$PROJECT_DIR/backend/.env"
API_ADDR="${PROBX_HTTP_ADDR:-:8080}"
API_PORT="${API_ADDR##*:}"
if [ -z "$API_PORT" ] || [ "$API_PORT" = "$API_ADDR" ]; then
  API_PORT="8080"
fi
if [ -z "${PROBX_SOLANA_RPC_URL:-}" ]; then
  printf 'Missing PROBX_SOLANA_RPC_URL in backend/.env\n' >&2
  exit 1
fi
if [ -z "${PROBX_PROGRAM_ID:-}" ]; then
  printf 'Missing PROBX_PROGRAM_ID in backend/.env\n' >&2
  exit 1
fi
TRADE_VERIFICATION="$(printf '%s' "${PROBX_TRADE_VERIFICATION:-}" | tr '[:upper:]' '[:lower:]')"
if [ "$PROBX_SOLANA_RPC_URL" != "$EXPECTED_SOLANA_RPC_URL" ]; then
  printf 'PROBX_SOLANA_RPC_URL must be %s for devnet deploy, got %s\n' "$EXPECTED_SOLANA_RPC_URL" "$PROBX_SOLANA_RPC_URL" >&2
  exit 1
fi
if [ "$PROBX_PROGRAM_ID" != "$EXPECTED_PROGRAM_ID" ]; then
  printf 'PROBX_PROGRAM_ID must be %s for devnet deploy, got %s\n' "$EXPECTED_PROGRAM_ID" "$PROBX_PROGRAM_ID" >&2
  exit 1
fi
if [ "$TRADE_VERIFICATION" != "confirmed" ]; then
  printf 'PROBX_TRADE_VERIFICATION must be confirmed for devnet deploy, got %s\n' "${PROBX_TRADE_VERIFICATION:-unset}" >&2
  exit 1
fi
MEDIA_DIR="${PROBX_MEDIA_DIR:-data/media}"
PUBLIC_BASE_URL="${PROBX_PUBLIC_BASE_URL:-}"
if [ -z "$PUBLIC_BASE_URL" ]; then
  printf 'Missing PROBX_PUBLIC_BASE_URL in backend/.env\n' >&2
  exit 1
fi
if [ "${PUBLIC_BASE_URL%/}" != "$EXPECTED_API_URL" ]; then
  printf 'PROBX_PUBLIC_BASE_URL must be %s for media URLs, got %s\n' "$EXPECTED_API_URL" "$PUBLIC_BASE_URL" >&2
  exit 1
fi
mkdir -p "$MEDIA_DIR"
"$PROJECT_DIR/backend/scripts/migrate.sh"

log "installing frontend dependencies"
cd "$PROJECT_DIR/frontend"
npm install --legacy-peer-deps

load_env_file "$FRONTEND_ENV_FILE"
if [ "${NEXT_PUBLIC_SOLANA_RPC_URL:-}" != "$EXPECTED_SOLANA_RPC_URL" ]; then
  printf 'NEXT_PUBLIC_SOLANA_RPC_URL must be %s for devnet deploy, got %s\n' "$EXPECTED_SOLANA_RPC_URL" "${NEXT_PUBLIC_SOLANA_RPC_URL:-unset}" >&2
  exit 1
fi
if [ "${NEXT_PUBLIC_PROBX_PROGRAM_ID:-}" != "$EXPECTED_PROGRAM_ID" ]; then
  printf 'NEXT_PUBLIC_PROBX_PROGRAM_ID must be %s for devnet deploy, got %s\n' "$EXPECTED_PROGRAM_ID" "${NEXT_PUBLIC_PROBX_PROGRAM_ID:-unset}" >&2
  exit 1
fi
if [ "${NEXT_PUBLIC_ENABLE_ONCHAIN:-}" != "true" ]; then
  printf 'NEXT_PUBLIC_ENABLE_ONCHAIN must be true for devnet deploy, got %s\n' "${NEXT_PUBLIC_ENABLE_ONCHAIN:-unset}" >&2
  exit 1
fi
if [ "${NEXT_PUBLIC_API_URL:-}" != "$EXPECTED_API_URL" ]; then
  printf 'NEXT_PUBLIC_API_URL must be %s for devnet deploy, got %s\n' "$EXPECTED_API_URL" "${NEXT_PUBLIC_API_URL:-unset}" >&2
  exit 1
fi

log "building frontend"
npm cache verify >/dev/null 2>&1 || true
rm -rf dist
mkdir -p public
node - "$DEPLOY_COMMIT" "$BRANCH" "$DEPLOY_TIME" > public/deploy.json <<'NODE'
const [, , commit, branch, builtAt] = process.argv;
process.stdout.write(JSON.stringify({
  commit,
  branch,
  builtAt,
  frontend: {
    apiUrl: process.env.NEXT_PUBLIC_API_URL || "",
    solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "",
    programId: process.env.NEXT_PUBLIC_PROBX_PROGRAM_ID || "",
    enableOnchain: process.env.NEXT_PUBLIC_ENABLE_ONCHAIN || ""
  }
}) + "\n");
NODE
npm run build

log "starting or reloading PM2 apps on frontend port $FRONTEND_PORT with indexer interval $PM2_INDEXER_INTERVAL"
cd "$PROJECT_DIR"
pm2 delete probx-frontend >/dev/null 2>&1 || true
PROBX_PROJECT_DIR="$PROJECT_DIR" PROBX_FRONTEND_PORT="$FRONTEND_PORT" PROBX_PM2_INDEXER_INTERVAL="$PM2_INDEXER_INTERVAL" pm2 startOrReload "$ECOSYSTEM_FILE" --update-env
pm2 save

log "verifying PM2 worker processes"
for attempt in $(seq 1 15); do
  PM2_STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/probx-pm2-status.XXXXXX")"
  pm2 jlist > "$PM2_STATUS_FILE"
  if node - "$PM2_STATUS_FILE" <<'NODE'
const fs = require("fs");
const statusFile = process.argv[2];
const apps = JSON.parse(fs.readFileSync(statusFile, "utf8") || "[]");
const required = ["probx-api", "probx-indexer", "probx-frontend"];
for (const name of required) {
  const app = apps.find((item) => item.name === name);
  const status = app?.pm2_env?.status || "missing";
  if (status !== "online") {
    console.error(`${name} is ${status}, expected online`);
    process.exit(1);
  }
}
console.log(`PM2 apps online: ${required.join(", ")}`);
NODE
  then
    rm -f "$PM2_STATUS_FILE"
    break
  fi
  rm -f "$PM2_STATUS_FILE"

  if [ "$attempt" -eq 15 ]; then
    pm2 logs probx-api --lines 60 --nostream || true
    pm2 logs probx-indexer --lines 60 --nostream || true
    pm2 logs probx-frontend --lines 60 --nostream || true
    exit 1
  fi

  sleep 2
done

log "verifying API devnet config"
for attempt in $(seq 1 30); do
  if status_json="$(curl -fsS "http://127.0.0.1:${API_PORT}/api/status" 2>/dev/null)"; then
    PROBX_STATUS_JSON="$status_json" node - "$PROBX_SOLANA_RPC_URL" "$PROBX_PROGRAM_ID" <<'NODE'
const expectedRpc = process.argv[2];
const expectedProgram = process.argv[3];
const status = JSON.parse(process.env.PROBX_STATUS_JSON || "{}");
if (status.solanaRpcUrl !== expectedRpc) {
  console.error(`API RPC mismatch: expected ${expectedRpc}, got ${status.solanaRpcUrl}`);
  process.exit(1);
}
if (status.programId !== expectedProgram) {
  console.error(`API program mismatch: expected ${expectedProgram}, got ${status.programId}`);
  process.exit(1);
}
if (status.tradeVerification !== "confirmed") {
  console.error(`API trade verification should be confirmed, got ${status.tradeVerification}`);
  process.exit(1);
}
if (!status.database || !status.database.ok) {
  console.error(`API database is not healthy: ${status.database?.error || "unknown error"}`);
  process.exit(1);
}
console.log(`API devnet config ok: rpc=${status.solanaRpcUrl} program=${status.programId} markets=${status.marketCount}`);
NODE
    log "API devnet config check passed"
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    printf 'API devnet config check failed\n' >&2
    pm2 logs probx-api --lines 80 --nostream || true
    exit 1
  fi

  sleep 2
done

log "verifying frontend health"
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null; then
    log "frontend health check passed"
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    printf 'Frontend health check failed on port %s\n' "$FRONTEND_PORT" >&2
    pm2 logs probx-frontend --lines 80 --nostream || true
    exit 1
  fi

  sleep 2
done

log "verifying frontend devnet config"
frontend_deploy_json="$(curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/deploy.json")"
PROBX_FRONTEND_DEPLOY_JSON="$frontend_deploy_json" node - "$DEPLOY_COMMIT" "$EXPECTED_SOLANA_RPC_URL" "$EXPECTED_PROGRAM_ID" "$EXPECTED_API_URL" <<'NODE'
const expectedCommit = process.argv[2];
const expectedRpc = process.argv[3];
const expectedProgram = process.argv[4];
const expectedApiUrl = process.argv[5];
const deploy = JSON.parse(process.env.PROBX_FRONTEND_DEPLOY_JSON || "{}");
const frontend = deploy.frontend || {};

if (deploy.commit !== expectedCommit) {
  console.error(`Frontend commit mismatch: expected ${expectedCommit}, got ${deploy.commit}`);
  process.exit(1);
}
if (frontend.solanaRpcUrl !== expectedRpc) {
  console.error(`Frontend RPC mismatch: expected ${expectedRpc}, got ${frontend.solanaRpcUrl}`);
  process.exit(1);
}
if (frontend.programId !== expectedProgram) {
  console.error(`Frontend program mismatch: expected ${expectedProgram}, got ${frontend.programId}`);
  process.exit(1);
}
if (frontend.enableOnchain !== "true") {
  console.error(`Frontend on-chain flag should be true, got ${frontend.enableOnchain}`);
  process.exit(1);
}
if (frontend.apiUrl !== expectedApiUrl) {
  console.error(`Frontend API URL mismatch: expected ${expectedApiUrl}, got ${frontend.apiUrl}`);
  process.exit(1);
}
console.log(`Frontend devnet config ok: commit=${deploy.commit} rpc=${frontend.solanaRpcUrl} program=${frontend.programId}`);
NODE

log "deployment complete"
pm2 list
