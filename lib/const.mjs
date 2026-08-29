// executor_harness shared constants
export const WORKSPACE_DEFAULT = "/home/ubuntu/cc-connect-workspace";
export const SKILL_WORKFLOW = "/home/ubuntu/.agents/skills/executor/workflows/executor.js";
export const SKILL_MD = "/home/ubuntu/.agents/skills/executor/SKILL.md";
export const CC_CONFIG = "/home/ubuntu/.cc-connect/config.toml";
export const SESSION_DIR = "/home/ubuntu/oracle-executor/sessions";
export const MODEL = "deepseek/deepseek-v4-pro";
export const THINKING = "medium";
export const BASELINE = {
  "pi": "0.84.2",
  "pi-subagents": "0.59.0",
  "pi-mcp-adapter": "2.31.0",
  "cc-connect": "1.5.0",
  "codex": "0.149.1",
};

import fs from "node:fs";
export function socketPath() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const run = `/run/user/${uid}`;
  try {
    if (fs.existsSync(run)) return `${run}/executor-harness.sock`;
  } catch {}
  return "/tmp/oracle-executor/executor-harness.sock";
}
