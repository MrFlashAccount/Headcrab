import { DIRECT_MESSAGE_ALL_SCOPE_SELECTOR, ScopeResolver, isValidScopeSelector } from "./core/scope-resolver.js";
import { OpenClawHookAdapter } from "./openclaw-hook-adapter.js";

const ALLOWED_TOP_LEVEL_CONFIG_KEYS = new Set(["scope", "features"]);
const ALLOWED_FEATURE_KEYS = new Set(["promptReminder", "taskWrapping", "forthrightCommunication"]);

export const DEFAULT_DELEGATE_MODE_CONFIG = Object.freeze({
  scope: Object.freeze([DIRECT_MESSAGE_ALL_SCOPE_SELECTOR]),
  features: Object.freeze({
    promptReminder: true,
    taskWrapping: true,
    forthrightCommunication: true,
  }),
});

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneDefaultConfig() {
  return {
    scope: [...DEFAULT_DELEGATE_MODE_CONFIG.scope],
    features: { ...DEFAULT_DELEGATE_MODE_CONFIG.features },
  };
}

function failClosedConfig() {
  return {
    scope: [],
    features: {
      promptReminder: false,
      taskWrapping: false,
      forthrightCommunication: false,
    },
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeScope(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const scope = [];

  for (const selector of value) {
    if (typeof selector !== "string" || selector.length === 0 || !isValidScopeSelector(selector)) {
      return null;
    }

    scope.push(selector);
  }

  return scope;
}

function normalizeFeatures(value) {
  if (!isObjectRecord(value)) {
    return null;
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_FEATURE_KEYS.has(key)) {
      return null;
    }
  }

  const features = { ...DEFAULT_DELEGATE_MODE_CONFIG.features };

  for (const key of ALLOWED_FEATURE_KEYS) {
    if (hasOwn(value, key)) {
      if (typeof value[key] !== "boolean") {
        return null;
      }

      features[key] = value[key];
    }
  }

  return features;
}

export function normalizeDelegateModeConfig(pluginConfig = undefined) {
  if (pluginConfig === undefined) {
    return { valid: true, config: cloneDefaultConfig() };
  }

  if (!isObjectRecord(pluginConfig)) {
    return { valid: false, config: failClosedConfig() };
  }

  for (const key of Object.keys(pluginConfig)) {
    if (!ALLOWED_TOP_LEVEL_CONFIG_KEYS.has(key)) {
      return { valid: false, config: failClosedConfig() };
    }
  }

  const config = cloneDefaultConfig();

  if (hasOwn(pluginConfig, "scope")) {
    const scope = normalizeScope(pluginConfig.scope);
    if (!scope) {
      return { valid: false, config: failClosedConfig() };
    }

    config.scope = scope;
  }

  if (hasOwn(pluginConfig, "features")) {
    const features = normalizeFeatures(pluginConfig.features);
    if (!features) {
      return { valid: false, config: failClosedConfig() };
    }

    config.features = features;
  }

  return { valid: true, config };
}

function getApiLogger(api) {
  try {
    return api?.logger;
  } catch {
    return undefined;
  }
}

function createHookAdapterFromConfig(pluginConfig = undefined, logger = undefined) {
  const { config } = normalizeDelegateModeConfig(pluginConfig);

  return new OpenClawHookAdapter({
    scopeResolver: new ScopeResolver({ scope: config.scope }),
    features: config.features,
    logger,
  });
}

export class DelegateModePlugin {
  constructor({ hookAdapter = null } = {}) {
    this.hookAdapter = hookAdapter;
  }

  register(api) {
    const logger = getApiLogger(api);
    const hookAdapter = this.hookAdapter ?? createHookAdapterFromConfig(api.pluginConfig, logger);

    api.on("before_prompt_build", (event, ctx) => hookAdapter.beforePromptBuild(event, ctx));
    api.on("before_tool_call", (event, ctx) => hookAdapter.beforeToolCall(event, ctx));
  }
}
