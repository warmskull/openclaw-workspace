#!/bin/bash
# Remind翟博 to research self-improving-agent in 2 minutes
sleep 120
# Send reminder via OpenClaw CLI
openclaw message send --channel feishu --account new-bot --target "user:ou_f83a23d8a1a644713896e41fa5a977f6" --message "翟博，该研究self-improving-agent啦！😸"
