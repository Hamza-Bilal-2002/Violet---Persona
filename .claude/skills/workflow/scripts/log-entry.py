"""
Append a structured entry to today's daily log.

Creates the log folder and file if they don't exist.

Usage:
    python .claude/skills/workflow/scripts/log-entry.py \
      --event "PR merged" \
      --summary "P2M1-001: Add OAuth callback handler" \
      --what-changed "Merged PR #12 to auth-base" \
      [--health-change "On Track → At Risk"] \
      [--status-update "P2 M1 progress: 2/4 issues done"] \
      [--context "Additional context"]

Output:
    Appends entry to .lgtm/ai/logs/YYYY-MM-DD/LOG.md
"""

import argparse
from datetime import datetime
from pathlib import Path


def _find_project_root():
    for p in Path(__file__).resolve().parents:
        if (p / ".claude").is_dir():
            return p
    raise RuntimeError(f"Project root not found from {__file__}")


PROJECT_ROOT = _find_project_root()


def get_local_time():
    """Get current local time with timezone info."""
    return datetime.now().astimezone()


def main():
    parser = argparse.ArgumentParser(
        description="Append a structured entry to today's daily log."
    )
    parser.add_argument(
        "--event", required=True,
        help="Event type (e.g., 'PR merged', 'Decision', 'Milestone complete')"
    )
    parser.add_argument(
        "--summary", required=True,
        help="One-line summary"
    )
    parser.add_argument(
        "--what-changed", required=True,
        help="What changed"
    )
    parser.add_argument(
        "--health-change", default=None,
        help="Health change (e.g., 'On Track → At Risk')"
    )
    parser.add_argument(
        "--status-update", default=None,
        help="STATUS.md update summary"
    )
    parser.add_argument(
        "--context", default=None,
        help="Additional context"
    )
    args = parser.parse_args()

    now = get_local_time()

    # Folder: .lgtm/ai/logs/YYYY-MM-DD/
    log_dir = PROJECT_ROOT / ".lgtm" / "ai" / "logs" / now.strftime("%Y-%m-%d")
    log_dir.mkdir(parents=True, exist_ok=True)

    log_file = log_dir / "LOG.md"

    # If file doesn't exist, create with header
    if not log_file.exists():
        header = f"# Log — {now.strftime('%A, %B')} {now.day}, {now.year}\n"
        log_file.write_text(header, encoding="utf-8")

    # Format time
    hour12 = now.hour % 12 or 12
    ampm = "AM" if now.hour < 12 else "PM"
    tz_name = now.strftime("%Z") or "LOCAL"
    time_str = f"{hour12}:{now.strftime('%M')} {ampm} {tz_name}"

    # Build entry
    entry = f"\n## {time_str} — {args.event}: {args.summary}\n\n"

    if args.health_change:
        entry += f"- **Health change:** {args.health_change}\n"

    entry += f"- **What changed:** {args.what_changed}\n"

    if args.status_update:
        entry += f"- **STATUS.md update:** {args.status_update}\n"

    if args.context:
        entry += f"- **Context:** {args.context}\n"

    # Append
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(entry)

    print(f"Logged to {log_file}")


if __name__ == "__main__":
    main()
