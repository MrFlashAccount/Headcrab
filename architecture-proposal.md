# Architecture Proposal: `delegate-mode-enforcer` V1

## 1. Architecture decision

Use a **minimal plugin middleware architecture**:

- not full Clean Architecture;
- not a heavy DDD package;
- not a single unstructured file;
- not ports/adapters for ceremony.

Shape: **functional core + OpenClaw plugin shell**.

Why:

- the feature is small;
- the runtime seams are clear: `before_prompt_build` and `before_tool_call`;
- the domain logic is simple, but should be isolated from OpenClaw SDK so it can be tested without running OpenClaw.

## 2. Ubiquitous language

Use these terms consistently in code and tests:

- `delegate reminder` — short instruction injected into prompt context.
- `injected context block` — transient block returned from `before_prompt_build`.
- `scoped parent session` — a parent session selected by config scope.
- `direct message session` — a direct message parent session selected by Direct Message selectors.
- `Direct Message selector` — `dm:*` for any matching direct message session, or `dm:<id>` for one direct/chat id. Examples use synthetic ids only, such as `dm:synthetic-direct-a`.
- `worker/subagent session` — delegated worker session.
- `spawn task` — `params.task` in `sessions_spawn`.
- `task sandwich` — wrapper around original task.
- `original task` — exact task text passed by main agent.
- `worker instructions` — additive instructions for the subagent.
- `single-instance injection` — reminder appears exactly once per prompt build.
- `no accumulation` — reminder is not written to history/memory and does not multiply between turns.

## 3. Bounded contexts

### Runtime Config Normalization

Owns:

- applying default effective config before user overrides;
- validating the plugin-local config surface;
- failing closed/inactive for invalid config.

Config surface:

- `scope`
- `features.promptReminder`
- `features.taskWrapping`
- `features.forthrightCommunication`

Defaults:

```json
{
  "scope": ["dm:*"],
  "features": {
    "promptReminder": true,
    "taskWrapping": true,
    "forthrightCommunication": true
  }
}
```

Supported selectors:

```json
{
  "scope": ["dm:*"]
}
```

```json
{
  "scope": ["dm:synthetic-direct-a"]
}
```

Rules:

- missing or empty plugin config uses defaults;
- provided `scope` replaces default scope;
- missing `features` or missing feature booleans default to `true`;
- explicit `false` disables only that feature;
- invalid config produces inactive effective config;
- mixed selector lists fail closed as a whole when any selector is invalid.

Rejected config:

- plugin-local `enabled`;
- legacy `targetDirectIds`;
- legacy `targetDirectSessionKeys`;
- `directToolBlocking`;
- local logging config;
- unknown top-level keys;
- unknown selectors;
- empty provided scope;
- non-string/empty scope items;
- non-boolean feature values.

The top-level OpenClaw plugin entry `enabled` remains the only global plugin on/off switch.

### Prompt Context Injection

Owns:

- deciding whether to inject the delegate reminder;
- applying the `features.promptReminder` gate;
- rendering one transient context block;
- preserving the `single-instance injection` / `no accumulation` invariant.

Does not own:

- blocking tools;
- rewriting user messages;
- persistent session state.

### Spawn Handoff Transformation

Owns:

- intercepting `sessions_spawn`;
- applying the `features.taskWrapping` gate;
- applying the `features.forthrightCommunication` gate for the compact worker communication prefix;
- preserving `original task` verbatim;
- adding `worker instructions`;
- building the `task sandwich`.

Does not own:

- real LLM compression;
- changing non-`sessions_spawn` tools;
- executing worker tasks.

### Runtime Scope Resolution

Owns:

- supporting Direct Message selectors `dm:*` and `dm:<id>`;
- distinguishing direct message parent sessions from worker/subagent sessions;
- preventing parent-scope behavior from being inherited by child/subagent sessions;
- returning inactive/no-match behavior for missing context or invalid resolver scope.

`dm:*` selects any matching direct message parent session with the known `agent:<agent>:<channel>:direct:<id>` session-key shape. `dm:<id>` selects one direct/chat id. Docs and tests use only safe synthetic examples, not private IDs or session keys.

### Runtime Observability

Owns:

- emitting best-effort sanitized logs from the OpenClaw runtime shell/adapter boundary;
- recording only coarse lifecycle outcomes for `before_prompt_build` and `before_tool_call`;
- preserving hook throw/swallow/return semantics when the logger is missing, partial, or throws.

