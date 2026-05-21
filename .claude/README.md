# LGTM
*/lgtm/* *(noun)* — can mean anything, depending on the output.

 - **"Looks Good To Me"**: you reviewed the PR, tests are green, and nothing is currently on fire. Ship it.
 - **"Looks Good To Merge"**: the AI somehow didn't hallucinate garbage and you actually read the diff. Absolute miracle.
 - **"Looks Garbage To Me"**: the AI just invented an auth system that authenticates straight to /dev/null again.
 - **"Let's Go To The Moon"**: you unleashed 20 agents in parallel like a madman. This is fine. Everything is fine.
 - **"Lord God This Madness"**: half the agents are in infinite loops, one is having an existential crisis, and another is trying to rm -rf your entire hard drive.
 - **"Losing Grip This Moment"**: you realize the agents have gone full rogue and the singularity is near.

The real name is the first one. The rest are coping mechanisms.

An orchestration framework that turns ideas into reviewable, mergeable pull requests.

You describe what you want built. LGTM breaks it into discrete issues, dispatches AI agents in parallel, and routes every change through a PR you review and merge. Nothing ships without your sign-off.

AI output is never going to be perfect. It doesn't have to be. It has to be reviewable. LGTM takes what agents produce and puts it into branches and diffs you can actually reason about.

Currently built for Claude Code. Designed to work with any coding agent. The architecture uses open formats like `AGENTS.md` and plain markdown specs that any tool can read. Native support for other agents is in the works.

---

> *The Developer's Prayer*
>
> "LGTM, for I have scrolled past the diff and seen nothing wrong, therefore nothing is wrong."

---

## Philosophy

Building with AI should feel like directing a team, not babysitting a process.

**Ideas become PRs.** Every plan breaks down into issues. Every issue maps to one branch and one PR. When an agent finishes, you don't get a wall of text in a chat window. You get a diff you can review, comment on, and merge.

**Git is the documentation.** Commit messages explain *why*, not *what*. The diff shows what changed. The PR ties it to the issue it solves. Write the "why" well and your git history becomes a decision log you can search six months from now.

**Big problems are just small problems in a trench coat.** Complex work is a graph of small, well-defined tasks. LGTM gives you a structured way to decompose anything into pieces small enough to reason about, review, and ship on their own.

**Works beyond code.** The mental model (break work into discrete, reviewable chunks) applies to content pipelines, translation workflows, SEO audits, and marketing campaigns. Any problem where you need to go from "I have an idea" to "it's done and I can prove it." The implementation is code-first. The thinking is not.

**Control the chaos.** AI agents will hallucinate, take wrong turns, and produce imperfect output. LGTM doesn't pretend otherwise. It isolates each agent's work into its own branch. Every output is reviewable before it lands, and one bad generation never poisons the rest of the project.

## The problem

AI coding agents are powerful, but they have no memory of what they're working on, no structure for managing multiple tasks, and no way to coordinate parallel work without stepping on each other. You end up babysitting each session, manually tracking what's done, and hoping nothing gets committed that shouldn't.

LGTM gives your agents a project management layer. Plans become issues. Issues become branches. Branches become PRs. Status stays current. Agents work in isolation. You stay in control.

## How it works

Work flows through a structured hierarchy:

```
Initiative (the repo)
  └── Project        plan file + base branch + GitHub milestone
        └── Milestone    section in the plan
              └── Issue      spec file + branch + PR
```

The lifecycle is straightforward:

1. **Plan** — You describe what needs to happen. The orchestrator creates a plan with milestones and a dependency graph.
2. **Issues** — The issue writer agent reads the plan and produces self-contained spec files. Each one has acceptance criteria, test cases, file paths, and dependencies.
3. **Dispatch** — The orchestrator reads the dependency graph and dispatches all ready issues in parallel, each in its own git worktree.
4. **Execute** — Each agent gets only its issue file. No conversation history, no shared state, no assumptions about what came before.
5. **PR** — Agent pushes its branch, opens a PR targeting the project's base branch. Issue ID goes in the PR title.
6. **You merge** — You review every PR on GitHub. That's the only way code lands.
7. **Repeat** — Merged PRs unlock dependent issues. The orchestrator picks them up and dispatches the next batch.

### The issue-to-PR contract

Every issue file has an ID like `P2M1-003`. The PR title starts with that same ID: `P2M1-003: Add rate limiting middleware`. That's how the framework links a spec on disk to a pull request on GitHub. Branch names are just descriptive slugs for humans.

### Parallel execution with worktrees

Each agent working on code gets its own git worktree — a separate working directory with its own branch, forked from the project's base. Three agents can work on three issues simultaneously without touching each other's files.

```
.claude/worktrees/
  ├── P2M1-001/  →  branch: auth-oauth-setup
  ├── P2M1-002/  →  branch: auth-callback-handler
  └── P2M2-001/  →  branch: auth-rate-limiting
```

Worktrees are disposable. If one gets lost, re-dispatch the agent from the same issue file. The spec is the durable record, not the worktree.

### Cold-start agents

Agents don't read conversation history. They don't know what happened last session. The orchestrator hands each agent a self-contained prompt with everything it needs: the issue spec, file paths, constraints. This makes agents restartable, replaceable, and parallelizable.

## What ships with LGTM

### Agents

Seven agent definitions in `agents/`, each with a defined role, model, toolset, and skills:

| Agent | Does what | Model |
|-------|-----------|-------|
| **Orchestrator** | Runs the full lifecycle. Creates plans, dispatches agents, tracks status, reconciles contributions. | Opus |
| **Issue writer** | Reads plans, walks the codebase, produces spec files grounded in actual code. | Opus |
| **Fullstack engineer** | Implements code changes. Security-first, type-safe, minimal surface area. | Opus |
| **Content editor** | Writes and optimizes marketing copy, SEO, structured data. | Opus |
| **Humanizer** | Removes AI writing patterns through a draft-critique-revise loop with a mechanical grep gate. | Sonnet |
| **QA** | Tests live sites with a headless browser. Produces reports with screenshots, videos, and repro steps. | Sonnet |
| **Translator** | Translates JSON dictionaries and MDX files with structure validation and anti-fabrication checks. | Opus |

### Skills

Sixteen skill files in `skills/`, each a structured playbook that agents (or you) can invoke:

**Framework**
- `workflow` — The core playbook. Plan-to-PR lifecycle, hierarchy model, git conventions, templates.
- `onboard` — Scans for `{CONFIGURE:}` placeholders and walks through project setup interactively. <!-- [Not applicable] - docs reference to syntax, not a real placeholder -->
- `humanizer` — 25 documented AI writing patterns with detection rules and fix strategies.
- `dogfood` — Six-phase exploratory testing. Systematic exploration with full reproduction evidence.
- `test-strategy` — Project-specific QA checklist (template, you fill it in).
- `agent-browser` — Headless browser automation via a fast Rust client.
- `translator` — Translation rules, terminology glossary, anti-fabrication checks, locale-specific guides.

**Content and SEO**
- `copywriting` — Conversion-focused copy with frameworks and formulas.
- `copy-editing` — Seven-sweep refinement: clarity, voice, so-what, prove-it, specificity, emotion, risk.
- `content-strategy` — Topic clusters, buyer stage mapping, editorial planning.
- `page-cro` — Landing page conversion optimization.
- `seo-audit` — Technical SEO audits.
- `ai-seo` — Optimization for AI search engines (ChatGPT, Perplexity, AI Overviews).
- `schema-markup` — JSON-LD structured data generation.

**Utility**
- `tree` — Project structure visualization.
- `compare` — Side-by-side diff viewer.

### Scripts

Python utilities in `scripts/`:

| Script | What it does |
|--------|-------------|
| `sync.py` | Copies root source files to `.claude/` runtime instance, respecting a protect list for configured files. |
| `source-guard.py` | PreToolUse hook that blocks agent edits to `.claude/`, redirecting to the root source equivalent. |
| `auto-sync.py` | PostToolUse hook that auto-syncs root source edits to `.claude/` after every change. |
| `now.py` | Returns the current timestamp with millisecond precision. Agents use this instead of guessing the time. |
| `tree.py` | Prints project structure, excluding noise directories. |
| `validate-json-structure.py` | Compares two JSON files for structural equality (same keys, nesting, types). |
| `validate-mdx-structure.py` | Compares two MDX files for structural equality (same frontmatter, non-text fields byte-identical). |
| `dictionary-diff.py` | Compares translated dictionaries across locales. |
| `log-entry.py` | Appends timestamped entries to the daily log. Lives in `skills/workflow/scripts/`. |

### Rules

Hard constraints in `rules/` that every agent follows:

- **agent-protocol** — Cold-start inputs, timestamp discipline, no AI attribution, stage specific files only, write to assigned paths, report back to orchestrator.
- **git-workflow** — Never `git add -A`. Never commit to protected branches. One branch per issue, one PR per issue. Push before creating PRs. No local merges.
- **artifact-storage** — All agent output goes to `.lgtm/ai/process-artifacts/{project}/{milestone}/{issue}/`. Never deleted. The persistent record of what each agent produced.

## Architecture

LGTM dogfoods itself. The root of the repo is the distributable source. `.claude/` is the configured runtime instance. A sync script bridges them, and two hooks keep the boundary honest.

```
LGTM/
├── agents/              <- source (git-tracked)
├── skills/              <- source (git-tracked)
├── scripts/             <- source (git-tracked)
├── rules/               <- source (git-tracked)
├── CLAUDE.md            <- source (git-tracked)
├── AGENTS.md            <- source, has {CONFIGURE:} placeholders   <!-- [Not applicable] - docs -->
├── settings.json        <- source, includes hook definitions
├── .claude/             <- runtime instance (gitignored, populated by sync.py)
└── .lgtm/               <- workspace (gitignored)
```

Edit source files at root. The `auto-sync.py` hook copies changes to `.claude/` automatically. The `source-guard.py` hook blocks accidental edits to `.claude/` and tells you where the source file is. First-time setup: `python scripts/sync.py`.

## Git model

```
master
  └── develop
        └── {project}-base
              ├── {project}-feature-a    <- one issue
              ├── {project}-feature-b    <- one issue
              └── {project}-feature-c    <- one issue
```

Issue PRs target the project's base branch. When all milestones are done, one project PR rolls the base into `develop`. You test on `develop`, then merge to `master`. Every step is a PR you control.

Commits explain **why**, not what. No conventional-commit prefixes. No `Co-Authored-By` trailers. No AI attribution. Clean history.

## Status tracking

`.lgtm/STATUS.md` is the single status dashboard — initiative health, project progress, active work, and a table for unplanned contributions that arrive outside the plan/issue pipeline.

Daily logs go to `.lgtm/ai/logs/YYYY-MM-DD/LOG.md`, appended by the `log-entry.py` script with real timestamps.

## Getting started

LGTM uses `{CONFIGURE:}` placeholder tokens in template files. These are designed to be filled in per-project. <!-- [Not applicable] - docs reference to syntax, not a real placeholder -->

### 1. Drop LGTM into your project

Copy the root source directories (`agents/`, `skills/`, `scripts/`, `rules/`) and files (`CLAUDE.md`, `AGENTS.md`, `settings.json`) into your project root. Then run `python scripts/sync.py` to populate the `.claude/` runtime instance.

### 2. Run onboard

```
/onboard
```

Or let it detect automatically — the `SessionStart` hook runs a placeholder scan and prompts you if anything is unfilled. The onboard skill walks through four categories:

- **Core** — Project name, initiative goal, build commands
- **Agents** — Brand voice (content editor), tech stack (fullstack engineer)
- **Testing** — QA checklist, build validation commands (can skip)
- **Translation** — i18n framework, locales, file paths (can skip)

Skipped categories get marked `[Not applicable]` so the scan stays clean.

### 3. Create a plan

Tell the orchestrator what you want to build. It creates a plan at `.lgtm/shared/plans/p{N}-{slug}/PLAN.md` with milestones, a dependency DAG, and a file ownership table that prevents two concurrent agents from touching the same file.

### 4. Let it run

The orchestrator dispatches the issue writer to create specs, then dispatches agents to execute them. You review and merge PRs as they come in. Status updates happen automatically.

## Workspace structure

`.lgtm/` holds everything that agents and humans produce while working — plans, artifacts, resources, learnings, and personal workspace.

```
.lgtm/
  ├── STATUS.md              # Initiative health dashboard
  ├── ai/                    # Agent space — agents write here, humans review
  │   ├── process-artifacts/ # All agent output, mirroring the project hierarchy
  │   └── logs/              # Agent execution logs
  ├── user/                  # Human space — your backups, configs, archives
  │   ├── backups/           # Editor settings, config snapshots
  │   └── _archive/          # Retired plans, old agent versions
  └── shared/                # Shared space — both agents and humans read/write
      ├── plans/             # All project plans and issue specs
      ├── learnings/         # Patterns discovered during work
      └── resources/         # Reference repos, datasets, templates
```

**`ai/`** is where agents store everything they produce. The `process-artifacts/` folder mirrors the project hierarchy (`{project}/{milestone}/{issue}/`), so every output is traceable. Artifacts are never deleted.

**`user/`** is yours. Agents don't write here.

**`shared/`** is the handoff zone. Plans, learnings, and resources that both you and agents use.

## Design decisions

**Why filesystem specs instead of GitHub Issues?**
Agent-executable specs need structured frontmatter, dependency fields, test cases, and file path listings in a machine-readable format. GitHub Issues are conversation threads. Our issue files are cold-start contracts.

**Why one PR per issue?**
Fault isolation. A bad agent output is just a rejected PR. It doesn't block anything except issues that explicitly depend on it. No cascading failures, no rollback nightmares.

**Why no AI attribution in commits?**
`Co-Authored-By` trailers for AI accounts show as "Unverified" on GitHub and add noise to the history. The framework strips them by design.

**Why worktrees instead of just branches?**
Branches share a working directory. If two agents run simultaneously on different branches, they'll overwrite each other's uncommitted changes. Worktrees give each agent its own directory. True isolation.

**Why `now.py` for timestamps?**
LLMs can't tell time. They hallucinate dates confidently. Every timestamp in LGTM comes from a real clock via `python scripts/now.py`.

## Roadmap

LGTM ships with Claude Code agent definitions today, but the core architecture — the hierarchy model, issue specs, `.lgtm/` workspace, git conventions, and orchestration patterns — is agent-agnostic by design. The root source directories are the distributable framework. The `.claude/` directory is the Claude Code runtime. The `.lgtm/` directory and the workflow model work with any agent that can read markdown and run git commands.

Native support for other coding agents is in the works.

## Acknowledgments

LGTM builds on and adapts work from several open source projects:

| Project | What we adapted | Link |
|---------|----------------|------|
| **Blader humanizer** | AI writing pattern detection and removal. The humanizer skill and agent are based on this. | [blader/humanizer](https://github.com/blader/humanizer/) |
| **Wikipedia: Signs of AI writing** | The humanizer's pattern catalog draws from this community-maintained guide by WikiProject AI Cleanup. | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| **Marketing skills** | Copywriting, copy-editing, content strategy, page CRO, SEO audit, AI SEO, and schema markup skills adapted from Corey Haines' collection. | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) |
| **agent-browser** | Headless browser automation used by the QA and dogfood agents. | [anthropics/agent-browser](https://github.com/anthropics/agent-browser) |
| **GEO-SEO-Claude** | Reference implementation for geographic and AI search optimization patterns. | [zubair-trabzada/geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) |
| **claude-translation-skill** | Anti-fabrication checklist, terminology glossary structure, and i18n subagent patterns adapted for the translator skill. | [senshinji/claude-translation-skill](https://github.com/senshinji/claude-translation-skill) |
| **i18n subagent pattern** | The translator agent's architecture follows this subagent pattern for i18n specialist work. | [solberg.is/i18n-subagent](https://www.solberg.is/i18n-subagent) |
| **Agent Skills spec** | Skill file format follows the emerging agent skills standard. | [agentskills.io](https://agentskills.io) |

## Support

LGTM is free for everyone and always will be. Star this repo if it's useful to you.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT License — see [LICENSE](LICENSE) for details.
