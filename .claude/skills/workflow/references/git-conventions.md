# Git Conventions

Branch structure, commit format, and PR conventions.
Safety rules (what NOT to do) are in `.claude/rules/git-workflow.md` — always read both.

## Branch structure

```
master (production)
  └── develop (integration/testing)
        └── {project}-base (project isolation branch)
              ├── {project}-feature-a
              ├── {project}-feature-b
              └── {project}-feature-c
```

- **`master`** — production. Only the user merges `develop → master`.
- **`develop`** — integration branch. Final project PRs target this branch.
- **`{project}-base`** — created from `master`. All issue work targets this branch.
- **`{project}-{slug}`** — one branch per issue. Descriptive name. Created from base.

## Creating a base branch

```bash
git checkout master && git pull
git checkout -b {project}-base
git push -u origin {project}-base
```

## Commit messages

```
<imperative summary of what changed>

<body: why this change was made — the diff shows what>
```

No trailers, no co-authors, no emoji, no conventional-commit prefixes
unless the repo already uses them.

## Pull requests

### Issue PR (targets base branch)

```bash
gh pr create \
  --base {project}-base \
  --head {project}-{slug} \
  --title "P{N}M{M}-{NNN}: short description" \
  --body "..."

gh pr edit {pr-number} --milestone "{project name}"
```

### Project PR (targets develop)

```bash
gh pr create \
  --base develop \
  --head {project}-base \
  --title "Project: {project name}" \
  --body "..."
```

User tests on develop, then manually merges `develop → master`.

## GitHub milestones

```bash
# Create
gh api repos/{owner}/{repo}/milestones --method POST -f title="{project name}"

# Attach PR
gh pr edit {pr-number} --milestone "{project name}"
```
