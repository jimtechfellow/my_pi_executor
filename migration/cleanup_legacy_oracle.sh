#!/usr/bin/env bash
set -euo pipefail

skill_dir="${HOME}/.agents/skills/MY_executor"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${HOME}/.local/state/executor_migration_backup/${ts}"

if [ ! -f "$skill_dir/SKILL.md" ]; then
  echo "STATUS: FAIL"
  echo "REASON: governed MY_executor Skill is not deployed at $skill_dir"
  exit 1
fi

if [ -L "$skill_dir" ]; then
  echo "STATUS: FAIL"
  echo "REASON: MY_executor is a symlink; production must be a governed materialized read-only release"
  exit 1
fi

mkdir -p "$backup_root"

backup_path() {
  local p="$1"
  [ -e "$p" ] || [ -L "$p" ] || return 0
  local name
  name="$(printf '%s' "$p" | sed 's#^/##; s#/#__#g')"
  mv "$p" "$backup_root/$name"
}

backup_path "${HOME}/.hermes/skills/autonomous-ai-agents/persistent-executor-routing"
backup_path "${HOME}/.hermes/profiles/operator/plugins/pi-executor-bridge"
backup_path "${HOME}/.agents/skills/executor"

if systemctl --user list-unit-files executor-harness.service >/dev/null 2>&1; then
  systemctl --user disable --now executor-harness.service || true
fi
rm -f "/run/user/$(id -u)/executor-harness.sock"

printf 'STATUS: PASS\n'
printf 'GOVERNED_SKILL: %s\n' "$skill_dir"
printf 'BACKUP: %s\n' "$backup_root"
