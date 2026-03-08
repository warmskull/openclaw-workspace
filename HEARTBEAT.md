# HEARTBEAT.md

## 夜间助手固定任务（不打扰用户）

目标：用户夜间休息，固定任务由助手后台执行。

执行规则（每次心跳都检查）：
1. 当前时区按 Asia/Shanghai。
2. 若时间在 22:30-07:30 之间：
   - 不给用户发送训练类提醒；
   - 仅做后台巡检：检查 `logs/nightly_assistant.log`、`logs/sync_to_jianguo.log` 最近状态。
3. 若发现紧急异常（连续失败、配置损坏风险）再提醒用户；否则静默处理。
4. 若不在该窗口或无需动作，则回复 `HEARTBEAT_OK`。

备注：固定夜间任务由 cron 执行
- `40 23 * * * /root/.openclaw/workspace/scripts/nightly_assistant_tasks.sh`
