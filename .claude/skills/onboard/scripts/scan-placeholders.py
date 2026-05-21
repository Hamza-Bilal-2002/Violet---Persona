"""
Scan for unfilled {CONFIGURE:} placeholders in .claude/ and AGENTS.md.

Usage:
    python .claude/skills/onboard/scripts/scan-placeholders.py           # full report
    python .claude/skills/onboard/scripts/scan-placeholders.py --check   # one-line (for hooks)
    python .claude/skills/onboard/scripts/scan-placeholders.py --hook    # SessionStart hook (JSON, always exit 0)
    python .claude/skills/onboard/scripts/scan-placeholders.py --json    # machine-readable

Exit codes (--check, --json, full report):
    0 = no placeholders found (fully configured)
    1 = placeholders found (needs onboarding)

Exit codes (--hook):
    Always 0. Communicates via structured JSON stdout so Claude Code
    shows a clean systemMessage instead of a generic "hook error".

Files in skills/workflow/templates/ are excluded — those are
templates meant to contain placeholders permanently.
"""

import argparse
import json
import sys
from pathlib import Path


def _find_project_root():
    for p in Path(__file__).resolve().parents:
        if (p / ".claude").is_dir():
            return p
    raise RuntimeError(f"Project root not found from {__file__}")


PROJECT_ROOT = _find_project_root()
CLAUDE_DIR = PROJECT_ROOT / ".claude"
KEYWORD = "{CONFIGURE:"
SKIP_MARKER = "[Not applicable]"

# Files in these paths are excluded from scanning
SKIP_PATHS = [
    "skills/workflow/templates/",
    "skills/onboard/",
]

# Core files — must be configured, cannot be skipped
# Paths relative to their scan root (CLAUDE_DIR or PROJECT_ROOT)
CORE_FILES = [
    "AGENTS.md",
]


def should_skip(rel_path: str) -> bool:
    for pattern in SKIP_PATHS:
        if pattern in rel_path:
            return True
    return False


def _scan_file(filepath: Path, rel: str) -> list[dict]:
    """Scan a single file for {CONFIGURE:} placeholders."""
    results = []
    try:
        lines = filepath.read_text(encoding="utf-8").split("\n")
    except (UnicodeDecodeError, PermissionError):
        return results
    for i, line in enumerate(lines, 1):
        if KEYWORD in line and SKIP_MARKER not in line:
            start = line.index(KEYWORD)
            end = line.index("}", start + len(KEYWORD))
            text = line[start:end + 1]
            tier = "core" if rel in CORE_FILES else "optional"
            results.append({
                "file": rel,
                "line": i,
                "tier": tier,
                "text": text,
            })
    return results


def scan() -> list[dict]:
    findings = []
    # Scan AGENTS.md at the project root
    agents_md = PROJECT_ROOT / "AGENTS.md"
    if agents_md.exists():
        findings.extend(_scan_file(agents_md, "AGENTS.md"))
    # Scan .claude/ directory
    for md_file in sorted(CLAUDE_DIR.rglob("*.md")):
        rel = str(md_file.relative_to(CLAUDE_DIR)).replace("\\", "/")
        if should_skip(rel):
            continue
        findings.extend(_scan_file(md_file, rel))
    return findings


def main():
    parser = argparse.ArgumentParser(description="Scan for {CONFIGURE:} placeholders")
    parser.add_argument("--check", action="store_true", help="One-line output (legacy)")
    parser.add_argument("--hook", action="store_true", help="SessionStart hook output (JSON, always exit 0)")
    parser.add_argument("--json", action="store_true", help="Machine-readable JSON")
    args = parser.parse_args()

    findings = scan()
    core = [f for f in findings if f["tier"] == "core"]
    optional = [f for f in findings if f["tier"] == "optional"]

    if args.json:
        print(json.dumps({
            "total": len(findings),
            "core": len(core),
            "optional": len(optional),
            "findings": findings,
        }, indent=2))
        sys.exit(1 if findings else 0)

    if args.hook:
        # SessionStart hook mode — always exit 0, communicate via JSON
        if not findings:
            sys.exit(0)
        if core:
            msg = f"LGTM: {len(core)} core + {len(optional)} optional placeholders unconfigured. Run /onboard to set up."
        else:
            msg = f"LGTM: {len(optional)} optional placeholders remain. Run /onboard to configure."
        print(json.dumps({
            "systemMessage": msg,
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": msg,
            },
        }))
        sys.exit(0)

    if args.check:
        if core:
            print(f"Framework not configured ({len(core)} core + {len(optional)} optional). Run /onboard to set up.")
        elif optional:
            print(f"{len(optional)} optional placeholders remain. Run /onboard to configure.")
        # else: silent
        sys.exit(1 if core else 0)

    # Full report
    if not findings:
        print("All placeholders filled. Framework is fully configured.")
        sys.exit(0)

    # Group by file
    by_file: dict[str, list[dict]] = {}
    for f in findings:
        by_file.setdefault(f["file"], []).append(f)

    print(f"{'=' * 60}")
    print(f"  PLACEHOLDER SCAN: {len(core)} core, {len(optional)} optional")
    print(f"  {len(by_file)} files need configuration")
    print(f"{'=' * 60}")

    for filepath, items in sorted(by_file.items()):
        tier_label = "CORE" if items[0]["tier"] == "core" else "optional"
        print(f"\n  [{tier_label}] {filepath}")
        for item in items:
            print(f"    L{item['line']:>3}  {item['text']}")

    print(f"\n{'=' * 60}")
    print(f"  Run /onboard to fill these in.")
    print(f"{'=' * 60}")
    sys.exit(1)


if __name__ == "__main__":
    main()
