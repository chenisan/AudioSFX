#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v npm >/dev/null 2>&1 || { echo "[ERROR] npm not found"; exit 1; }
npm run dev
