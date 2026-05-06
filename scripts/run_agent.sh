#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-simulate}"
CONFIG="${CONFIG:-config.yaml}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

case "$MODE" in
  once)
    "$PYTHON_BIN" agent.py --config "$CONFIG" --once --dry-run
    ;;
  loop)
    "$PYTHON_BIN" agent.py --config "$CONFIG" --loop
    ;;
  simulate)
    "$PYTHON_BIN" agent.py --config "$CONFIG" --simulate
    ;;
  *)
    echo "Usage: $0 [once|loop|simulate]" >&2
    exit 1
    ;;
esac
