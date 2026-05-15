import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DELEGATE_REMINDER_BLOCK,
  DELEGATE_REMINDER_MARKER,
  TASK_SANDWICH_BEGIN_DELIMITER,
  TASK_SANDWICH_END_DELIMITER,
  WORKER_INSTRUCTIONS_BLOCK,
} from "../src/constants.js";
import { DelegateReminderRenderer } from "../src/core/delegate-reminder-renderer.js";
import { DIRECT_MESSAGE_ALL_SCOPE_SELECTOR, ScopeResolver } from "../src/core/scope-resolver.js";
import { SpawnTaskTransformer } from "../src/core/spawn-task-transformer.js";
import {
  FORTHRIGHT_WORKER_PREFIX,
  INSTRUCTION_HIERARCHY_LINE,
  TaskSandwichBuilder,
} from "../src/core/task-sandwich-builder.js";
import {
  DEFAULT_DELEGATE_MODE_CONFIG,
  DelegateModePlugin,
  normalizeDelegateModeConfig,
} from "../src/delegate-mode-plugin.js";
import { runDelegateModeHealthcheck } from "../src/healthcheck.js";
import { OpenClawHookAdapter } from "../src/openclaw-hook-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../openclaw.plugin.json"), "utf8"));

const SYNTHETIC_DIRECT_ID = "synthetic-direct-a";
const OTHER_SYNTHETIC_DIRECT_ID = "synthetic-direct-b";

const MAIN_SESSION_CONTEXT = {
  agentId: "main",
  sessionKey: `agent:main:telegram:direct:${SYNTHETIC_DIRECT_ID}`,
};

const ROOT_SESSION_CONTEXT = {
  agentId: "root",
  sessionKey: `agent:root:telegram:direct:${SYNTHETIC_DIRECT_ID}`,
};

const OTHER_MAIN_SESSION_CONTEXT = {
  agentId: "main",
  sessionKey: `agent:main:telegram:direct:${OTHER_SYNTHETIC_DIRECT_ID}`,
};

const CHILD_SESSION_CONTEXT = {
  agentId: "main",
  sessionKey: "agent:main:subagent:synthetic-worker",
};

const BACKGROUND_WORKER_CONTEXT = {
  agentId: "main",
  sessionKey: "agent:main:background-worker:synthetic-job",
};

const UNSCOPED_CONTEXTS = [
  {
    name: "group main session",
    ctx: { agentId: "main", sessionKey: "agent:main:telegram:group:synthetic-chat" },
  },
  {
    name: "background worker session",
    ctx: BACKGROUND_WORKER_CONTEXT,
  },
  {
    name: "agent id without qualifying session key",
    ctx: { agentId: "main" },
  },
  {
    name: "missing context",
    ctx: undefined,
  },
];

function createAdapter({ pluginConfig, logger } = {}) {
  const registrations = [];

  new DelegateModePlugin().register({
    pluginConfig,
    logger,
    on(hookName, handler) {
      registrations.push({ hookName, handler });
    },
  });

  return {
    beforePromptBuild: registrations.find(({ hookName }) => hookName === "before_prompt_build").handler,
    beforeToolCall: registrations.find(({ hookName }) => hookName === "before_tool_call").handler,
  };
}

function countOccurrences(input, needle) {
  return input.split(needle).length - 1;
}

function countTaskSandwichDelimiters(input, type) {
  const pattern = new RegExp(`<<<${type}_ORIGINAL_TASK:[a-f0-9-]+\\.[a-f0-9]{16}>>>`, "g");
  return input.match(pattern)?.length ?? 0;
}

function extractTaskSandwichDelimiterLines(taskSandwich) {
  const lines = taskSandwich.split("\n");
  const beginLine = lines.find((line) => /^<<<BEGIN_ORIGINAL_TASK:[a-f0-9-]+\.[a-f0-9]{16}>>>$/.test(line));
  const endLine = lines[lines.length - 1];

  assert.notEqual(beginLine, undefined, "begin delimiter should exist");
  assert.match(endLine, /^<<<END_ORIGINAL_TASK:[a-f0-9-]+\.[a-f0-9]{16}>>>$/);

  return { beginLine, endLine };
}

