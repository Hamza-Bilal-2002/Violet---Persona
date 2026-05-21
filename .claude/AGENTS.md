# VRM Avatar Lab

## Initiative Description

Interactive VRM avatar playground with animations, lip-sync, and expressions. A browser-based runtime that loads a `.vrm` persona, drives it with FBX animations, and exposes managers for dialogue, expressions, and lip-sync.

## Tools & Dependencies

- **Runtime**: Three.js (`three` ^0.179), `@pixiv/three-vrm` ^3.4, `three-stdlib` (FBX/OrbitControls loaders)
- **Language**: Vanilla JavaScript (ES modules), no framework
- **Tooling**: Vite ^7 (dev server + bundler), `lil-gui` for debug UI
- **Assets**: VRM model (`frontend/models/persona.vrm`), FBX animations (`frontend/animations/*.fbx`)
- **Platform**: Browser (WebGL2), Windows dev environment

## Commands

Run from `frontend/`:

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Start Vite dev server (hot reload) |
| `npm run build` | Production bundle via `vite build` |

Project-framework utilities (run from repo root):

| Command | Purpose |
|---------|---------|
| `python .claude/scripts/now.py` | Current timestamp (use for all log entries) |
| `/tree [path]` | Print project folder structure |
| `python .claude/skills/onboard/scripts/scan-placeholders.py` | Verify framework configuration |

## Hierarchy

Work flows through a structured hierarchy:
Initiative → Project → Milestone → Issue → Commit.

| Level | Filesystem | GitHub |
|-------|-----------|--------|
| Initiative | The repo | — |
| Project | `.lgtm/shared/plans/p{N}-{slug}/PLAN.md` | GitHub milestone |
| Milestone | Section in PLAN.md or sub-plan | Encoded in issue ID prefix |
| Issue | `.lgtm/shared/plans/{project}/issues/P{N}M{M}-{NNN}.md` | PR (issue ID in title) |

The issue-to-PR contract: PR title starts with the issue ID
(e.g., `P2M1-001: short description`). Branch names are descriptive.
Each project gets a `{project}-base` branch; issue branches target it.

## Project Structure

```
.lgtm/                                 — workspace (plans, artifacts, status)
  STATUS.md                            — current initiative status
  shared/
    plans/
      p{N}-{slug}/
        PLAN.md                        — project plan (milestones, DAG, context)
        m{N}-{name}.md                 — milestone sub-plan (if scope warrants)
        issues/
          P{N}M{M}-{NNN}.md           — issue spec (agent or human)
  ai/
    process-artifacts/                 — all agent output, mirroring hierarchy
```

## Workflow

### Plan → Issue → PR lifecycle

1. **Plan** — define milestones and their dependency DAG
2. **Issues** — break the plan into atomic units of work with acceptance criteria
3. **Execute** — each issue = one branch + one PR targeting the project base branch
4. **Review** — quality check against acceptance criteria before PR
5. **Merge** — user reviews and merges each PR
6. **Status** — update `.lgtm/STATUS.md` after each merge, dispatch newly-ready issues

### Branch structure

```
master (production)
  └── develop (integration/testing)
        └── {project}-base (project isolation)
              ├── {project}-feature-a
              ├── {project}-feature-b
              └── {project}-feature-c
```

### Issue ID format

`P{project}M{milestone}-{sequence}` (e.g., `P2M1-003`)

## Conventions

- PRs only — never commit directly to master or develop
- One branch per issue, one PR per issue
- PR title is the issue-to-PR contract: `P{N}M{M}-{NNN}: short description`
- No AI attribution in commits (no Co-Authored-By trailers)
- Never stage all files at once — stage specific files only
- Commit messages explain WHY (the diff shows what)
- Dates use human-friendly format: "Apr 5, 2026" in tables
- Use YYYY-MM-DD for folder names

## Projects

Plans: `.lgtm/shared/plans/{project}/PLAN.md`
Status: `.lgtm/STATUS.md` (read on demand, not auto-loaded)
