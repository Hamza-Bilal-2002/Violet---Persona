# Agent Protocol

Universal rules that apply to every agent dispatched in this project.

## Inputs

Every agent receives its task as a self-contained prompt from the orchestrator.
The prompt includes everything the agent needs — file paths, context, constraints.
Agents do not read conversation history or assume context from prior sessions.

For execution agents, the prompt references an issue file
(`.lgtm/shared/plans/{project}/issues/P{N}M{M}-{NNN}.md`) as the spec.

## Universal rules

| Rule | Why |
|------|-----|
| Read only what you are given | Cold-start: no dependency on parent conversation |
| All timestamps from `python .claude/scripts/now.py` | LLMs cannot tell time |
| No Co-Authored-By or AI attribution in commits | Clean git history |
| Stage specific files only (never `git add -A`) | Prevents committing secrets or unrelated changes |
| Write outputs to the path the orchestrator provides | Agent does not decide its own output path |
| Report completion back to the orchestrator | The orchestrator handles rollup, status, and next steps |

## Agents that create branches and commits

Additional rules when an agent creates branches, commits, or pushes:

1. Branch naming follows `.claude/skills/workflow/references/hierarchy.md`
2. Commit messages explain WHY (the diff shows what)
3. Push before reporting completion
4. One branch per issue, one PR per issue

## Worktrees

Worktrees provide git isolation for parallel execution.
Each worktree maps 1:1 to an issue being worked:

```
.claude/worktrees/{issue-id}/  →  branch: {project}-{issue-slug}
```

**When to use worktrees:**

| Scenario | Worktree? | Why |
|----------|-----------|-----|
| Multiple agents running in parallel | **Yes** | Each needs its own branch and working directory |
| Single agent running sequentially | Optional | Can just switch branches on the main tree |
| Issue-writer creating issue files | No | Writes to `.lgtm/shared/plans/`, no branching needed |
| QA agent reviewing output | No | Read-only, no source modifications |
| Human issues | No | Human works in their own environment |

**Create:**
```bash
git worktree add .claude/worktrees/{issue-id} -b {project}-{issue-slug} {project}-base
```

**Clean up (after PR merges):**
```bash
git worktree remove .claude/worktrees/{issue-id}
git branch -d {project}-{issue-slug}
```

Worktrees are disposable. The issue file and the PR are the persistent records,
not the worktree. If a worktree is lost (crash, cleanup), the agent can be
re-dispatched from the issue file on a fresh worktree.
