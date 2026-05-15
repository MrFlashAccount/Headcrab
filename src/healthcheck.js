import { DELEGATE_REMINDER_MARKER } from "./constants.js";
import { OpenClawHookAdapter } from "./openclaw-hook-adapter.js";
import { FORTHRIGHT_WORKER_PREFIX } from "./core/task-sandwich-builder.js";

const PLUGIN_LOG_CODE = "delegate-mode-enforcer";
const HEALTHCHECK_SESSION_CONTEXT = Object.freeze({
  agentId: "main",
  sessionKey: "agent:main:telegram:direct:synthetic-healthcheck",
});
const MAX_PREPEND_CONTEXT_BYTES = 2_048;
const MAX_WRAPPED_TASK_BYTES = 4_096;
const MAX_LOG_CALLS = 8;
const ALLOWED_LOG_FIELDS = new Set(["plugin", "n", "hook", "stage", "outcome", "reason", "variant"]);
const REQUIRED_LOG_FIELDS = ["plugin", "n", "hook", "stage", "outcome", "reason"];
const ALLOWED_VARIANTS = new Set(["forthright", "legacy"]);
const TOKENIZED_BEGIN_DELIMITER_PATTERN = /<<<BEGIN_ORIGINAL_TASK:[a-f0-9-]+\.[a-f0-9]{16}>>>/g;
const TOKENIZED_END_DELIMITER_PATTERN = /<<<END_ORIGINAL_TASK:[a-f0-9-]+\.[a-f0-9]{16}>>>/g;

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function countOccurrences(input, needle) {
  return input.split(needle).length - 1;
}

function countMatches(input, pattern) {
  return input.match(pattern)?.length ?? 0;
}

function createCapturingLogger() {
  const calls = [];
  const logger = {};

  for (const level of ["debug", "info", "warn", "error"]) {
    logger[level] = (payload) => calls.push({ level, payload });
  }

  return { logger, calls };
}

function isBoundedTelemetryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const keys = Object.keys(payload);

  if (keys.some((key) => !ALLOWED_LOG_FIELDS.has(key))) {
    return false;
  }

  if (REQUIRED_LOG_FIELDS.some((key) => !Object.hasOwn(payload, key))) {
    return false;
  }

  if (payload.plugin !== PLUGIN_LOG_CODE) {
    return false;
  }

  if (!Number.isSafeInteger(payload.n) || payload.n < 1) {
    return false;
  }

  if (Object.hasOwn(payload, "variant") && !ALLOWED_VARIANTS.has(payload.variant)) {
    return false;
  }

  return true;
}

function toCheck(name, passed) {
  return {
    name,
    outcome: passed ? "PASS" : "FAIL",
  };
}

export function runDelegateModeHealthcheck() {
  const checks = [];
  const addCheck = (name, passed) => checks.push(toCheck(name, Boolean(passed)));
  const { logger, calls } = createCapturingLogger();
  const adapter = new OpenClawHookAdapter({ logger });

  const promptResult = adapter.beforePromptBuild({ prompt: "synthetic prompt", messages: [] }, HEALTHCHECK_SESSION_CONTEXT);
  const promptBlock = promptResult?.prependContext ?? "";

  addCheck(
    "promptReminder.single_injection_marker",
    typeof promptResult?.prependContext === "string" && countOccurrences(promptBlock, DELEGATE_REMINDER_MARKER) === 1,
  );
  addCheck("promptReminder.bounded_size", byteLength(promptBlock) > 0 && byteLength(promptBlock) <= MAX_PREPEND_CONTEXT_BYTES);

  const repeatedPromptResults = Array.from({ length: 3 }, () =>
    adapter.beforePromptBuild({ prompt: "synthetic prompt after compaction", messages: [] }, HEALTHCHECK_SESSION_CONTEXT),
  );
  addCheck(
    "promptReminder.repeated_rebuild_single_marker",
    repeatedPromptResults.every(
      (result) =>
        typeof result?.prependContext === "string"
        && countOccurrences(result.prependContext, DELEGATE_REMINDER_MARKER) === 1
        && byteLength(result.prependContext) <= MAX_PREPEND_CONTEXT_BYTES,
    ),
  );

  const firstWrap = adapter.beforeToolCall(
    { toolName: "sessions_spawn", params: { task: "synthetic delegated task", label: "healthcheck" } },
    HEALTHCHECK_SESSION_CONTEXT,
  );
  const wrappedTask = firstWrap?.params?.task ?? "";
  const secondWrap = firstWrap
    ? adapter.beforeToolCall({ toolName: "sessions_spawn", params: firstWrap.params }, HEALTHCHECK_SESSION_CONTEXT)
    : undefined;

  addCheck(
    "taskWrapping.forthright_variant_active",
    typeof wrappedTask === "string" && wrappedTask.startsWith(FORTHRIGHT_WORKER_PREFIX),
  );
  addCheck(
    "taskWrapping.no_duplicate_wrapping",
    secondWrap === undefined
      && countMatches(wrappedTask, TOKENIZED_BEGIN_DELIMITER_PATTERN) === 1
      && countMatches(wrappedTask, TOKENIZED_END_DELIMITER_PATTERN) === 1,
  );
  addCheck(
    "taskWrapping.bounded_size_and_counts",
    byteLength(wrappedTask) > 0
      && byteLength(wrappedTask) <= MAX_WRAPPED_TASK_BYTES
      && countMatches(wrappedTask, TOKENIZED_BEGIN_DELIMITER_PATTERN) === 1
      && countMatches(wrappedTask, TOKENIZED_END_DELIMITER_PATTERN) === 1,
  );

  addCheck(
    "telemetry.bounded_runtime_fields",
    calls.length > 0
      && calls.length <= MAX_LOG_CALLS
      && calls.every(({ payload }, index) => isBoundedTelemetryPayload(payload) && payload.n === index + 1),
  );

  const failed = checks.filter((check) => check.outcome === "FAIL").length;
  const passed = checks.length - failed;

  return {
    ok: failed === 0,
    checks,
    summary: {
      passed,
      failed,
    },
  };
}
