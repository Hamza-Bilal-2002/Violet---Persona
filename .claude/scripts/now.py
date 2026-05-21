"""
Clock utility for Claude Code agents.
Returns current PKT (UTC+5) timestamp with millisecond precision.

Usage:
    python .claude/scripts/now.py

Output:
    2026-04-03T19:32:07.841+05:00 | Thu 03 Apr 2026, 7:32:07.841 PM PKT
"""

from datetime import datetime, timezone, timedelta

PKT = timezone(timedelta(hours=5))
now = datetime.now(PKT)

iso = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}" + now.strftime("%z")
iso = iso[:-2] + ":" + iso[-2:]  # +0500 -> +05:00

hour12 = now.hour % 12 or 12
human = now.strftime(f"%a %d %b %Y, {hour12}:%M:%S.") + f"{now.microsecond // 1000:03d}" + now.strftime(" %p PKT")

print(f"{iso} | {human}")
