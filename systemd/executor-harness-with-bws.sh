#!/bin/sh
# executor-harness BWS wrapper — mirrors /home/ubuntu/.local/bin/cc-connect-with-bws.sh.
# Injects all BWS project secrets (DEEPSEEK_API_KEY, ZAI_API_KEY, etc.) into the
# harness host process env; the `pi --mode rpc` child inherits them.
# No plaintext secrets live in this file.
set -eu

project_id=$(tr -d '\r\n' < /home/ubuntu/.config/bws/project-id)
if [ -z "$project_id" ]; then
    echo "executor-harness-with-bws: project-id is unavailable" >&2
    exit 1
fi

exec /usr/local/bin/bws-safe run --project-id "$project_id" -- \
    /usr/bin/env -u BWS_ACCESS_TOKEN -u CREDENTIALS_DIRECTORY \
    /home/ubuntu/.local/bin/node /home/ubuntu/oracle-executor/harness/host.mjs
