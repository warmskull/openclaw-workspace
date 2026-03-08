# HEARTBEAT.md

## 面试备战提醒（字节豆包）

目标：在面试前，每天晚间提醒翟博进行 2 小时训练（口述 + coding hands-on）。

执行规则（每次心跳都检查）：
1. 当前时区按 Asia/Shanghai。
2. 若时间在 20:30-23:00 之间，检查 `memory/interview-reminder-log.md` 是否已有“当天日期”的提醒记录。
3. 若当天未提醒：发送一条提醒（不要包含 HEARTBEAT_OK），内容简短有行动性：
   - 提醒开始今晚 2 小时训练
   - 重申四段结构：20min口述 + 70min coding + 20min讲解 + 10min复盘
4. 发送后，在 `memory/interview-reminder-log.md` 追加一行：`YYYY-MM-DD reminded`。
5. 每周周报：若当天是周日且时间在 21:30-23:30，检查 `byte-doubao-prep-tracker/weekly/YYYY-Wxx.md` 是否存在：
   - 不存在：创建当周周报并发提醒告知用户查看
   - 存在但未更新本周进展：补充更新并发提醒
6. 若不在提醒窗口或无需动作，则回复 `HEARTBEAT_OK`。