function extractOriginalTask(taskSandwich) {
  const { beginLine, endLine } = extractTaskSandwichDelimiterLines(taskSandwich);
  const startToken = `${beginLine}\n`;
  const endToken = `\n${endLine}`;
  const startIndex = taskSandwich.indexOf(startToken);
  const endIndex = taskSandwich.lastIndexOf(endToken);

  assert.notEqual(startIndex, -1, "begin delimiter should exist");
  assert.notEqual(endIndex, -1, "end delimiter should exist");

  return taskSandwich.slice(startIndex + startToken.length, endIndex);
}

function createCapturingLogger() {
  const calls = [];
  const logger = {};

  for (const level of ["debug", "info", "warn", "error"]) {
    logger[level] = (payload) => calls.push({ level, payload });
  }

  return { logger, calls };
}

function assertSanitizedLogCall(call, expected) {
  assert.deepEqual(call, expected);
  assert.deepEqual(Object.keys(call.payload).sort(), Object.keys(expected.payload).sort());
  assert.equal(call.payload.plugin, "delegate-mode-enforcer");
  assert.equal(Number.isSafeInteger(call.payload.n), true);
  assert.equal(call.payload.n > 0, true);
  assert.equal(call.payload.stage, "hook");

  if (Object.hasOwn(call.payload, "variant")) {
    assert.ok(["forthright", "legacy"].includes(call.payload.variant));
  }

  const serialized = JSON.stringify(call);
  assert.equal(serialized.includes(SYNTHETIC_DIRECT_ID), false);
  assert.equal(serialized.includes("sessionKey"), false);
  assert.equal(serialized.includes("directId"), false);
  assert.equal(serialized.includes("Synthetic task"), false);
  assert.equal(serialized.includes("Run checks"), false);
  assert.equal(serialized.includes("sensitive boom"), false);
  assert.equal(serialized.includes("targetDirectIds"), false);
}

function validateConfigAgainstManifestSchema(value) {
  const schema = manifest.configSchema;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties, key)) {
      return false;
    }
  }

  if (Object.hasOwn(value, "scope")) {
    if (!Array.isArray(value.scope) || value.scope.length < schema.properties.scope.minItems) {
      return false;
    }

    const scopeItemPattern = new RegExp(schema.properties.scope.items.pattern);

    for (const selector of value.scope) {
      if (typeof selector !== "string" || !scopeItemPattern.test(selector)) {
        return false;
      }
    }
  }

  if (Object.hasOwn(value, "features")) {
    if (!value.features || typeof value.features !== "object" || Array.isArray(value.features)) {
      return false;
    }

    for (const key of Object.keys(value.features)) {
      if (!Object.hasOwn(schema.properties.features.properties, key)) {
        return false;
      }
      if (typeof value.features[key] !== schema.properties.features.properties[key].type) {
        return false;
      }
    }
  }

  return true;
}

function assertWrapped(result, originalTask) {
  assert.ok(result);
  assert.equal(
    result.params.task.startsWith(`${FORTHRIGHT_WORKER_PREFIX}\n${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}\n`),
    true,
  );
  const { beginLine, endLine } = extractTaskSandwichDelimiterLines(result.params.task);
  assert.equal(originalTask.includes(beginLine), false);
  assert.equal(originalTask.includes(endLine), false);
  assert.equal(extractOriginalTask(result.params.task), originalTask);
}

function assertLegacyWrapped(result, originalTask) {
  assert.ok(result);
  assert.equal(result.params.task.startsWith(`${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}\n`), true);
  assert.equal(result.params.task.includes(FORTHRIGHT_WORKER_PREFIX), false);
  const { beginLine, endLine } = extractTaskSandwichDelimiterLines(result.params.task);
  assert.equal(originalTask.includes(beginLine), false);
  assert.equal(originalTask.includes(endLine), false);
  assert.equal(extractOriginalTask(result.params.task), originalTask);
}

test("normalizer applies defaults when plugin config is missing or empty", () => {
  assert.deepEqual(normalizeDelegateModeConfig(undefined), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: true },
    },
  });

  assert.deepEqual(normalizeDelegateModeConfig({}), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: true },
    },
  });

  assert.deepEqual(DEFAULT_DELEGATE_MODE_CONFIG.scope, [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR]);
  assert.deepEqual(DEFAULT_DELEGATE_MODE_CONFIG.features, {
    promptReminder: true,
    taskWrapping: true,
    forthrightCommunication: true,
  });
});

test("normalizer overlays partial features and lets explicit false disable only one feature", () => {
  assert.deepEqual(normalizeDelegateModeConfig({ features: { promptReminder: false } }), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: false, taskWrapping: true, forthrightCommunication: true },
    },
  });

  assert.deepEqual(normalizeDelegateModeConfig({ features: { taskWrapping: false } }), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: false, forthrightCommunication: true },
    },
  });

  assert.deepEqual(normalizeDelegateModeConfig({ features: { forthrightCommunication: false } }), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: false },
    },
  });
});

