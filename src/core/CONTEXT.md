# `src/core/` context

## Purpose

`src/core/` is Headcrab's pure functional core. It decides whether a session is in scope, renders the stable reminder block, transforms eligible spawn-task params, and builds/verifies the task sandwich that preserves the original task.

## What belongs here

- Deterministic scope parsing and scoped-parent/worker classification.
- Stable reminder rendering with no runtime side effects.
- `sessions_spawn` task transformation logic that preserves non-task params.
- Task sandwich construction, delimiter collision avoidance, and duplicate-wrapper detection.
- Small pure helpers that can be tested without OpenClaw running.

## What does not belong here

- OpenClaw hook registration or plugin entrypoint code.
- `api.logger`, telemetry, metrics, tracing, or logging config.
- File system writes, persistence, network calls, background jobs, or schedulers.
- Test-only fixtures or synthetic healthcheck reporting.
- User/session-specific identifiers outside values passed into pure functions.

## Allowed dependencies

- `../constants.js` for canonical text and delimiter constants.
- Node standard library utilities when they support deterministic local behavior, such as hashing/signing delimiter tokens.
- Other modules inside `src/core/` when dependency direction remains simple and acyclic.

## Forbidden dependencies

- OpenClaw SDK/runtime APIs.
- `src/delegate-mode-plugin.js`, `src/openclaw-hook-adapter.js`, `src/healthcheck.js`, `index.js`, `test/`, or `scripts/`.
- Logger instances or code that emits runtime observability.
- Packages that move data outside the process.

## Migration notes

- Keep new policy decisions here only when they are pure and independent from hook shape.
- If a feature needs runtime context, translate that context in `OpenClawHookAdapter` and pass only the minimum plain data into core.
- If task wrapping evolves, preserve the invariant that the original task remains byte-for-byte between validated delimiters.
- If duplicate detection changes, keep it resilient against accidental delimiter collisions and partial/malformed wrappers.
