# AGENTS.md

Guidance for future agents working in this repository.

## Scope

This repo contains Headcrab, a small OpenClaw plugin for worker-first delegation. Work inside this repository only unless the user explicitly asks otherwise.

Do not edit OpenClaw core from this repo. Do not edit live OpenClaw config such as `~/.openclaw/openclaw.json` while working here unless the repository owner gives a separate explicit approval.

## Safety and privacy

- Do not add raw prompt, task, message, hook payload, session-key, direct-id, chat-id, user-id, config, path, secret, error-message, stack, or serialized exception logging.
- Tests, docs, and examples must use synthetic ids only.
- Keep healthcheck output bounded: PASS/FAIL check names and summary counts only.
- Prefer fail-closed behavior for invalid config or uncertain scope.

## Required verification

Before committing meaningful changes, run:

```sh
npm test
npm run check
npm run healthcheck
```

If a dependency or lockfile is introduced later, install dependencies as needed before running verification and document why.

## OpenClaw compatibility

- Preserve OpenClaw plugin manifest compatibility.
- Product/docs name may be Headcrab.
- Keep `package.json` `openclaw.extensions` pointing at `./index.js` unless the entrypoint changes intentionally.

## Subtree workflow note

This repository may be copied into an OpenClaw plugin directory or consumed as a git subtree by another repo. Keep the root self-contained: `package.json`, `openclaw.plugin.json`, `index.js`, `src/`, `scripts/`, `test/`, README, and license should travel together.