test("normalizer uses user-provided scope as replacement for the default scope", () => {
  assert.deepEqual(normalizeDelegateModeConfig({ scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR] }), {
    valid: true,
    config: {
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: true },
    },
  });

  assert.deepEqual(normalizeDelegateModeConfig({ scope: [`dm:${SYNTHETIC_DIRECT_ID}`] }), {
    valid: true,
    config: {
      scope: [`dm:${SYNTHETIC_DIRECT_ID}`],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: true },
    },
  });
});

test("normalizer rejects old keys, unknown keys, unknown selectors, empty scope, and invalid shapes", () => {
  const invalidConfigs = [
    null,
    [],
    "enabled",
    { enabled: true },
    { targetDirectIds: ["synthetic-direct"] },
    { targetDirectSessionKeys: ["agent:main:telegram:direct:synthetic-direct"] },
    { directToolBlocking: true },
    { logging: { enabled: true } },
    { unknown: true },
    { scope: [] },
    { scope: [""] },
    { scope: ["dm:"] },
    { scope: ["dm:any"] },
    { scope: ["dm:synthetic:bad"] },
    { scope: ["unknown-selector"] },
    { scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR, "dm:"] },
    { features: null },
    { features: [] },
    { features: { promptReminder: "false" } },
    { features: { taskWrapping: 0 } },
    { features: { forthrightCommunication: "no" } },
    { features: { promptReminder: true, unknown: false } },
  ];

  for (const invalidConfig of invalidConfigs) {
    assert.deepEqual(normalizeDelegateModeConfig(invalidConfig), {
      valid: false,
      config: { scope: [], features: { promptReminder: false, taskWrapping: false, forthrightCommunication: false } },
    });
  }
});

test("manifest config schema accepts the supported surface and rejects removed keys", () => {
  assert.equal(validateConfigAgainstManifestSchema({}), true);
  assert.equal(validateConfigAgainstManifestSchema({ scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR] }), true);
  assert.equal(validateConfigAgainstManifestSchema({ scope: [`dm:${SYNTHETIC_DIRECT_ID}`] }), true);
  assert.equal(validateConfigAgainstManifestSchema({ features: { promptReminder: false } }), true);
  assert.equal(validateConfigAgainstManifestSchema({ features: { taskWrapping: false } }), true);
  assert.equal(validateConfigAgainstManifestSchema({ features: { forthrightCommunication: false } }), true);
  assert.equal(
    validateConfigAgainstManifestSchema({
      scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR],
      features: { promptReminder: true, taskWrapping: true, forthrightCommunication: true },
    }),
    true,
  );

  assert.equal(validateConfigAgainstManifestSchema({ enabled: true }), false);
  assert.equal(validateConfigAgainstManifestSchema({ targetDirectIds: ["synthetic-direct"] }), false);
  assert.equal(
    validateConfigAgainstManifestSchema({
      targetDirectSessionKeys: ["agent:main:telegram:direct:synthetic-direct"],
    }),
    false,
  );
  assert.equal(validateConfigAgainstManifestSchema({ directToolBlocking: true }), false);
  assert.equal(validateConfigAgainstManifestSchema({ scope: [] }), false);
  assert.equal(validateConfigAgainstManifestSchema({ scope: ["dm:"] }), false);
  assert.equal(validateConfigAgainstManifestSchema({ scope: ["dm:any"] }), false);
  assert.equal(validateConfigAgainstManifestSchema({ scope: ["dm:synthetic:bad"] }), false);
  assert.equal(validateConfigAgainstManifestSchema({ scope: ["unknown-selector"] }), false);
  assert.equal(validateConfigAgainstManifestSchema({ features: { promptReminder: "false" } }), false);
  assert.equal(validateConfigAgainstManifestSchema({ features: { forthrightCommunication: "false" } }), false);
  assert.equal(validateConfigAgainstManifestSchema({ features: { unknown: true } }), false);
});

test("reminder renderer returns a stable single block", () => {
  const renderer = new DelegateReminderRenderer();

  assert.equal(renderer.render(), DELEGATE_REMINDER_BLOCK);
  assert.equal(renderer.render(), DELEGATE_REMINDER_BLOCK);
});

