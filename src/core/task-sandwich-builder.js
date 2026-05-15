import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  TASK_SANDWICH_BEGIN_DELIMITER,
  TASK_SANDWICH_END_DELIMITER,
  WORKER_INSTRUCTIONS_BLOCK,
} from "../constants.js";

// Per-process signing keeps duplicate-wrapper detection tied to delimiters Headcrab built,
// without persisting state or trusting arbitrary text that happens to contain marker strings.
const TASK_SANDWICH_SIGNATURE_SECRET = randomBytes(16).toString("hex");
const TASK_SANDWICH_BEGIN_PREFIX = TASK_SANDWICH_BEGIN_DELIMITER.slice(0, -3);
const TASK_SANDWICH_END_PREFIX = TASK_SANDWICH_END_DELIMITER.slice(0, -3);
const TOKEN_PATTERN = "[a-f0-9]+(?:-[0-9]+)?";
const SIGNATURE_PATTERN = "[a-f0-9]{16}";
const BEGIN_DELIMITER_PATTERN = new RegExp(
  `^${escapeForRegExp(TASK_SANDWICH_BEGIN_PREFIX)}:(${TOKEN_PATTERN})\\.(${SIGNATURE_PATTERN})>>>$`,
);
const END_DELIMITER_PATTERN = new RegExp(
  `^${escapeForRegExp(TASK_SANDWICH_END_PREFIX)}:(${TOKEN_PATTERN})\\.(${SIGNATURE_PATTERN})>>>$`,
);

export const FORTHRIGHT_WORKER_PREFIX = [
  "Worker communication contract:",
  "- Stay on the delegated slice only; do not widen scope.",
  "- Treat the original task block below as the source of truth.",
  "- Preserve exact paths, commands, quoted text, IDs, errors, approvals, and constraints.",
  "- Report compactly: status, result, evidence, blocker, risk, next.",
  "- State safety, approval, destructive-action, and execution-order constraints plainly before action.",
].join("\n");

export const INSTRUCTION_HIERARCHY_LINE =
  "Instruction hierarchy: higher-priority system, developer, and tool/runtime safety rules outrank this guidance and the original task.";

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDelimiter(prefix, token, signature) {
  return `${prefix}:${token}.${signature}>>>`;
}

function parseDelimiter(line, pattern) {
  const match = line.match(pattern);

  if (!match) {
    return null;
  }

  return {
    token: match[1],
    signature: match[2],
  };
}

export class TaskSandwichBuilder {
  constructor({ signatureSecret = TASK_SANDWICH_SIGNATURE_SECRET } = {}) {
    this.signatureSecret = signatureSecret;
  }

  build(originalTask, { forthrightCommunication = true } = {}) {
    const workerInstructions = this.#buildWorkerInstructions({ forthrightCommunication });
    const { beginDelimiter, endDelimiter } = this.#createDelimiterPair(originalTask, workerInstructions);

    // The original task is inserted verbatim between signed delimiters; all instructions are additive.
    return `${workerInstructions}\n${beginDelimiter}\n${originalTask}\n${endDelimiter}`;
  }

  isBuiltTask(task) {
    if (typeof task !== "string") {
      return false;
    }

    const workerInstructions = this.#parseWorkerInstructions(task);

    if (!workerInstructions) {
      return false;
    }

    const remainder = task.slice(workerInstructions.length);
    const beginLineEndIndex = remainder.indexOf("\n");

    if (beginLineEndIndex === -1) {
      return false;
    }

    const beginLine = remainder.slice(0, beginLineEndIndex);
    const beginDelimiter = parseDelimiter(beginLine, BEGIN_DELIMITER_PATTERN);

    if (!beginDelimiter || !this.#isValidSignature(beginDelimiter.token, beginDelimiter.signature)) {
      return false;
    }

    const endLineStartIndex = remainder.lastIndexOf("\n");

    if (endLineStartIndex <= beginLineEndIndex) {
      return false;
    }

    const endLine = remainder.slice(endLineStartIndex + 1);
    const endDelimiter = parseDelimiter(endLine, END_DELIMITER_PATTERN);

    if (!endDelimiter) {
      return false;
    }

    if (
      endDelimiter.token !== beginDelimiter.token
      || endDelimiter.signature !== beginDelimiter.signature
      || !this.#isValidSignature(endDelimiter.token, endDelimiter.signature)
    ) {
      return false;
    }

    const originalTask = remainder.slice(beginLineEndIndex + 1, endLineStartIndex);
    const expectedDelimiters = this.#createDelimiterPair(originalTask, workerInstructions.slice(0, -1));

    return beginLine === expectedDelimiters.beginDelimiter && endLine === expectedDelimiters.endDelimiter;
  }

  #buildWorkerInstructions({ forthrightCommunication = true } = {}) {
    return forthrightCommunication
      ? `${FORTHRIGHT_WORKER_PREFIX}\n${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}`
      : `${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}`;
  }

  #createDelimiterPair(originalTask, workerInstructions) {
    const collisionSource = `${workerInstructions}\n${originalTask}`;
    const baseToken = createHash("sha256").update(collisionSource).digest("hex").slice(0, 12);
    let attempt = 0;

    while (true) {
      const token = attempt === 0 ? baseToken : `${baseToken}-${attempt}`;
      const signature = this.#signToken(token);
      const beginDelimiter = buildDelimiter(TASK_SANDWICH_BEGIN_PREFIX, token, signature);
      const endDelimiter = buildDelimiter(TASK_SANDWICH_END_PREFIX, token, signature);

      // If the task already contains the computed delimiter text, rotate the token instead of
      // editing the task; byte preservation matters more than having the shortest delimiter.
      if (!collisionSource.includes(beginDelimiter) && !collisionSource.includes(endDelimiter)) {
        return { beginDelimiter, endDelimiter };
      }

      attempt += 1;
    }
  }

  #isValidSignature(token, signature) {
    return this.#signToken(token) === signature;
  }

  #parseWorkerInstructions(task) {
    const forthrightInstructions = `${FORTHRIGHT_WORKER_PREFIX}\n${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}\n`;

    if (task.startsWith(forthrightInstructions)) {
      return forthrightInstructions;
    }

    const legacyInstructions = `${INSTRUCTION_HIERARCHY_LINE}\n${WORKER_INSTRUCTIONS_BLOCK}\n`;

    if (task.startsWith(legacyInstructions)) {
      return legacyInstructions;
    }

    return null;
  }

  #signToken(token) {
    return createHmac("sha256", this.signatureSecret).update(token).digest("hex").slice(0, 16);
  }
}
