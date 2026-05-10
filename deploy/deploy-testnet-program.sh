#!/usr/bin/env bash
set -euo pipefail

TREASURY="${PROBX_TESTNET_TREASURY:-}"
FEE_BPS="${PROBX_TESTNET_PROTOCOL_FEE_BPS:-100}"
RPC_URL="${PROBX_TESTNET_SOLANA_RPC_URL:-https://api.testnet.solana.com}"
WALLET="${PROBX_TESTNET_WALLET:-${ANCHOR_WALLET:-$HOME/.config/solana/id.json}}"

log() {
  printf '[probx-testnet-program] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

if [ -z "$TREASURY" ]; then
  printf 'Set PROBX_TESTNET_TREASURY to the wallet that should receive protocol fees.\n' >&2
  exit 1
fi

require_cmd anchor
require_cmd solana
require_cmd npm

log "using wallet $WALLET"
solana config set --url "$RPC_URL" --keypair "$WALLET" >/dev/null
BALANCE="$(solana balance --url "$RPC_URL" --keypair "$WALLET" || true)"
log "deployer balance: $BALANCE"

log "building program"
anchor build

log "deploying program to testnet"
anchor deploy --provider.cluster testnet --provider.wallet "$WALLET"

PROGRAM_ID="$(solana address -k target/deploy/probx_prediction-keypair.json)"
log "program id: $PROGRAM_ID"

log "initializing/updating protocol config treasury=$TREASURY feeBps=$FEE_BPS"
ANCHOR_PROVIDER_URL="$RPC_URL" ANCHOR_WALLET="$WALLET" npm run protocol:config -- set --treasury "$TREASURY" --fee-bps "$FEE_BPS"

log "done"
printf 'PROBX_PROGRAM_ID=%s\n' "$PROGRAM_ID"
printf 'NEXT_PUBLIC_TESTNET_PROBX_PROGRAM_ID=%s\n' "$PROGRAM_ID"
