import { DelegateReminderRenderer } from "./core/delegate-reminder-renderer.js";
import { ScopeResolver } from "./core/scope-resolver.js";
import { SpawnTaskTransformer } from "./core/spawn-task-transformer.js";
import { TASK_SANDWICH_BEGIN_DELIMITER, TASK_SANDWICH_END_DELIMITER } from "./constants.js";

const PLUGIN_LOG_CODE = "delegate-mode-enforcer";

const HOOKS = Object.freeze({
  BEFORE_PROMPT_BUILD: "before_prompt_build",
  BEFORE_TOOL_CALL: "before_tool_call",
});

const LOG_STAGES = Object.freeze({
  HOOK: "hook",
});

const LOG_OUTCOMES = Object.freeze({
  APPLIED: "applied",
  ERROR: "error",
  SKIPPED: "skipped",
});

const LOG_REASONS = Object.freeze({
  ALREADY_SANDWICHED: "already_sandwiched",
  DELEGATE_REMINDER_INJECTED: "delegate_reminder_injected",
  FEATURE_DISABLED: "feature_disabled",
  HOOK_EXCEPTION: "hook_exception",
  INVALID_SESSIONS_SPAWN_TASK: "invalid_sessions_spawn_task",
  NON_SESSIONS_SPAWN: "non_sessions_spawn",
  SCOPE_NOT_TARGET: "scope_not_target",
  TASK_SANDWICH_APPLIED: "task_sandwich_applied",
  TRANSFORM_NOT_APPLICABLE: "transform_not_applicable",
});

const DEFAULT_FEATURES = Object.freeze({
  promptReminder: true,
  taskWrapping: true,
  forthrightCommunication: true,
});

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAlreadySandwiched(task) {
  return task.includes(TASK_SANDWICH_BEGIN_DELIMITER) && task.includes(TASK_SANDWICH_END_DELIMITER);
}

function getBeforeToolCallSkipReason(event) {
  if (!isObjectRecord(event) || event.toolName !== "sessions_spawn") {
    return LOG_REASONS.NON_SESSIONS_SPAWN;
  }

  if (!isObjectRecord(event.params) || typeof event.params.task !== "string") {
    return LOG_REASONS.INVALID_SESSIONS_SPAWN_TASK;
  }

  if (isAlreadySandwiched(event.params.task)) {
    return LOG_REASONS.ALREADY_SANDWICHED;
  }

  return LOG_REASONS.TRANSFORM_NOT_APPLICABLE;
}

function normalizeFeatures(features = {}) {
  return {
    ...DEFAULT_FEATURES,
    ...features,
  };
}

export class OpenClawHookAdapter {
  constructor({
    scopeResolver = new ScopeResolver(),
    delegateReminderRenderer = new DelegateReminderRenderer(),
    spawnTaskTransformer = new SpawnTaskTransformer(),
    features = DEFAULT_FEATURES,
    logger = undefined,
  } = {}) {
    this.scopeResolver = scopeResolver;
    this.delegateReminderRenderer = delegateReminderRenderer;
    this.spawnTaskTransformer = spawnTaskTransformer;
    this.features = normalizeFeatures(features);
    this.logger = logger;
    this.logCounter = 0;
  }

  beforePromptBuild(_event, ctx = {}) {
    try {
      if (!this.features.promptReminder) {
        this.#log("debug", HOOKS.BEFORE_PROMPT_BUILD, LOG_OUTCOMES.SKIPPED, LOG_REASONS.FEATURE_DISABLED);
        return undefined;
      }

      if (!this.scopeResolver.isScopedParentSession(ctx)) {
        this.#log("debug", HOOKS.BEFORE_PROMPT_BUILD, LOG_OUTCOMES.SKIPPED, LOG_REASONS.SCOPE_NOT_TARGET);
        return undefined;
      }

      const result = {
        prependContext: this.delegateReminderRenderer.render(),
      };

      this.#log(
        "info",
        HOOKS.BEFORE_PROMPT_BUILD,
        LOG_OUTCOMES.APPLIED,
        LOG_REASONS.DELEGATE_REMINDER_INJECTED,
      );
      return result;
    } catch (error) {
      this.#log("error", HOOKS.BEFORE_PROMPT_BUILD, LOG_OUTCOMES.ERROR, LOG_REASONS.HOOK_EXCEPTION);
      throw error;
    }
  }

  beforeToolCall(event = {}, ctx = {}) {
    try {
      if (!this.features.taskWrapping) {
        this.#log("debug", HOOKS.BEFORE_TOOL_CALL, LOG_OUTCOMES.SKIPPED, LOG_REASONS.FEATURE_DISABLED);
        return undefined;
      }

      if (!this.scopeResolver.isScopedParentSession(ctx)) {
        this.#log("debug", HOOKS.BEFORE_TOOL_CALL, LOG_OUTCOMES.SKIPPED, LOG_REASONS.SCOPE_NOT_TARGET);
        return undefined;
      }

      const eventParams = event && typeof event === "object" ? event.params : undefined;
      const transformedParams = this.spawnTaskTransformer.transform(event, {
        forthrightCommunication: this.features.forthrightCommunication,
      });

      if (!transformedParams || transformedParams === eventParams) {
        this.#log("debug", HOOKS.BEFORE_TOOL_CALL, LOG_OUTCOMES.SKIPPED, getBeforeToolCallSkipReason(event));
        return undefined;
      }

      this.#log("info", HOOKS.BEFORE_TOOL_CALL, LOG_OUTCOMES.APPLIED, LOG_REASONS.TASK_SANDWICH_APPLIED, {
        variant: this.features.forthrightCommunication ? "forthright" : "legacy",
      });
      return {
        params: transformedParams,
      };
    } catch (error) {
      this.#log("error", HOOKS.BEFORE_TOOL_CALL, LOG_OUTCOMES.ERROR, LOG_REASONS.HOOK_EXCEPTION);
      throw error;
    }
  }

  #log(level, hook, outcome, reason, { variant } = {}) {
    try {
      const loggerMethod = this.logger?.[level];

      if (typeof loggerMethod !== "function") {
        return;
      }

      const payload = {
        plugin: PLUGIN_LOG_CODE,
        n: this.logCounter + 1,
        hook,
        stage: LOG_STAGES.HOOK,
        outcome,
        reason,
      };

      if (variant === "forthright" || variant === "legacy") {
        payload.variant = variant;
      }

      this.logCounter += 1;
      loggerMethod.call(this.logger, payload);
    } catch {
      // Logging is best-effort only: logger failures must never affect hook behavior.
    }
  }
}
