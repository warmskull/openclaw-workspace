#!/usr/bin/env bash
set -euo pipefail
cd /root/.openclaw/workspace
TS=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %Z')

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit"
  exit 0
fi

git commit -m "$TS"
git push origin main
