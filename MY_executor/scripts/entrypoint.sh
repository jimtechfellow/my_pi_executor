#!/bin/sh
set -eu

skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime="$skill_dir/scripts/runtime.mjs"
node_bin=${EXECUTOR_NODE_BIN:-/home/ubuntu/.local/bin/node}
[ -x "$node_bin" ] || node_bin=$(command -v node)

# If model credentials are already inherited, run directly.
if [ -n "${DEEPSEEK_API_KEY:-}" ] || [ -n "${ZAI_API_KEY:-}" ] || [ -n "${OPENROUTER_API_KEY:-}" ]; then
  exec "$node_bin" "$runtime" "$@"
fi

# Oracle's existing secret broker may inject credentials per invocation. This
# wrapper owns no Executor state and creates no daemon/session registry.
project_file=${EXECUTOR_BWS_PROJECT_FILE:-/home/ubuntu/.config/bws/project-id}
if command -v bws-safe >/dev/null 2>&1 && [ -r "$project_file" ]; then
  project_id=$(tr -d '\r\n' < "$project_file")
  [ -n "$project_id" ] || { echo "executor: empty BWS project id" >&2; exit 1; }
  exec bws-safe run --project-id "$project_id" -- \
    /usr/bin/env -u BWS_ACCESS_TOKEN -u CREDENTIALS_DIRECTORY \
    "$node_bin" "$runtime" "$@"
fi

exec "$node_bin" "$runtime" "$@"