Does not own:

- telemetry, metrics, tracing, persistence, or log configuration;
- logging inside core components;
- logging raw runtime payloads, prompts, tasks, config, identifiers, or exception content.

## 4. Structural entities

### `DelegateModePlugin`

Plugin entrypoint.

Registers:

- `before_prompt_build`
- `before_tool_call`

Contains wiring and config normalization, not domain logic.

### `ScopeResolver`

Pure core component.

Responsibilities:

- `isScopedParentSession(ctx): boolean`
- `isMainSession(ctx): boolean` compatibility alias for scoped parent behavior
- `isWorkerSession(ctx): boolean`

### `DelegateReminderRenderer`

Pure core component.

Responsibilities:

- return the stable delegate reminder block.

Invariant:

- first line of the block is always the delegate reminder marker/text.

### `SpawnTaskTransformer`

Pure core component.

Input:

- `toolName`
- `params`

Output:

- unchanged params if tool is not `sessions_spawn`;
- wrapped params if tool is `sessions_spawn` and `params.task` is a string.

### Compact worker communication prefix

Pure core constant/module.

Responsibilities:

- provide the canonical short handoff communication block used when `features.forthrightCommunication` is enabled;
- keep the wording centralized so docs and tests do not duplicate the runtime block.

### `TaskSandwichBuilder`

Pure core component.

Builds:

```text
Optional compact worker communication prefix
Worker instructions
Original task follows verbatim:
<<<BEGIN_ORIGINAL_TASK>>>
...
<<<END_ORIGINAL_TASK>>>
```

Guarantee:

- original task inside delimiters is not rewritten.

### `OpenClawHookAdapter`

Imperative shell.

Responsibilities:

- translate OpenClaw hook `ctx` / `params` into core calls;
- translate core results back into OpenClaw hook return values;
- apply feature gates;
- emit bounded sanitized observability events through optional `api.logger`.

Logging contract:

- `api.logger` is optional and best-effort only;
- missing level methods are ignored;
- logger exceptions are swallowed;
- hook behavior remains identical to the underlying request-path result.

## 5. Dependency rules

- `DelegateModePlugin` depends on `OpenClawHookAdapter` and `ScopeResolver`.
- `OpenClawHookAdapter` depends on core components.
- Core components do **not** import OpenClaw SDK.
- Core components are tested directly.
- OpenClaw-specific behavior is tested at adapter level with mocks.

Dependency direction:

```text
OpenClaw runtime
  -> DelegateModePlugin
    -> OpenClawHookAdapter
      -> ScopeResolver / DelegateReminderRenderer / SpawnTaskTransformer / TaskSandwichBuilder
```

## 6. Chosen runtime seams

### `before_prompt_build`

Use for:

- transient delegate reminder in scoped parent sessions only.

Do not use for:

- enforcement;
- state machine;
- rewriting user prompt.

### `before_tool_call`

Use only for:

- wrapping `sessions_spawn.params.task` in scoped parent sessions only.

Do not use in V1 for:

- blocking `exec` / `write` / `edit`;
- global tool policy;
- direct-mode override.

## 7. Invariants

- Default effective config is `scope = ["dm:*"]`, `features.promptReminder = true`, and `features.taskWrapping = true`.
- Default effective config also includes `features.forthrightCommunication = true`.
- Top-level OpenClaw plugin entry `enabled` is the only global on/off switch.
- Invalid config fails closed/inactive, not broad activation.
- Legacy direct-id/session-key targeting is removed with no compatibility path.
- Delegate reminder appears exactly once per prompt build.
- Delegate reminder is not saved to transcript, history, or memory.
- Delegate reminder is the first line of this plugin’s injected block.
- If exact placement directly before user prompt cannot be guaranteed, accepted fallback is: first line of plugin injected context.
- `sessions_spawn.params.task` original content is preserved verbatim.
- Spawn wrapper is additive, not destructive.
- Disabling `features.forthrightCommunication` preserves the existing non-prefix task sandwich when `features.taskWrapping` remains enabled.
- Non-`sessions_spawn` tool calls are unchanged.
- `promptReminder` applies only in scoped parent sessions.
- `taskWrapping` applies only to `sessions_spawn.params.task` calls made from a scoped parent session, using current hook `ctx.sessionKey`.
- Child/subagent sessions do not inherit scope.
- Nested child spawns are not wrapped unless that child independently matches scope.
- Observability never changes hook throw/swallow/return behavior.
- Core components and constants remain logger-free.
- No telemetry, metrics, tracing, persistence, or logging config toggle is introduced.

