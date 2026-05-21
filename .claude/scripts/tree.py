"""
Project folder tree generator.
Prints a structured tree to stdout, excluding noise directories.

Usage:
    python .claude/scripts/tree.py              # full project
    python .claude/scripts/tree.py app          # subtree from app/
    python .claude/scripts/tree.py .claude      # subtree from .claude/
    python .claude/scripts/tree.py --depth 2    # limit depth
"""

import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def _find_project_root():
    for p in Path(__file__).resolve().parents:
        if (p / ".claude").is_dir():
            return p
    raise RuntimeError(f"Project root not found from {__file__}")


ROOT = _find_project_root()

EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", ".vercel", ".old-website-data",
    "dist", "out", ".cache", ".turbo", "__pycache__", "worktrees",
}

MAX_DEPTH = 4


def build_tree(path, prefix="", depth=0, max_depth=MAX_DEPTH):
    if depth > max_depth:
        return ["{}... (depth limit)".format(prefix)]

    lines = []
    try:
        entries = sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return lines

    filtered = []
    for entry in entries:
        if entry.is_dir():
            if entry.name in EXCLUDE_DIRS:
                continue
            if entry.name.startswith(".") and entry.name not in (".claude", ".ai"):
                continue
            filtered.append(entry)
        else:
            filtered.append(entry)

    # If too many files at this level, show dirs + file count
    dirs = [e for e in filtered if e.is_dir()]
    files = [e for e in filtered if e.is_file()]

    if len(files) > 8:
        show = dirs + files[:3]
        truncated = len(files) - 3
    else:
        show = filtered
        truncated = 0

    for i, entry in enumerate(show):
        is_last = i == len(show) - 1 and truncated == 0
        connector = "└── " if is_last else "├── "
        extension = "    " if is_last else "│   "

        if entry.is_dir():
            lines.append(f"{prefix}{connector}{entry.name}/")
            lines.extend(build_tree(entry, prefix + extension, depth + 1, max_depth))
        else:
            lines.append(f"{prefix}{connector}{entry.name}")

    if truncated > 0:
        lines.append(f"{prefix}└── ... (+{truncated} more files)")

    return lines


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]

    max_depth = MAX_DEPTH
    for i, f in enumerate(flags):
        if f == "--depth" and i + 1 < len(flags):
            max_depth = int(flags[i + 1])
    # Also check positional-style --depth N
    for i, a in enumerate(sys.argv[1:]):
        if a == "--depth" and i + 2 <= len(sys.argv[1:]):
            max_depth = int(sys.argv[i + 2])

    if args:
        target = ROOT / args[0]
        if not target.exists():
            print(f"Path not found: {target}")
            sys.exit(1)
        label = args[0]
    else:
        target = ROOT
        label = ROOT.name

    print(f"{label}/")
    for line in build_tree(target, max_depth=max_depth):
        print(line)


if __name__ == "__main__":
    main()