test("repeated prompt builds produce independent single blocks with no accumulation", () => {
  const adapter = createAdapter();
  const builds = Array.from({ length: 3 }, () =>
    adapter.beforePromptBuild({ prompt: "Synthetic prompt", messages: [] }, MAIN_SESSION_CONTEXT),
  );

  assert.equal(builds.length, 3);

  for (const build of builds) {
    assert.deepEqual(build, { prependContext: DELEGATE_REMINDER_BLOCK });
    assert.equal(countOccurrences(build.prependContext, DELEGATE_REMINDER_MARKER), 1);
  }
});

test("reminder marker appears exactly once in the returned block", () => {
  const adapter = createAdapter();
  const result = adapter.beforePromptBuild({ prompt: "Hello", messages: [] }, MAIN_SESSION_CONTEXT);

  assert.ok(result);
  assert.equal(countOccurrences(result.prependContext, DELEGATE_REMINDER_MARKER), 1);
  assert.equal(result.prependContext.split("\n")[0], DELEGATE_REMINDER_MARKER);
});

test("scope resolver matches direct message parent sessions for dm:*", () => {
  const resolver = new ScopeResolver({ scope: [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR] });

  assert.equal(resolver.isScopedParentSession(MAIN_SESSION_CONTEXT), true);
  assert.equal(resolver.isScopedParentSession(ROOT_SESSION_CONTEXT), true);
  assert.equal(resolver.isMainSession(MAIN_SESSION_CONTEXT), true);

  for (const { name, ctx } of UNSCOPED_CONTEXTS) {
    assert.equal(resolver.isScopedParentSession(ctx), false, name);
  }
});

test("scope resolver supports dm:<id> for one direct message session", () => {
  const resolver = new ScopeResolver({ scope: [`dm:${SYNTHETIC_DIRECT_ID}`] });

  assert.equal(resolver.isScopedParentSession(MAIN_SESSION_CONTEXT), true);
  assert.equal(resolver.isScopedParentSession(ROOT_SESSION_CONTEXT), true);
  assert.equal(resolver.isScopedParentSession(OTHER_MAIN_SESSION_CONTEXT), false);
});

test("scope resolver rejects dm:any instead of treating it as a wildcard", () => {
  const resolver = new ScopeResolver({ scope: ["dm:any"] });

  assert.equal(resolver.isScopedParentSession(MAIN_SESSION_CONTEXT), false);
  assert.equal(resolver.isScopedParentSession(OTHER_MAIN_SESSION_CONTEXT), false);
});

test("scope resolver fails closed for missing, empty, unknown, or mixed invalid scope", () => {
  for (const scope of [[], ["dm:"], [""], [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR, "dm:"]]) {
    const resolver = new ScopeResolver({ scope });
    assert.equal(resolver.isScopedParentSession(MAIN_SESSION_CONTEXT), false);
  }
});

test("child and worker sessions do not inherit parent scope", () => {
  const adapter = createAdapter();
  const task = "Synthetic task";

  assert.equal(adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, CHILD_SESSION_CONTEXT), undefined);
  assert.equal(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task } }, CHILD_SESSION_CONTEXT),
    undefined,
  );
});

test("scoped parent sessions inject the delegate reminder", () => {
  const adapter = createAdapter();

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Hello", messages: [] }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Hello", messages: [] }, ROOT_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
});

test("unscoped contexts skip reminder injection", () => {
  const adapter = createAdapter();

  for (const { name, ctx } of UNSCOPED_CONTEXTS) {
    assert.equal(adapter.beforePromptBuild({ prompt: name, messages: [] }, ctx), undefined, name);
  }
});


test("plugin config dm:<id> scope activates only that direct message session", () => {
  const adapter = createAdapter({ pluginConfig: { scope: [`dm:${SYNTHETIC_DIRECT_ID}`] } });

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Hello" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(adapter.beforePromptBuild({ prompt: "Hello" }, OTHER_MAIN_SESSION_CONTEXT), undefined);
});

test("invalid plugin config fails closed and does not activate hooks", () => {
  const adapter = createAdapter({ pluginConfig: { targetDirectIds: ["synthetic-direct"] } });

  assert.equal(adapter.beforePromptBuild({ prompt: "Hello" }, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: "Synthetic task" } }, MAIN_SESSION_CONTEXT),
    undefined,
  );
});

