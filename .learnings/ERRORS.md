# ERRORS.md

## [ERR-20260308-001] session_status_model_override

**Logged**: 2026-03-08T16:06:21+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
Attempt to set session model to `小熊api/gpt-5.3-codex` via `session_status` failed because the model is not in the allowed list.

### Error
```
Model "小熊api/gpt-5.3-codex" is not allowed.
```

### Context
- Operation attempted: `session_status({"model":"小熊api/gpt-5.3-codex"})`
- Trigger: user sent model name likely requesting model switch.
- Environment: OpenClaw main session (feishu).

### Suggested Fix
- Check allowed model IDs via runtime/policy before attempting model override.
- If blocked, report constraint and ask user to provide an allowed alternative or let system default apply.

### Metadata
- Reproducible: unknown
- Related Files: none
- See Also: none

---

## [ERR-20260309-001] sessions_spawn_mode_session_requires_thread

**Logged**: 2026-03-09T16:32:00+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
Spawning a persistent sub-agent session failed because `mode="session"` requires `thread=true`.

### Error
```
mode="session" requires thread=true so the subagent can stay bound to a thread.
```

### Context
- Operation attempted: `sessions_spawn` for a new investment agent session.
- Parameters used: `runtime="subagent"`, `mode="session"`, `thread` omitted.
- Environment: OpenClaw main session (feishu).

### Suggested Fix
- For persistent sub-agent sessions, always set `thread: true` together with `mode: "session"`.
- If thread binding is unnecessary, use `mode: "run"` instead.

### Metadata
- Reproducible: yes
- Related Files: none
- See Also: none

---

## [ERR-20260309-002] sessions_spawn_thread_unavailable_in_current_channel

**Logged**: 2026-03-09T16:34:00+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
Attempt to spawn a persistent sub-agent with `thread=true` failed because the current channel has no subagent thread-spawning hooks.

### Error
```
thread=true is unavailable because no channel plugin registered subagent_spawning hooks.
```

### Context
- Operation attempted: `sessions_spawn` with `runtime="subagent"`, `mode="session"`, `thread=true`.
- Goal: create a dedicated investment agent.
- Environment: OpenClaw main session (feishu direct).

### Suggested Fix
- Fall back to a local agent spec file + manual invocation flow in channels without thread-spawn hooks.
- Or use `mode:"run"` for one-shot sub-agent work when persistence is not required.

### Metadata
- Reproducible: yes
- Related Files: none
- See Also: ERR-20260309-001

---
