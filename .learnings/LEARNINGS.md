# LEARNINGS.md

## [LRN-20260308-001] correction

**Logged**: 2026-03-08T17:00:14+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
面试备战资料不能只给题目，用户需要“单文件可直接执行”的完整训练内容。

### Details
初版 GitHub 跟踪文件主要是按日期列题与清单。用户明确纠正：需要一个文件就能完成每天训练，必须包含详细答题框架、执行步骤、验收标准，而不是仅有题目列表。

### Suggested Action
默认为“备战/学习类项目”输出单文件主入口（MASTER_PREP_GUIDE），至少包含：
1) 固定训练节奏
2) 口述模板与标准答案骨架
3) hands-on 任务细化与验收标准
4) 每日复盘模板

### Metadata
- Source: user_feedback
- Related Files: byte-doubao-prep-tracker/MASTER_PREP_GUIDE.md
- Tags: interview-prep, execution, single-file
- See Also: none

---

## [LRN-20260308-002] best_practice

**Logged**: 2026-03-08T17:00:14+08:00
**Priority**: medium
**Status**: pending
**Area**: docs

### Summary
当用户要在 GitHub 跟踪个人计划时，应同时提供“目录式拆分 + 单文件总览入口”。

### Details
仅使用按天分文件适合归档，但用户实际执行偏好是“打开一个文件直接练”。双轨结构（daily/ + MASTER_PREP_GUIDE）兼顾可维护性和执行便利。

### Suggested Action
后续类似任务默认采用：
- `MASTER_PREP_GUIDE.md` 作为执行入口
- `daily/YYYY-MM-DD.md` 作为打卡与细分记录
- README 明确“建议先看 MASTER_PREP_GUIDE”

### Metadata
- Source: conversation
- Related Files: byte-doubao-prep-tracker/README.md
- Tags: planning, github-tracker, usability
- See Also: LRN-20260308-001

---
## [LRN-20260308-003] correction

**Logged**: 2026-03-08T21:49:00+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
当用户问“晚上固定任务”时，应优先给出“助手夜间自动执行、尽量不打扰用户”的任务清单，而不是给用户安排夜间训练。

### Details
用户明确纠正：晚上他的任务是睡觉，夜间应由助手承担后台固定任务。我之前给了用户夜间训练计划，方向偏了。

### Suggested Action
后续遇到“晚上固定任务/主动思考夜间任务”类请求，默认输出：
1) 助手后台巡检/同步/整理任务
2) 次晨汇总提醒（可静默）
3) 明确区分“用户要做”与“助手代做”

### Metadata
- Source: user_feedback
- Related Files: MEMORY.md, HEARTBEAT.md
- Tags: correction, proactive, nighttime, assistant-owned-tasks
- See Also: none

---
