#!/usr/bin/env bash
set -euo pipefail

export TZ=Asia/Shanghai
ROOT="/root/.openclaw/workspace"
LOG_DIR="$ROOT/logs"
MEM_DIR="$ROOT/memory"
SYNC_SCRIPT="$ROOT/scripts/sync_to_jianguo.sh"
NIGHTLY_LOG="$LOG_DIR/nightly_assistant.log"

mkdir -p "$LOG_DIR" "$MEM_DIR"

TS="$(date '+%F %T')"
TODAY="$(date +%F)"
MEM_FILE="$MEM_DIR/$TODAY.md"

if [ ! -f "$MEM_FILE" ]; then
  echo "# $TODAY" > "$MEM_FILE"
fi

STATUS="成功"
DETAIL="坚果云个性化同步完成"

if ! "$SYNC_SCRIPT" >> "$NIGHTLY_LOG" 2>&1; then
  STATUS="失败"
  DETAIL="坚果云个性化同步失败（请查看 logs/sync_to_jianguo.log 与 logs/nightly_assistant.log）"
fi

{
  echo ""
  echo "## 夜间助手任务（$TS）"
  echo "- 坚果云个性化同步：$STATUS"
  echo "- 说明：$DETAIL"
} >> "$MEM_FILE"

echo "[$TS] 夜间任务执行：$STATUS" >> "$NIGHTLY_LOG"
