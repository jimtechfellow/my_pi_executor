#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_dir="$repo_root/executor"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${HOME}/.local/state/executor_migration_backup/${ts}"
mkdir -p "$backup_root" "${HOME}/.agents/skills" "${HOME}/.hermes/skills/autonomous-ai-agents"

backup_path() {
  local p="$1"
  [ -e "$p" ] || [ -L "$p" ] || return 0
  local name
  name="$(printf '%s' "$p" | sed 's#^/##; s#/#__#g')"
  mv "$p" "$backup_root/$name"
}

# One physical Skill tree, two discovery paths.
backup_path "${HOME}/.agents/skills/executor"
backup_path "${HOME}/.hermes/skills/autonomous-ai-agents/executor"
ln -s "$skill_dir" "${HOME}/.agents/skills/executor"
ln -s "$skill_dir" "${HOME}/.hermes/skills/autonomous-ai-agents/executor"

# Remove obsolete Hermes Executor-specific routing/runtime layers from the live path.
backup_path "${HOME}/.hermes/skills/autonomous-ai-agents/persistent-executor-routing"
backup_path "${HOME}/.hermes/profiles/operator/plugins/pi-executor-bridge"

# Retire the old global Host/service if present.
if systemctl --user list-unit-files executor-harness.service >/dev/null 2>&1; then
  systemctl --user disable --now executor-harness.service || true
fi
rm -f "/run/user/$(id -u)/executor-harness.sock"

printf 'STATUS: PASS\n'
printf 'SKILL: %s\n' "$skill_dir"
printf 'AGENTS_LINK: %s\n' "${HOME}/.agents/skills/executor"
printf 'HERMES_LINK: %s\n' "${HOME}/.hermes/skills/autonomous-ai-agents/executor"
printf 'BACKUP: %s\n' "$backup_root"
