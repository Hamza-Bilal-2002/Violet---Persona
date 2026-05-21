"""
source-guard.py — PreToolUse hook.
Blocks edits to .claude/ files, redirects to root source equivalent.
"""

import json
import os
import sys


ALLOWLIST = [
    "settings.local.json",
    ".onboarded",
]


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

    if normalized.startswith(".claude/"):
        relative_to_claude = normalized[len(".claude/"):]
    elif "/.claude/" in normalized:
        claude_idx = normalized.find("/.claude/")
        relative_to_claude = normalized[claude_idx + len("/.claude/"):]
    else:
        return

    if relative_to_claude in ALLOWLIST:
        return

    source_equivalent = relative_to_claude

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Edit the source at {source_equivalent} instead. "
                "It syncs to .claude/ automatically."
            ),
        }
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
