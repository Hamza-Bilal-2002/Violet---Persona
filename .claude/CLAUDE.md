@.claude/AGENTS.md

# Claude Code Configuration

## Utilities

- `python .claude/scripts/now.py` — current timestamp (millisecond precision)
- `/tree [path]` — project folder structure
- Use `python` not `python3` (Windows environment)
- All scripts are Python — `.claude/scripts/*.py`

## Agents

- **Orchestrator** (`.claude/agents/orchestrator.md`) — drives the plan → issue → PR lifecycle
- **Issue writer** (`.claude/agents/issue-writer.md`) — creates issue files from plans

## Skills

- **Workflow** (`.claude/skills/workflow/SKILL.md`) — the full lifecycle playbook
- **Onboard** (`.claude/skills/onboard/SKILL.md`) — first-run configuration

## References

- Hierarchy: `.claude/skills/workflow/references/hierarchy.md`
- Git conventions: `.claude/skills/workflow/references/git-conventions.md`
- Timestamp all log entries using `python .claude/scripts/now.py`
