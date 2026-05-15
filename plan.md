# Delegate Mode Enforcer Plugin — Plan

## Goal

Create a small OpenClaw plugin that reinforces a delegation-first workflow without introducing blocking state machines or user-message rewriting.

V1 is intentionally narrow:

1. inject one transient delegate reminder in scoped main/root sessions;
2. wrap `sessions_spawn.task` in a worker-instructions task sandwich;
3. leave every non-`sessions_spawn` tool call unchanged.

## Why this slice

This is the smallest runtime slice that strengthens delegation behavior while staying low-risk and easy to verify.

- The reminder nudges the main assistant at prompt-build time.
- The spawn wrapper improves worker handoff quality.
- No tool blocking means V1 cannot deadlock the main session or require override UX.

## V1 scope

### 1. Transient delegate reminder

Hook:
- `before_prompt_build`

Behavior:
- inject only for scoped main/root sessions;
- skip worker/subagent sessions;
- return one transient context block per prompt build;
- the first line of that block is the delegate reminder marker/text;
- no persisted session flag and no accumulation across turns.

### 2. `sessions_spawn` task sandwich

Hook:
- `before_tool_call`

Behavior:
- only intercept `toolName === 'sessions_spawn'`;
- if `params.task` is a string, wrap it with worker instructions and delimiters;
- preserve the original task byte-for-byte inside delimiters;
- keep all non-task params intact.

### 3. No direct-tool blocking in V1

Behavior:
- `exec`, `edit`, `write`, `apply_patch`, and other direct tools are **not** blocked in V1;
- non-`sessions_spawn` tool calls pass through unchanged.

## Deferred to V2+

These ideas are explicitly deferred and should not be implemented in the current slice:

- direct-tool blocking / approval-based enforcement;
- `session_start` delegate-mode initialization or persisted `delegateMode` state;
- explicit direct-mode override UX;
- Forthright or LLM compression passes;
- `before_agent_finalize` response shaping;
- user message rewriting;
- broader workflow policy enforcement.

## Acceptance criteria

- main/root session gets one injected reminder block;
- worker/subagent session gets no reminder block;
- repeated prompt builds stay independent and do not accumulate reminder text;
- reminder marker appears exactly once in the injected block;
- non-`sessions_spawn` tool calls are unchanged;
- `sessions_spawn.task` is wrapped;
- original task is preserved byte-for-byte inside delimiters.

## Implementation notes

Suggested file shape:

- plugin scaffold (`package.json`, `openclaw.plugin.json`, `index.js`)
- pure core components:
  - `ScopeResolver`
  - `DelegateReminderRenderer`
  - `TaskSandwichBuilder`
  - `SpawnTaskTransformer`
- thin adapter shell:
  - `OpenClawHookAdapter`
  - `DelegateModePlugin`

## Tests

Use synthetic deterministic tests only.

Required coverage:

- reminder renderer returns a stable single block;
- repeated prompt builds produce independent single blocks / no accumulation;
- reminder marker appears exactly once;
- main/root scope injects;
- worker/subagent scope skips;
- non-`sessions_spawn` tool unchanged;
- `sessions_spawn.task` wrapped;
- original task preserved byte-for-byte inside delimiters.
