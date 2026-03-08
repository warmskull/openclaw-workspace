#!/usr/bin/env bash
set -euo pipefail

# 个性化同步（单向）：作品 + 记忆 + 设置
SRC="/root/.openclaw"
DST="jianguo:/openclaw-personal"
STAGE="$(mktemp -d /tmp/openclaw-personal-sync.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

copy_file() {
  local rel="$1"
  if [ -e "$SRC/$rel" ]; then
    mkdir -p "$STAGE/$(dirname "$rel")"
    cp -a "$SRC/$rel" "$STAGE/$rel"
  fi
}

copy_dir() {
  local rel="$1"
  if [ -d "$SRC/$rel" ]; then
    mkdir -p "$STAGE/$rel"
    cp -a "$SRC/$rel/." "$STAGE/$rel/"
  fi
}

# 你的作品（工作区全量，含 skills / 项目 / 记忆 / 脚本）
copy_dir "workspace"

# 个性化设置
copy_file "openclaw.json"
copy_file "openclaw.json.bak"
copy_file "openclaw.json.bak.1"
copy_file "openclaw.json.bak.2"
copy_file "openclaw.json.bak.3"
copy_file "openclaw.json.bak.4"
copy_file "cron/jobs.json"
copy_file "cron/jobs.json.bak"
copy_file "memory/main.sqlite"

rclone sync "$STAGE" "$DST" \
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
  "$@"
