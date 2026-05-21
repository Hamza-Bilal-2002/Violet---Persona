---
name: tree
description: Show the project folder structure. Optionally scope to a subdirectory. Use when exploring the codebase layout or orienting in the project.
argument-hint: [path] [--depth N]
---

Show the project folder tree, excluding noise (node_modules, .next, .git, worktrees, etc.).

## Steps

1. **Parse arguments.** If a path is provided, use it as the subtree root. If `--depth N` is provided, limit tree depth. Defaults: full project, depth 4.

2. **Run the script:**
```bash
python .claude/scripts/tree.py [path] [--depth N]
```

3. **Show the output** to the user as-is. Do not summarize or truncate.

## Examples

- `/tree` — full project structure
- `/tree app` — just the app/ directory
- `/tree .claude` — the operating system layout
- `/tree lib --depth 2` — lib/ with limited depth
- `/tree content/en` — English content files
