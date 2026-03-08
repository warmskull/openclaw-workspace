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
