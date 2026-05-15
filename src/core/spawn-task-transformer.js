import { TaskSandwichBuilder } from "./task-sandwich-builder.js";

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    };
  }
}