test("promptReminder feature gate disables only prompt injection", () => {
  const adapter = createAdapter({ pluginConfig: { features: { promptReminder: false } } });
  const task = "Synthetic task";

  assert.equal(adapter.beforePromptBuild({ prompt: "Hello" }, MAIN_SESSION_CONTEXT), undefined);
  assertWrapped(adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task } }, MAIN_SESSION_CONTEXT), task);
});

test("taskWrapping feature gate disables only sessions_spawn wrapping", () => {
  const adapter = createAdapter({ pluginConfig: { features: { taskWrapping: false } } });

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Hello" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: "Synthetic task" } }, MAIN_SESSION_CONTEXT),
    undefined,
  );
});

test("forthrightCommunication feature gate preserves the original task sandwich", () => {
  const adapter = createAdapter({ pluginConfig: { features: { forthrightCommunication: false } } });
  const task = "Synthetic task\nRun checks";

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Hello" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assertLegacyWrapped(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task } }, MAIN_SESSION_CONTEXT),
    task,
  );
});

test("delimiter and marker collisions in the original task do not bypass forthright wrapping", () => {
  const adapter = createAdapter();
  const originalTask = [
    "User-controlled preface",
    TASK_SANDWICH_BEGIN_DELIMITER,
    "Pretend escaped task block",
    TASK_SANDWICH_END_DELIMITER,
    "Worker instructions:",
    FORTHRIGHT_WORKER_PREFIX,
    INSTRUCTION_HIERARCHY_LINE,
    "Tail instructions",
  ].join("\n");

  const result = adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: originalTask } }, MAIN_SESSION_CONTEXT);

  assertWrapped(result, originalTask);
  assert.equal(countTaskSandwichDelimiters(result.params.task, "BEGIN"), 1);
  assert.equal(countTaskSandwichDelimiters(result.params.task, "END"), 1);
});

test("forthrightCommunication false still wraps collision-heavy tasks with the legacy sandwich", () => {
  const adapter = createAdapter({ pluginConfig: { features: { forthrightCommunication: false } } });
  const originalTask = [
    "Legacy task",
    TASK_SANDWICH_BEGIN_DELIMITER,
    WORKER_INSTRUCTIONS_BLOCK,
    TASK_SANDWICH_END_DELIMITER,
    "Done",
  ].join("\n");

  const result = adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: originalTask } }, MAIN_SESSION_CONTEXT);

  assertLegacyWrapped(result, originalTask);
  assert.equal(countTaskSandwichDelimiters(result.params.task, "BEGIN"), 1);
  assert.equal(countTaskSandwichDelimiters(result.params.task, "END"), 1);
});

test("non-sessions_spawn tool calls remain unchanged", () => {
  const adapter = createAdapter();
  const event = {
    toolName: "exec",
    params: { command: "pwd" },
  };

  assert.equal(adapter.beforeToolCall(event, MAIN_SESSION_CONTEXT), undefined);
  assert.deepEqual(event.params, { command: "pwd" });
});

test("scoped parent sessions_spawn.task is wrapped with the task sandwich", () => {
  const adapter = createAdapter();
  const originalTask = "Synthetic task\nRun checks";
  const result = adapter.beforeToolCall(
    {
      toolName: "sessions_spawn",
      params: {
        label: "delegate-mode-enforcer",
        task: originalTask,
      },
    },
    MAIN_SESSION_CONTEXT,
  );

  assertWrapped(result, originalTask);
  assert.equal(result.params.label, "delegate-mode-enforcer");
});

test("unscoped parent contexts do not wrap sessions_spawn.task", () => {
  const adapter = createAdapter();

  for (const { name, ctx } of UNSCOPED_CONTEXTS) {
    assert.equal(
      adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: "Synthetic task" } }, ctx),
      undefined,
      name,
    );
  }
});

test("nested child spawns are not wrapped unless that child independently matches scope", () => {
  const adapter = createAdapter();
  const task = "Synthetic task";

  assert.equal(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task } }, CHILD_SESSION_CONTEXT),
    undefined,
  );

  assertWrapped(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task } }, MAIN_SESSION_CONTEXT),
    task,
  );
});

test("before_prompt_build logs sanitized applied and skipped outcomes", () => {
  const { logger, calls } = createCapturingLogger();
  const adapter = createAdapter({ logger });

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Synthetic prompt", messages: [] }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(adapter.beforePromptBuild({ prompt: "Synthetic prompt", messages: [] }, CHILD_SESSION_CONTEXT), undefined);

  assert.equal(calls.length, 2);
  assertSanitizedLogCall(calls[0], {
    level: "info",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 1,
      hook: "before_prompt_build",
      stage: "hook",
      outcome: "applied",
      reason: "delegate_reminder_injected",
    },
  });
  assertSanitizedLogCall(calls[1], {
    level: "debug",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 2,
      hook: "before_prompt_build",
      stage: "hook",
      outcome: "skipped",
      reason: "scope_not_target",
    },
  });
});

