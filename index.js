import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { DelegateModePlugin } from "./src/delegate-mode-plugin.js";

const delegateModePlugin = new DelegateModePlugin();

const pluginEntry = definePluginEntry({
  id: "headcrab",
  name: "Headcrab",
  description: "A small OpenClaw plugin for worker-first delegation.",
  register(api) {
    delegateModePlugin.register(api);
  },
});

export default pluginEntry;

export { DelegateModePlugin } from "./src/delegate-mode-plugin.js";
export { OpenClawHookAdapter } from "./src/openclaw-hook-adapter.js";
export { ScopeResolver } from "./src/core/scope-resolver.js";
export { DelegateReminderRenderer } from "./src/core/delegate-reminder-renderer.js";
export { SpawnTaskTransformer } from "./src/core/spawn-task-transformer.js";
export { TaskSandwichBuilder } from "./src/core/task-sandwich-builder.js";
export { runDelegateModeHealthcheck } from "./src/healthcheck.js";
export {
  DELEGATE_REMINDER_BLOCK,
  DELEGATE_REMINDER_MARKER,
  TASK_SANDWICH_BEGIN_DELIMITER,
  TASK_SANDWICH_END_DELIMITER,
  WORKER_INSTRUCTIONS_BLOCK,
} from "./src/constants.js";
