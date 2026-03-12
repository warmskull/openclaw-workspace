#!/usr/bin/env bash
set -euo pipefail

# 个性化同步（单向）：作品 + 记忆 + 设置
SRC="/root/.openclaw"
DST="jianguo:/openclaw-personal"

# 直接同步，避免先复制到 /tmp 导致磁盘占满
sync_workspace() {
  rclone sync "$SRC/workspace" "$DST/workspace" \
    --create-empty-src-dirs \
    --transfers 1 \
    --checkers 1 \
    --tpslimit 0.3 \
    --tpslimit-burst 1 \
    --disable-http2 \
    --local-no-check-updated \
    --retries 20 \
    --retries-sleep 2m \
    --contimeout 30s \
    --timeout 5m \
    --stats 30s \
    --verbose \
    --exclude ".git/**" \
    --exclude "**/.git/**" \
    --exclude ".venv/**" \
    --exclude ".venv-*/**" \
    --exclude "**/node_modules/**" \
    --exclude "**/__pycache__/**" \
    --exclude "**/.pytest_cache/**" \
    --exclude "**/.mypy_cache/**" \
    --exclude "*.pt" \
    "$@"
}

copy_optional() {
  local rel="$1"
  if [ -e "$SRC/$rel" ]; then
    rclone copyto "$SRC/$rel" "$DST/$rel" \
      --transfers 1 \
      --checkers 1 \
      --disable-http2 \
      --retries 20 \
      --retries-sleep 2m \
      --contimeout 30s \
      --timeout 5m \
      --verbose \
      "$@"
  fi
}

sync_workspace "$@"

# 个性化设置（逐个复制）
copy_optional "openclaw.json" "$@"
copy_optional "openclaw.json.bak" "$@"
copy_optional "openclaw.json.bak.1" "$@"
copy_optional "openclaw.json.bak.2" "$@"
copy_optional "openclaw.json.bak.3" "$@"
copy_optional "openclaw.json.bak.4" "$@"
copy_optional "cron/jobs.json" "$@"
copy_optional "cron/jobs.json.bak" "$@"
copy_optional "memory/main.sqlite" "$@"