test("before_tool_call logs sanitized applied and skipped outcomes", () => {
  const { logger, calls } = createCapturingLogger();
  const adapter = createAdapter({ logger });
  const task = "Synthetic task\nRun checks";

  const applied = adapter.beforeToolCall(
    {
      toolName: "sessions_spawn",
      params: {
        label: "delegate-mode-enforcer",
        task,
      },
    },
    MAIN_SESSION_CONTEXT,
  );
  const skipped = adapter.beforeToolCall({ toolName: "exec", params: { command: "pwd" } }, MAIN_SESSION_CONTEXT);

  assert.ok(applied);
  assert.equal(skipped, undefined);
  assert.equal(calls.length, 2);
  assertSanitizedLogCall(calls[0], {
    level: "info",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 1,
      hook: "before_tool_call",
      stage: "hook",
      outcome: "applied",
      reason: "task_sandwich_applied",
      variant: "forthright",
    },
  });
  assertSanitizedLogCall(calls[1], {
    level: "debug",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 2,
      hook: "before_tool_call",
      stage: "hook",
      outcome: "skipped",
      reason: "non_sessions_spawn",
    },
  });
});

test("before_tool_call logs bounded skipped reasons", () => {
  const { logger, calls } = createCapturingLogger();
  const adapter = createAdapter({ logger });
  const first = adapter.beforeToolCall(
    {
      toolName: "sessions_spawn",
      params: { task: "Synthetic task", mode: "run" },
    },
    MAIN_SESSION_CONTEXT,
  );

  assert.ok(first);
  assert.equal(
    adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: 42 } }, MAIN_SESSION_CONTEXT),
    undefined,
  );
  assert.equal(adapter.beforeToolCall({ toolName: "sessions_spawn", params: first.params }, MAIN_SESSION_CONTEXT), undefined);

  assert.deepEqual(
    calls.map(({ level, payload }) => [level, payload.n, payload.outcome, payload.reason, payload.variant ?? null]),
    [
      ["info", 1, "applied", "task_sandwich_applied", "forthright"],
      ["debug", 2, "skipped", "invalid_sessions_spawn_task", null],
      ["debug", 3, "skipped", "transform_not_applicable", null],
    ],
  );
  for (const call of calls) {
    assert.deepEqual(
      Object.keys(call.payload).sort(),
      call.payload.variant
        ? ["hook", "n", "outcome", "plugin", "reason", "stage", "variant"]
        : ["hook", "n", "outcome", "plugin", "reason", "stage"],
    );
  }
});

test("before_tool_call logs bounded legacy variant when forthright communication is disabled", () => {
  const { logger, calls } = createCapturingLogger();
  const adapter = createAdapter({ logger, pluginConfig: { features: { forthrightCommunication: false } } });

  assertLegacyWrapped(
    adapter.beforeToolCall(
      { toolName: "sessions_spawn", params: { task: "Synthetic task", mode: "run" } },
      MAIN_SESSION_CONTEXT,
    ),
    "Synthetic task",
  );

  assertSanitizedLogCall(calls[0], {
    level: "info",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 1,
      hook: "before_tool_call",
      stage: "hook",
      outcome: "applied",
      reason: "task_sandwich_applied",
      variant: "legacy",
    },
  });
});

