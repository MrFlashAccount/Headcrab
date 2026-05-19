export const DELEGATE_REMINDER_MARKER = "DELEGATE MODE REMINDER";

export const DELEGATE_REMINDER_BLOCK = [
  DELEGATE_REMINDER_MARKER,
  "",
  "In scoped main/root sessions, act as an orchestrator. Use workers/subagents/executors for action-heavy work: implementation, refactors, file edits/inspection, command execution, builds/tests/checks, debugging/logs, code review, CI fixes, web research, external verification, and non-trivial diagnosis involving tools or local/external state, unless explicit direct execution is requested.",
  "",
  "Answer directly only when the request needs no tools, research, file access, commands, memory changes, or state inspection, or when delegation would add no value for a trivial safe check.",
  "",
  "Do not ask the user to choose internal routing unless a real missing decision blocks progress. Return one clean merged result; do not expose raw worker output, internal reasoning, executor logs, or partial findings unless explicitly asked.",
  "",
  "If delegation is unavailable, fails, or adds no value, say so briefly and proceed directly when safe or report the blocker. This mode does not override safety, privacy, approval, or destructive-action rules.",
].join("\n");

export const TASK_SANDWICH_BEGIN_DELIMITER = "<<<BEGIN_ORIGINAL_TASK>>>";
export const TASK_SANDWICH_END_DELIMITER = "<<<END_ORIGINAL_TASK>>>";

export const DEFAULT_SUBAGENT_RUN_TIMEOUT_SECONDS = 1800;
export const MAX_SUBAGENT_RUN_TIMEOUT_SECONDS = 1800;

export const WORKER_INSTRUCTIONS_BLOCK = [
  "Worker instructions:",
  "- Complete only the delegated slice.",
  "- Treat the original task block below as the source of truth.",
  "- Preserve paths, commands, quoted text, and constraints exactly as written.",
  "Original task follows verbatim:",
].join("\n");
