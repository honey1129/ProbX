#!/usr/bin/env bash
set -euo pipefail

BRANCH="${PROBX_DEPLOY_BRANCH:-main}"
PROJECT_DIR="${PROBX_PROJECT_DIR:-/root/ProbX}"
FRONTEND_PORT="${PROBX_FRONTEND_PORT:-3001}"
ECOSYSTEM_FILE="$PROJECT_DIR/deploy/pm2/ecosystem.config.cjs"

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

require_cmd git
require_cmd go
require_cmd npm
require_cmd pm2

if [ ! -d "$PROJECT_DIR/.git" ]; then
  printf 'Project directory is not a git checkout: %s\n' "$PROJECT_DIR" >&2
  exit 1
fi

require_file "$PROJECT_DIR/backend/.env"
require_file "$PROJECT_DIR/frontend/.env.local"

cd "$PROJECT_DIR"

log "updating repository in $PROJECT_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

log "building backend"
cd "$PROJECT_DIR/backend"
go build -o probx-api ./cmd/server

log "installing frontend dependencies"
cd "$PROJECT_DIR/frontend"
npm install

log "building frontend"
npm run build

log "starting or reloading PM2 apps on frontend port $FRONTEND_PORT"
cd "$PROJECT_DIR"
PROBX_PROJECT_DIR="$PROJECT_DIR" PROBX_FRONTEND_PORT="$FRONTEND_PORT" pm2 startOrReload "$ECOSYSTEM_FILE" --update-env
pm2 save

log "deployment complete"
pm2 list