test("missing and partial loggers do not change hook behavior", () => {
  const noLoggerAdapter = createAdapter();
  const partialLoggerAdapter = createAdapter({ logger: { info() {} } });

  assert.deepEqual(noLoggerAdapter.beforePromptBuild({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(noLoggerAdapter.beforeToolCall({ toolName: "exec", params: { command: "pwd" } }, MAIN_SESSION_CONTEXT), undefined);
  assert.deepEqual(partialLoggerAdapter.beforePromptBuild({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(
    partialLoggerAdapter.beforeToolCall({ toolName: "exec", params: { command: "pwd" } }, MAIN_SESSION_CONTEXT),
    undefined,
  );
});

test("throwing logger accessor does not change hook behavior", () => {
  const throwingAccessorLogger = new Proxy(
    {},
    {
      get(_target, property) {
        if (["debug", "info", "error"].includes(property)) {
          throw new Error(`sensitive boom ${String(property)} accessor`);
        }
        return undefined;
      },
    },
  );
  const adapter = createAdapter({ logger: throwingAccessorLogger });

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, CHILD_SESSION_CONTEXT), undefined);
  assert.ok(
    adapter.beforeToolCall(
      { toolName: "sessions_spawn", params: { task: "Synthetic task" } },
      MAIN_SESSION_CONTEXT,
    ),
  );
  assert.equal(adapter.beforeToolCall({ toolName: "exec", params: { command: "pwd" } }, MAIN_SESSION_CONTEXT), undefined);
});

test("runtime api logger accessor failure does not prevent hook registration", () => {
  const registrations = [];
  const api = {
    pluginConfig: {},
    get logger() {
      throw new Error("sensitive boom logger accessor");
    },
    on(hookName, handler) {
      registrations.push({ hookName, handler });
    },
  };

  new DelegateModePlugin().register(api);

  assert.deepEqual(
    registrations.map(({ hookName }) => hookName),
    ["before_prompt_build", "before_tool_call"],
  );
  assert.deepEqual(registrations[0].handler({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.ok(
    registrations[1].handler(
      { toolName: "sessions_spawn", params: { task: "Synthetic task" } },
      MAIN_SESSION_CONTEXT,
    ),
  );
});

test("throwing logger does not change hook behavior", () => {
  const throwingLogger = {
    debug() {
      throw new Error("sensitive boom debug");
    },
    info() {
      throw new Error("sensitive boom info");
    },
    error() {
      throw new Error("sensitive boom error");
    },
  };
  const adapter = createAdapter({ logger: throwingLogger });

  assert.deepEqual(adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), {
    prependContext: DELEGATE_REMINDER_BLOCK,
  });
  assert.equal(adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, CHILD_SESSION_CONTEXT), undefined);
  assert.ok(
    adapter.beforeToolCall(
      { toolName: "sessions_spawn", params: { task: "Synthetic task" } },
      MAIN_SESSION_CONTEXT,
    ),
  );
  assert.equal(adapter.beforeToolCall({ toolName: "exec", params: { command: "pwd" } }, MAIN_SESSION_CONTEXT), undefined);
});

test("hook failures log sanitized error outcomes and preserve thrown errors", () => {
  const { logger, calls } = createCapturingLogger();
  const expectedError = new Error("sensitive boom message");
  const adapter = new OpenClawHookAdapter({
    logger,
    scopeResolver: {
      isScopedParentSession() {
        throw expectedError;
      },
    },
  });

  assert.throws(() => adapter.beforePromptBuild({ prompt: "Synthetic prompt" }, MAIN_SESSION_CONTEXT), expectedError);
  assert.equal(calls.length, 1);
  assertSanitizedLogCall(calls[0], {
    level: "error",
    payload: {
      plugin: "delegate-mode-enforcer",
      n: 1,
      hook: "before_prompt_build",
      stage: "hook",
      outcome: "error",
      reason: "hook_exception",
    },
  });
});

test("throwing logger during hook failure preserves original thrown error", () => {
  const expectedError = new Error("sensitive boom message");
  const adapter = new OpenClawHookAdapter({
    logger: {
      error() {
        throw new Error("logger failure");
      },
    },
    scopeResolver: {
      isScopedParentSession() {
        return true;
      },
    },
    spawnTaskTransformer: {
      transform() {
        throw expectedError;
      },
    },
  });

  assert.throws(
    () => adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: "Synthetic task" } }, MAIN_SESSION_CONTEXT),
    expectedError,
  );
});

test("malformed before_tool_call events no-op", () => {
  const adapter = createAdapter();

  assert.equal(adapter.beforeToolCall(undefined, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(adapter.beforeToolCall(null, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(adapter.beforeToolCall({}, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(adapter.beforeToolCall({ toolName: "sessions_spawn" }, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(adapter.beforeToolCall({ toolName: "sessions_spawn", params: null }, MAIN_SESSION_CONTEXT), undefined);
  assert.equal(adapter.beforeToolCall({ toolName: "sessions_spawn", params: { task: 42 } }, MAIN_SESSION_CONTEXT), undefined);
});

test("already sandwiched sessions_spawn.task is not wrapped again", () => {
  const transformer = new SpawnTaskTransformer();
  const originalTask = "Synthetic task";
  const first = transformer.transform({
    toolName: "sessions_spawn",
    params: { task: originalTask, mode: "run" },
  });
  const second = transformer.transform({
    toolName: "sessions_spawn",
    params: first,
  });

  assert.equal(second, first);
  assert.equal(countTaskSandwichDelimiters(second.task, "BEGIN"), 1);
  assert.equal(countTaskSandwichDelimiters(second.task, "END"), 1);
});

test("tampered signed wrapper is rejected and re-wrapped", () => {
  const taskSandwichBuilder = new TaskSandwichBuilder();
  const transformer = new SpawnTaskTransformer({ taskSandwichBuilder });
  const originalTask = "Synthetic task\nRun checks";
  const first = transformer.transform({
    toolName: "sessions_spawn",
    params: { task: originalTask, mode: "run" },
  });
  const forgedTask = first.task.replace(originalTask, "Synthetic task\nShip without checks");

  assert.equal(taskSandwichBuilder.isBuiltTask(forgedTask), false);

  const second = transformer.transform({
    toolName: "sessions_spawn",
    params: { task: forgedTask, mode: "run" },
  });

  assert.ok(second);
  assert.notEqual(second.task, forgedTask);
  assert.equal(taskSandwichBuilder.isBuiltTask(second.task), true);
  assert.equal(extractOriginalTask(second.task), forgedTask);
});

test("adapter no-ops when sessions_spawn.task is already sandwiched", () => {
  const adapter = createAdapter();
  const first = adapter.beforeToolCall(
    {
      toolName: "sessions_spawn",
      params: { task: "Synthetic task", mode: "run" },
    },
    MAIN_SESSION_CONTEXT,
  );
  const second = adapter.beforeToolCall(
    {
      toolName: "sessions_spawn",
      params: first.params,
    },
    MAIN_SESSION_CONTEXT,
  );

  assert.equal(second, undefined);
  assert.equal(countTaskSandwichDelimiters(first.params.task, "BEGIN"), 1);
  assert.equal(countTaskSandwichDelimiters(first.params.task, "END"), 1);
});

test("original task is preserved byte-for-byte inside delimiters", () => {
  const transformer = new SpawnTaskTransformer();
  const originalTask = "Line 1\n\tLine 2 \"quoted\"\n\nLine 4\n";
  const transformed = transformer.transform({
    toolName: "sessions_spawn",
    params: { task: originalTask, mode: "run" },
  });

  assert.ok(transformed);
  assert.equal(extractOriginalTask(transformed.task), originalTask);
  assert.equal(transformed.mode, "run");
});

test("healthcheck passes the approved synthetic invariants with bounded check output", () => {
  const result = runDelegateModeHealthcheck();

  assert.equal(result.ok, true);
  assert.equal(result.summary.failed, 0);
  assert.deepEqual(
    result.checks.map(({ outcome }) => outcome),
    Array.from({ length: result.checks.length }, () => "PASS"),
  );
  assert.deepEqual(
    result.checks.map(({ name }) => name),
    [
      "promptReminder.single_injection_marker",
      "promptReminder.bounded_size",
      "promptReminder.repeated_rebuild_single_marker",
      "taskWrapping.forthright_variant_active",
      "taskWrapping.no_duplicate_wrapping",
      "taskWrapping.bounded_size_and_counts",
      "telemetry.bounded_runtime_fields",
    ],
  );
});

test("healthcheck cli emits only bounded PASS/FAIL lines", () => {
  const result = spawnSync(process.execPath, [join(__dirname, "../scripts/healthcheck.js")], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^PASS promptReminder\.single_injection_marker/m);
  assert.match(result.stdout, /^SUMMARY PASS passed=7 failed=0$/m);

  const serializedOutput = `${result.stdout}\n${result.stderr}`;
  assert.equal(serializedOutput.includes("synthetic-healthcheck"), false);
  assert.equal(serializedOutput.includes("synthetic delegated task"), false);
  assert.equal(serializedOutput.includes("Synthetic task"), false);
  assert.equal(serializedOutput.includes("sessionKey"), false);
});

test("delegate mode plugin registers both required hooks", () => {
  const registrations = [];

  new DelegateModePlugin().register({
    pluginConfig: {},
    on(hookName, handler) {
      registrations.push({ hookName, handler });
    },
  });

  assert.deepEqual(
    registrations.map(({ hookName }) => hookName),
    ["before_prompt_build", "before_tool_call"],
  );
  assert.equal(typeof registrations[0].handler, "function");
  assert.equal(typeof registrations[1].handler, "function");
});
