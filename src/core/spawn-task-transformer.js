import {
  DEFAULT_SUBAGENT_RUN_TIMEOUT_SECONDS,
  MAX_SUBAGENT_RUN_TIMEOUT_SECONDS,
} from "../constants.js";
import { TaskSandwichBuilder } from "./task-sandwich-builder.js";

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRunTimeoutSeconds(runTimeoutSeconds) {
  if (typeof runTimeoutSeconds !== "number" || !Number.isFinite(runTimeoutSeconds) || runTimeoutSeconds <= 0) {
    return DEFAULT_SUBAGENT_RUN_TIMEOUT_SECONDS;
  }

  return Math.min(runTimeoutSeconds, MAX_SUBAGENT_RUN_TIMEOUT_SECONDS);
}

export class SpawnTaskTransformer {
  constructor({ taskSandwichBuilder = new TaskSandwichBuilder() } = {}) {
    this.taskSandwichBuilder = taskSandwichBuilder;
  }

  transform(event = {}, { forthrightCommunication = true } = {}) {
    if (!isObjectRecord(event)) {
      return undefined;
    }

    const { toolName, params } = event;

    if (toolName !== "sessions_spawn" || !isObjectRecord(params) || typeof params.task !== "string") {
      return params;
    }

    if (this.taskSandwichBuilder.isBuiltTask(params.task)) {
      return params;
    }

    return {
      ...params,
      task: this.taskSandwichBuilder.build(params.task, { forthrightCommunication }),
      runTimeoutSeconds: normalizeRunTimeoutSeconds(params.runTimeoutSeconds),
    };
  }
}
