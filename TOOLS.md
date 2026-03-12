# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## OpenClaw 工具注意事项 (ERR-20260308/09)

### sessions_spawn — 持久会话

- `mode="session"` 必须搭配 `thread: true`，否则报错
- Feishu direct 频道**不支持** `thread=true`（无 subagent_spawning hooks）
- Feishu 下需要持久 agent → 改用 `mode="run"` 一次性执行，或本地 agent spec 文件

### session_status — 模型切换

- 通过 `session_status({"model": "..."})` 切换模型时，模型必须在白名单内
- 切换前先确认模型名称与 alias（参见 System Prompt 中的 Model Aliases）
- 若切换失败，报告限制并让用户提供允许的备选

###定时
当用户要求设置提醒或定时任务时，使用 cron.add 工具。
示例：用户说"30分钟后提醒我开会"，你应该调用 cron.add，
设置 schedule.at 为当前时间+30分钟的 ISO 8601 时间戳，
payload.kind 设为 "agentTurn"，payload.message 设为提醒内容。

作者：大瑜聊AI
链接：https://www.zhihu.com/question/2011480826848764785/answer/2011897770722755307
来源：知乎
著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。
