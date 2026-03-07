#!/bin/bash
# Sync OpenClaw workspace to GitHub

set -e

# Navigate to workspace
cd /root/.openclaw/workspace

# Add all changes
git add .

# Commit with timestamp
git commit -m "Daily sync: $(date '+%Y-%m-%d %H:%M:%S')" || true  # Don't fail if no changes

# Push to GitHub
git push
