#!/bin/bash
# Remind翟博 that shaomai is ready in 10 minutes
sleep 600
# Send reminder via OpenClaw CLI
openclaw message send --channel feishu --account new-bot --target "user:ou_f83a23d8a1a644713896e41fa5a977f6" --message "翟博，烧麦好啦！😸"
