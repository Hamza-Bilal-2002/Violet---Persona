---
name: workflow
description: >
  Use when creating plans, breaking work into issues, dispatching agents,
  creating PRs, updating status, reconciling contributions, or any task
  involving the plan → issue → PR lifecycle.
---

# Workflow

Orchestrate work from conversation to shipped deliverables using a structured
hierarchy: Initiative → Project → Milestone → Issue → PR.

## The hierarchy

| Level | What it is | Where it lives | GitHub mapping |
|-------|-----------|----------------|----------------|
| Initiative | The overarching goal | The repo itself | — |
| Project | Self-contained body of work | `.lgtm/shared/plans/p{N}-{slug}/PLAN.md` | GitHub milestone |
| Milestone | Checkpoint within a project | Section in PLAN.md or sub-plan | Encoded in issue ID prefix |
| Issue | Atomic unit of work | `.lgtm/shared/plans/{project}/issues/P{N}M{M}-{NNN}.md` | One PR (issue ID in title) |
| Commit | Documents WHY | Git history | — |

Full naming conventions and filesystem layout: `references/hierarchy.md`
GitHub mapping rationale: `references/hierarchy.md`

## The workflow

### Step 1: Plan

Create `.lgtm/shared/plans/p{N}-{slug}/PLAN.md`.

- Define milestones and their dependency DAG
- Map file ownership (zero overlap between concurrent issues)
- Create milestone sub-plans if scope warrants: `.lgtm/shared/plans/{project}/m{N}-{name}.md`

### Step 2: Break into issues

Use `templates/issue.md` for the format. Write one file per issue to
`.lgtm/shared/plans/{project}/issues/`.

Each issue has:
- Acceptance criteria and test cases
- Dependencies (`depends_on` field)
- Open questions (must be resolved before status → `ready`)

Use the `issue-writer` agent for bulk creation from a plan.

### Step 3: Create base branch

```bash
git checkout master && git pull
git checkout -b {project}-base
git push -u origin {project}-base
```

One base branch per project. All issue branches target it.

### Step 4: Create GitHub milestone

```bash
gh api repos/{owner}/{repo}/milestones --method POST -f title="{project name}"
```

One milestone per project. Every PR gets attached.

### Step 5: Dispatch issues

Build the DAG from `depends_on` fields in issue files.

- An issue is **ready** when all its dependencies have merged PRs
- All ready issues dispatch in parallel
- Issues with no dependencies start immediately
- A failed issue only blocks issues that explicitly depend on it
- Zero file overlap between any two concurrent issues

For parallel execution, create worktrees:

```bash
git worktree add .claude/worktrees/{issue-id} -b {project}-{issue-slug} {project}-base
```

For sequential execution:

```bash
git checkout {project}-base
git checkout -b {project}-{issue-slug}
```

### Step 6: Execute

Each agent reads only its issue file. Follows `.claude/rules/agent-protocol.md`.

### Step 7: Quality review

After each agent completes, before creating the PR:

1. Does it meet the acceptance criteria from the issue file?
2. Do test cases pass?
3. Does the commit message explain WHY?

| Decision | Action |
|----------|--------|
| PASS | Create PR, attach to milestone |
| FAIL (minor) | Fix directly |
| FAIL (major) | Redeploy agent with correction notes |
| Max 3 attempts | Escalate to user |

### Step 8: Create PR

Issue ID in PR title — this is the contract:

```bash
gh pr create \
  --base {project}-base \
  --head {project}-{issue-slug} \
  --title "P{N}M{M}-{NNN}: short description" \
  --body "..."

gh pr edit {pr-number} --milestone "{project name}"
```

Git conventions: `references/git-conventions.md`

### Step 9: Update status

After each PR merges:

1. Update the issue file status to `done`
2. Edit `.lgtm/STATUS.md` (health, milestone progress, updated date)
3. Append daily log entry:
   ```bash
   python .claude/skills/workflow/scripts/log-entry.py \
     --event "PR merged" \
     --summary "P{N}M{M}-{NNN}: description" \
     --what-changed "Merged PR #{number} to {project}-base"
   ```
4. Check the DAG — dispatch any newly-ready issues

### Step 10: Clean up

After each issue's PR merges:

```bash
git worktree remove .claude/worktrees/{issue-id}
git branch -d {project}-{issue-slug}
```

### Step 11: Final PR

When all milestones complete:

```bash
gh pr create \
  --base develop \
  --head {project}-base \
  --title "Project: {project name}" \
  --body "..."
```

User tests on develop, then manually merges `develop → master`.

## Unplanned contributions

Work that arrives outside the plan/issue pipeline (human PRs, hotfixes,
external contributors). Detect, log, classify, reconcile.

Three paths:
1. **Completes planned work** → mark the relevant issue done/progressed
2. **New scope** → create a new project or add milestone to existing project
3. **Hotfix/bugfix** → log it, no plan change needed

Log in the "Unplanned Contributions" section of `.lgtm/STATUS.md`.
Never force-fit foreign work into the issue convention retroactively.

## Status transitions

| Git event | Issue status | STATUS.md update |
|-----------|-------------|-----------------|
| Branch created | in-progress | — |
| PR opened | in-review | — |
| PR merged | done | Update milestone progress, check DAG |
| PR rejected | blocked | Log blocker |
| All milestone issues done | — | Milestone complete, update health |
| All milestones done | — | Project complete |

## When things go wrong

| Scenario | Action |
|----------|--------|
| Agent produces bad output | Don't merge its PR. Only dependent issues blocked. |
| Something breaks after merging a PR | Revert that single PR on the base branch. |
| Two agents touch the same file | Dependency was missing. Merge one first, rebase the other. |
| Context compacts mid-issue | Issue files preserve everything needed to continue. |
| Open questions during execution | Stop. Update the issue file. Resolve before continuing. |

## Status reporting

At each milestone completion:

```markdown
## Status — {project name}

**Milestone:** {milestone name}
**Timestamp:** {from now.py}
**Progress:** {X/Y} issues merged

| ID | Issue | Status | PR |
|----|-------|--------|----|
| P{N}M{M}-001 | ... | done | #{number} |

**Blockers:** {any, or "none"}
**Next:** {specific next action}
```

## Resources

- **References:** `references/hierarchy.md`, `references/git-conventions.md`
- **Templates:** `templates/issue.md`
- **Scripts:** `scripts/log-entry.py`, `.claude/scripts/now.py` (global)
- **Agents:** `.claude/agents/orchestrator.md`, `.claude/agents/issue-writer.md`
