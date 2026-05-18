# Headcrab

A small OpenClaw plugin for worker-first delegation.

Headcrab helps a main OpenClaw session hand work to subagents cleanly. It does three narrow things for scoped direct-message parent sessions:

- adds one transient delegation reminder during `before_prompt_build`;
- wraps only `sessions_spawn.params.task` during `before_tool_call` with a worker handoff block;
- normalizes `sessions_spawn.params.runTimeoutSeconds` to a 30-minute default and 30-minute maximum.

It does not block direct tools, persist delegation state, rewrite user messages, or add broad logging. The plugin is intentionally small and fail-closed.

## What it is for

Use Headcrab when you want the main assistant to prefer delegation for larger work while preserving the original task exactly for the worker.

It is not a scheduler, policy engine, permission system, or OpenClaw core patch. It only affects the plugin hooks it registers.

## Architecture and source context

- [ARCHITECTURE.md](./ARCHITECTURE.md) is the canonical product architecture contract.
- [src/CONTEXT.md](./src/CONTEXT.md) describes the source container boundary.
- [src/core/CONTEXT.md](./src/core/CONTEXT.md) describes the pure core boundary.

Historical proposal/plan documents are intentionally not kept in the active repo; useful decisions are distilled into the architecture contract above.

## Install / use

This repository is meant to be used as an OpenClaw plugin source tree. Headcrab is a native OpenClaw plugin and expects the OpenClaw plugin runtime/SDK to load `index.js`.

A raw standalone check such as `node -e "import('./index.js')"` outside OpenClaw can fail to resolve `openclaw/plugin-sdk/plugin-entry`; that is an expected OpenClaw runtime dependency for native plugins, not the correct standalone test path. Use OpenClaw plugin loading, or the development checks below, instead.

Typical local plugin path intent:

```jsonc
{
  "plugins": {
    "delegate-mode-enforcer": {
      "enabled": true,
      "path": "/path/to/Headcrab",
      "config": {}
    }
  }
}
```

If you keep OpenClaw plugins inside another repository, add Headcrab as a git subtree or copy this tree into your plugin directory. Keep the repository root intact so `package.json`, `openclaw.plugin.json`, `index.js`, `src/`, `scripts/`, and `test/` stay together.

Headcrab has no dependency on Delegate Mode Skill or any other OpenClaw skill. Its only OpenClaw-specific dependency is the expected OpenClaw runtime/SDK contract for native plugins.

> The plugin id remains `delegate-mode-enforcer` for manifest/config compatibility. The product name is Headcrab.

## Configuration

Global on/off is controlled by the top-level OpenClaw plugin `enabled` flag. There is no plugin-local `config.enabled`.

Default config:

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

### Scope

- `dm:*` selects any main/root direct-message session matching the known `agent:<agent>:<channel>:direct:<id>` shape.
- `dm:<id>` selects one direct-message session by direct/chat id.

Docs and tests use synthetic ids only, for example `dm:synthetic-direct-a`. Do not publish real chat ids, direct ids, raw session keys, or user identifiers in configs, docs, or test fixtures.

### Feature flags

- `promptReminder`: inject the transient reminder into scoped parent sessions.
- `taskWrapping`: wrap `sessions_spawn.params.task` from scoped parent sessions and normalize `sessions_spawn.params.runTimeoutSeconds`.
- `forthrightCommunication`: include the compact worker communication prefix in wrapped tasks.

Missing config, `{}`, missing `features`, and missing individual feature booleans all default to enabled. Explicit `false` disables only that feature.

Invalid config fails closed/inactive instead of widening activation.

Unsupported keys include `targetDirectIds`, `targetDirectSessionKeys`, plugin-local `enabled`, `directToolBlocking`, logging config, unknown top-level keys, unknown selectors, empty `scope`, non-string scope items, and non-boolean feature values.

## Runtime behavior

- Parent scoped direct-message sessions can receive the reminder and task wrapping.
- Child/subagent sessions do not inherit scope.
- Nested child spawns are not wrapped unless that child independently matches scope.
- Non-`sessions_spawn` tools are unchanged.
- `sessions_spawn.params.runTimeoutSeconds` defaults to `1800` when absent, invalid, or unlimited (`0`).
- `sessions_spawn.params.runTimeoutSeconds` is capped at `1800` when a higher value is requested.
- Explicit shorter positive `runTimeoutSeconds` values are preserved.
- Already wrapped tasks are not wrapped a second time.

## Healthcheck

Run:

```sh
npm run healthcheck
```

The healthcheck uses only synthetic cases. It prints bounded PASS/FAIL check names and counts. It must not print raw prompts, raw tasks, session ids, config payloads, paths, secrets, or hook payloads.

## Development

```sh
npm test
npm run check
npm run healthcheck
```

There are no runtime npm dependencies in this package. Do not add `openclaw` as a package `dependency` or `devDependency` just to make a standalone Node import work; OpenClaw supplies the plugin SDK import when it loads native plugins. Run `npm install` only if a future change adds a lockfile or dependencies that require it.

## Telemetry and logging

Headcrab emits low-noise best-effort logs through OpenClaw `api.logger` at the hook boundary:

- `debug` for expected skips and non-applicable hook outcomes;
- `info` when a reminder is injected or a task is wrapped;
- `error` for sanitized hook exceptions while preserving throw behavior.

Log payloads are intentionally coarse: plugin code, monotonic adapter counter, hook name, stage, outcome, bounded reason code, and optional wrapping variant.

The plugin must not log prompts, task text, user messages, rewritten text, raw hook/tool params, session keys, direct ids, chat/user/message ids, raw config, secrets, local paths, `Error.message`, stacks, causes, or serialized exceptions.

## Privacy and safety guarantees

Headcrab is designed to minimize data movement:

- no plugin-local persistent state;
- no plugin-local files or background jobs;
- no network calls;
- no raw prompt/task/session logging;
- synthetic-only tests and healthcheck fixtures.

Limits:

- OpenClaw core and other plugins may still log or persist data outside Headcrab.
- Headcrab cannot enforce delegation by itself; it only adds reminders and wraps spawn tasks.
- Misconfiguration can disable the plugin or narrow scope. Invalid config fails closed rather than guessing.

## License

See [LICENSE](./LICENSE).
