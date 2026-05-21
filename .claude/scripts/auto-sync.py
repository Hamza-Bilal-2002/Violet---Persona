"""
auto-sync.py — PostToolUse hook.
After root source edits, syncs that file to .claude/.
"""

import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SOURCE_DIRS = ["agents", "skills", "scripts", "rules"]
SOURCE_FILES = ["AGENTS.md", "settings.json"]


def is_source_file(relpath):
    normalized = relpath.replace("\\", "/")

    if normalized in SOURCE_FILES:
        return True

    for d in SOURCE_DIRS:
        if normalized.startswith(d + "/"):
            return True

    return False


def main():
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return

    tool_input = event.get("tool_input") or {}
    file_path = tool_input.get("file_path", "")

    if not file_path:
        return

    normalized = file_path.replace("\\", "/")

    # Get path relative to project root
    try:
        relpath = os.path.relpath(file_path, ROOT).replace("\\", "/")
    except ValueError:
        return

    if not is_source_file(relpath):
        return

    sync_script = os.path.join(ROOT, "scripts", "sync.py")
    try:
        subprocess.run(
            [sys.executable, sync_script, "--file", relpath],
            cwd=ROOT,
            capture_output=True,
            timeout=10,
        )
    except Exception as exc:
        print(f"auto-sync warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