## 8. Important NFR: sanitized observability

Logging is an explicit runtime NFR for operator diagnosis, but it must stay privacy-preserving and behavior-neutral.

Boundary:

- emit logs only from `DelegateModePlugin` / `OpenClawHookAdapter` runtime shell code;
- do not inject loggers into `src/core/*` or `src/constants.js`;
- use only existing hooks: `before_prompt_build` and `before_tool_call`.

Allowed payload shape:

- `plugin`: static plugin code;
- `hook`: static hook code;
- `stage`: static stage code;
- `outcome`: bounded outcome code;
- `reason`: bounded reason code.

Level policy:

- expected skips and non-applicable outcomes use `debug`;
- lifecycle/applied outcomes use low-noise `info`;
- sanitized hook exceptions use `error` when the request path would throw.

Forbidden data:

- task, prompt, user, reminder, rewritten text;
- raw `params`, raw hook/tool payloads, raw config;
- `sessionKey`, `directId`, chat/user/message IDs, arbitrary identifiers;
- secrets, env values, tokens, headers;
- arbitrary paths;
- `Error.message`, stack, cause, error object, or serialized exception.

Request-path invariant:

- missing/partial/throwing logger must never change hook results;
- exceptions from hook logic are logged only as sanitized reason codes and then rethrown unchanged;
- no persistence, telemetry, metrics, tracing, or config toggle is added.

## 9. Required tests

- Runtime normalizer/default overlay: missing/empty config defaults, partial features default `true`, explicit `false` disables only one feature, invalid shapes inactive.
- Manifest schema accepts only `scope` and `features` and rejects removed/unknown keys when tested without adding new dependencies.
- `ScopeResolver` supports `dm:*`, `dm:<id>`, unscoped contexts, child/non-inheritance, missing context behavior, and mixed-invalid fail-closed behavior.
- `DelegateReminderRenderer` returns a stable single block.
- Three prompt builds produce independent blocks with no accumulation.
- Prompt build output contains exactly one delegate reminder marker.
- `SpawnTaskTransformer` ignores non-`sessions_spawn` tool calls.
- `SpawnTaskTransformer` wraps `sessions_spawn.params.task`.
- `SpawnTaskTransformer` includes the compact worker communication prefix by default.
- `features.forthrightCommunication = false` keeps the existing non-prefix task sandwich behavior.
- Original task is preserved byte-for-byte inside delimiters.
- Scoped parent sessions inject reminders and wrap `sessions_spawn.params.task`.
- Unscoped parents and child/subagent sessions do not wrap.
- Nested child spawns are not wrapped unless independently scoped.
- `promptReminder` and `taskWrapping` gates disable only their own features.
- Removed keys, unknown keys, and invalid shapes fail closed.
- Runtime logging emits sanitized applied/skipped/error events at expected levels.
- Missing, partial, and throwing loggers do not change behavior.
- Logger calls do not contain forbidden sensitive fields or raw content.

## 10. Explicit non-goals for V1

- No full direct-tool blocking.
- No fail-safe enforcement layer.
- No `session_start` persisted delegate mode.
- No LLM/Forthright compression pass.
- No heavy Clean Architecture package.
- No durable DDD artifact docs unless the plugin grows.
- No telemetry, metrics, tracing, persistence, or observability config toggle.
- No logging in `src/core/*`, `src/constants.js`, or OpenClaw core.
- No logging of task/prompt/user/reminder/rewritten text, raw runtime payloads, config, identifiers, secrets, or raw errors.

## 11. Final structural contract

Implement `delegate-mode-enforcer` V1 as a small OpenClaw plugin with a thin runtime shell and pure core components.

The plugin provides two middleware behaviors only:

1. `before_prompt_build` injects one transient delegate reminder for scoped direct message parent sessions.
2. `before_tool_call` wraps only `sessions_spawn.params.task` using a task sandwich that preserves original task verbatim, scoped to parent sessions only.

The architecture stays minimal: functional core, OpenClaw adapter shell, explicit ubiquitous language, strict config validation with fail-closed behavior, sanitized runtime observability, and tests proving no accumulation, task preservation, logger-free core, behavior-neutral logging, feature gates, and child-session non-inheritance.
