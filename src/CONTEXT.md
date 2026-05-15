# `src/` context

## Purpose

`src/` contains the Headcrab runtime implementation behind the root plugin entrypoint. It owns plugin registration support, config normalization, OpenClaw hook adaptation, source-level healthcheck logic, and the pure core modules used by those shells.

## What belongs here

- OpenClaw-facing shell code that is still part of the plugin source.
- Config normalization and fail-closed effective-config construction.
- Hook adapter code for `before_prompt_build` and `before_tool_call`.
- Source healthcheck logic using synthetic fixtures only.
- Pure implementation modules under `src/core/`.
- Shared constants used by the plugin source and tests.

## What does not belong here

- Test fixtures or assertions; keep them in `test/`.
- CLI wrapper scripts; keep them in `scripts/`.
- OpenClaw core patches or global policy enforcement.
- Persistent stores, background jobs, schedulers, telemetry clients, or network clients.
- Architecture proposals, plans, or process notes; the active architecture contract is root `ARCHITECTURE.md`.

## Allowed dependencies

- `src/delegate-mode-plugin.js` may depend on `src/openclaw-hook-adapter.js` and `src/core/*` for wiring.
- `src/openclaw-hook-adapter.js` may depend on `src/core/*` and `src/constants.js`.
- `src/healthcheck.js` may depend on the adapter and constants to smoke-test runtime behavior.
- Node standard library is allowed when needed.

## Forbidden dependencies

- `src/core/*` must not import OpenClaw SDK/runtime APIs, plugin registration objects, loggers, tests, or scripts.
- Production source must not import from `test/` or `scripts/`.
- Runtime code must not introduce dependencies that persist prompts/tasks/session data or send telemetry/network traffic.

## Migration notes

- Keep `index.js` as the root package/plugin boundary; do not move OpenClaw `definePluginEntry` into `src/` unless the package shape changes deliberately.
- If more hooks are added, add them through the adapter shell first and keep new decision logic pure where possible.
- If config grows, preserve strict allow-list validation and fail closed on unknown or invalid shapes.
