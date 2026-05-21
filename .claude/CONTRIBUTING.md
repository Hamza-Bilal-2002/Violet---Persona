# Contributing to LGTM

LGTM is an orchestration framework for AI agents. Contributions are welcome, whether that's fixing a bug in a script, improving an agent definition, adding a skill, or refining the workflow.

## Before you start

Read these files to understand how the framework is structured:

- `README.md` — what LGTM is and how it works
- `skills/workflow/SKILL.md` — the core lifecycle
- `rules/agent-protocol.md` — how agents operate
- `rules/git-workflow.md` — git constraints

## What to contribute

**Good first contributions:**
- Fix a bug in a script (`scripts/`)
- Improve an existing skill's references or examples
- Add a missing edge case to an agent definition
- Improve documentation or fix typos

**Larger contributions:**
- New agent definitions
- New skills
- Improvements to the workflow lifecycle
- New utility scripts

## How to contribute

1. Fork the repo
2. Create a branch with a descriptive name
3. Make your changes
4. Open a PR against `main`

### Commit messages

Write commit messages that explain **why**, not what. The diff shows what changed.

```
Add anti-hallucination check to translator validation

The existing structure validation catches missing keys but not
fabricated content. This adds a count-based check for headings,
list items, and table rows between source and translation.
```

No conventional commit prefixes unless you want to. No emoji. No `Co-Authored-By` trailers.

### PR expectations

- One logical change per PR
- If your change touches an agent or skill, explain how you tested it
- If you're adding a new skill, include references and templates where applicable
- If you're adding a new agent, follow the frontmatter format in existing agent files

## Adding a new skill

Skills live in `skills/{skill-name}/` (root source) and follow this structure:

```
skills/{skill-name}/
  ├── SKILL.md           # Required. The skill definition with frontmatter.
  ├── references/        # Optional. Supporting docs the skill references.
  └── templates/         # Optional. File templates the skill uses.
```

Edits to root source files are automatically synced to `.claude/` at runtime by `scripts/auto-sync.py`.

The `SKILL.md` file needs YAML frontmatter:

```yaml
---
name: your-skill-name
description: >
  When to use this skill and what it does.
---
```

## Adding a new agent

Agents live in `agents/{agent-name}.md` (root source) with YAML frontmatter:

```yaml
---
name: agent-name
description: "What this agent does."
tools: Read, Write, Edit, Bash, Grep, Glob
model: opus
skills:
  - skill-name
---
```

Include:
- A clear role statement
- Inputs section (what the orchestrator gives it)
- Process section (step-by-step, with tool boundaries where applicable)
- A "what you do NOT do" section

## Code style

- Python scripts use standard library only (no pip dependencies in the framework itself)
- Markdown files use ATX headings (`#`, not underlines)
- Tables use pipes with header separators
- Skill files use the existing structure as a template

## Questions?

Open an issue. Keep it specific.
