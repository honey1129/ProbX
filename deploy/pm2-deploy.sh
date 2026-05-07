#!/usr/bin/env bash
set -euo pipefail

BRANCH="${PROBX_DEPLOY_BRANCH:-main}"
PROJECT_DIR="${PROBX_PROJECT_DIR:-/root/ProbX}"
FRONTEND_PORT="${PROBX_FRONTEND_PORT:-3001}"
ECOSYSTEM_FILE="$PROJECT_DIR/deploy/pm2/ecosystem.config.cjs"
FRONTEND_ENV_FILE="$PROJECT_DIR/frontend/.env.local"
FRONTEND_ENV_BACKUP=""

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
require_cmd curl

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

log "installing frontend dependencies"
cd "$PROJECT_DIR/frontend"
npm ci --legacy-peer-deps

log "building frontend"
npm cache verify >/dev/null 2>&1 || true
rm -rf .next
mkdir -p public
printf '{"commit":"%s","branch":"%s","builtAt":"%s"}\n' "$DEPLOY_COMMIT" "$BRANCH" "$DEPLOY_TIME" > public/deploy.json
npm run build

log "starting or reloading PM2 apps on frontend port $FRONTEND_PORT"
cd "$PROJECT_DIR"
PROBX_PROJECT_DIR="$PROJECT_DIR" PROBX_FRONTEND_PORT="$FRONTEND_PORT" pm2 startOrReload "$ECOSYSTEM_FILE" --update-env
pm2 save

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

log "deployment complete"
pm2 list
