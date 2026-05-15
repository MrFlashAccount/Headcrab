const WORKER_SESSION_KEY_PATTERN = /^agent:[^:]+:(subagent|acp|background-worker)(?::|$)/;
// Scope is intentionally derived from the parent direct-message session key shape only;
// child/worker keys must not inherit parent activation by accident.
const DIRECT_SESSION_KEY_PATTERN = /^agent:(main|root):([^:]+):direct:([^:]+)$/;

export const DIRECT_MESSAGE_ALL_SCOPE_SELECTOR = "dm:*";
const DIRECT_MESSAGE_SELECTOR_PREFIX = "dm:";

function isString(value) {
  return typeof value === "string" && value.length > 0;
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDirectSessionKey(sessionKey) {
  const match = sessionKey.match(DIRECT_SESSION_KEY_PATTERN);
  if (!match) {
    return null;
  }

  const [, agentId, channel, directId] = match;
  return { agentId, channel, directId };
}

function parseDirectMessageSelector(selector) {
  if (!isString(selector) || !selector.startsWith(DIRECT_MESSAGE_SELECTOR_PREFIX)) {
    return null;
  }

  const directId = selector.slice(DIRECT_MESSAGE_SELECTOR_PREFIX.length);

  if (directId === "*") {
    return { type: "all" };
  }

  if (directId.length === 0 || directId === "any" || directId.includes(":")) {
    return null;
  }

  return { type: "id", directId };
}

export function isValidScopeSelector(selector) {
  return Boolean(parseDirectMessageSelector(selector));
}

function normalizeScope(scope = [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR]) {
  if (!Array.isArray(scope) || scope.length === 0) {
    return [];
  }

  const parsedScope = scope.map(parseDirectMessageSelector);

  if (parsedScope.some((selector) => !selector)) {
    return [];
  }

  return parsedScope;
}

export class ScopeResolver {
  constructor({ scope = [DIRECT_MESSAGE_ALL_SCOPE_SELECTOR] } = {}) {
    this.scope = normalizeScope(scope);
  }

  isWorkerSession(ctx = {}) {
    return isObjectRecord(ctx) && isString(ctx.sessionKey) && WORKER_SESSION_KEY_PATTERN.test(ctx.sessionKey);
  }

  isDirectMessageSession(ctx = {}) {
    if (!isObjectRecord(ctx) || this.isWorkerSession(ctx) || !isString(ctx.sessionKey)) {
      return false;
    }

    return Boolean(parseDirectSessionKey(ctx.sessionKey));
  }

  isScopedParentSession(ctx = {}) {
    if (!this.isDirectMessageSession(ctx)) {
      return false;
    }

    const { directId } = parseDirectSessionKey(ctx.sessionKey);

    return this.scope.some((selector) => selector.type === "all" || selector.directId === directId);
  }

  isMainSession(ctx = {}) {
    return this.isScopedParentSession(ctx);
  }
}
