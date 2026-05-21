# Git Safety Rules

Principles and hard constraints for git operations in this project.

## Principles

1. **Every change is a PR** — no local merges, no blackbox consolidation
2. **Fault isolation** — one failed agent never blocks or poisons others
3. **Full visibility** — the user reviews and merges every PR themselves
4. **Clean history** — no AI attribution, no co-author trailers

## Rules

| Rule | Why |
|------|-----|
| Never `git add -A` or `git add .` | Prevents committing secrets, env files, large binaries |
| Never add `Co-Authored-By` or AI attribution | Causes "Unverified" on GitHub, unwanted branding |
| Never merge locally between agent branches | Blackbox — user loses visibility into individual changes |
| Never commit directly to `master`, `develop`, or `{project}-base` | Only PRs. Only the user merges. |
| One branch per issue, one PR per issue | Fault isolation — failed issue = rejected PR, nothing else affected |
| Always `git push` before creating PRs | PR must exist on remote, not just locally |

Branch structure, commit format, PR conventions, and milestone setup
are in the workflow skill: `.claude/skills/workflow/references/git-conventions.md`
