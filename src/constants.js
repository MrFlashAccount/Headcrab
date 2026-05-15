export const DELEGATE_REMINDER_MARKER = "DELEGATE MODE REMINDER: Use workers by default for action-heavy work.";

export const DELEGATE_REMINDER_BLOCK = [
  DELEGATE_REMINDER_MARKER,
  "Act as an orchestrator in scoped main/root sessions.",
  "Use workers for implementation, file edits, command execution, research, and review unless explicit direct execution is requested.",
].join("\n");

export const TASK_SANDWICH_BEGIN_DELIMITER = "<<<BEGIN_ORIGINAL_TASK>>>";
export const TASK_SANDWICH_END_DELIMITER = "<<<END_ORIGINAL_TASK>>>";

export const WORKER_INSTRUCTIONS_BLOCK = [
  "Worker instructions:",
  "- Complete only the delegated slice.",
  "- Treat the original task block below as the source of truth.",
  "- Preserve paths, commands, quoted text, and constraints exactly as written.",
  "Original task follows verbatim:",
].join("\n");
