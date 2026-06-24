"""
Time-aware events + reminders.

Violet can remember dated things the user mentions ("I have a meeting in a
week", "shopping at 2pm tomorrow", "remind me to go out in 20 minutes") and
bring them up on her own at the right time — a heads-up the day before, a
reminder the day of, and a "how did it go?" afterwards.

Two design points make this robust:

  1. Everything is stored as an ABSOLUTE UTC instant. A live countdown timer
     would die when the laptop shuts down; comparing a stored UTC time to
     "now" on the next boot does not. If a reminder's moment passed while the
     machine was off, it simply fires (late) the next time a client connects.

  2. The current date/time + timezone come from the user's DEVICE (the
     renderer sends them on connect), because the local LLM has no idea what
     "now" is and the api container's clock is UTC. The timezone is persisted
     so the background scheduler can still reason about local days between
     sessions.

Natural-language times ("in a week") are resolved with `dateparser`, relative
to the real now + the device timezone. Storage is SQLite at /data/events.db.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from loguru import logger

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - py<3.9 fallback, not expected
    ZoneInfo = None  # type: ignore


DB_PATH = Path(os.environ.get("PERSONA_EVENTS_DB", "/data/events.db"))

# How long after an event's start to wait before asking "how did it go?".
AFTER_BUFFER = timedelta(hours=2)

# How far ahead the daily briefing / "what's coming up" looks.
UPCOMING_DAYS = 7


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _tz(tz_name: str | None):
    """Resolve an IANA tz name to a tzinfo, falling back to UTC."""
    if tz_name and ZoneInfo is not None:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return timezone.utc


def resolve_when(text: str, tz_name: str | None, now_utc: datetime | None = None):
    """Parse a natural-language time phrase into an absolute UTC datetime.

    Relative to the real now + the device timezone, and biased toward the
    FUTURE ("at 2" means the next 2 o'clock, not this morning). Returns an
    aware UTC datetime, or None if the phrase couldn't be understood."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        import dateparser  # lazy: module still imports before the dep is added
    except Exception:
        logger.warning("events: dateparser not installed — cannot resolve times")
        return None

    tz = _tz(tz_name)
    now_utc = now_utc or _utc_now()
    now_local = now_utc.astimezone(tz)

    parsed = dateparser.parse(
        text,
        settings={
            "RELATIVE_BASE": now_local.replace(tzinfo=None),
            "TIMEZONE": tz_name or "UTC",
            "RETURN_AS_TIMEZONE_AWARE": True,
            "PREFER_DATES_FROM": "future",
        },
    )
    if not parsed:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(timezone.utc)


def _local_date(dt_utc: datetime, tz_name: str | None):
    return dt_utc.astimezone(_tz(tz_name)).date()


def fmt_local(when_utc_iso: str, tz_name: str | None) -> str:
    """Human-friendly local rendering of a stored UTC instant."""
    try:
        dt = datetime.fromisoformat(when_utc_iso)
    except Exception:
        return when_utc_iso
    local = dt.astimezone(_tz(tz_name))
    return local.strftime("%a %d %b, %I:%M %p").replace(" 0", " ")


def humanize_delta(when_utc_iso: str, now_utc: datetime | None = None) -> str:
    """A rough 'in 3 hours' / '2 days ago' string for a stored UTC instant."""
    try:
        dt = datetime.fromisoformat(when_utc_iso)
    except Exception:
        return ""
    now = now_utc or _utc_now()
    secs = (dt - now).total_seconds()
    past = secs < 0
    secs = abs(secs)
    if secs < 90 * 60:
        n, unit = round(secs / 60), "minute"
    elif secs < 36 * 3600:
        n, unit = round(secs / 3600), "hour"
    else:
        n, unit = round(secs / 86400), "day"
    n = max(n, 1)
    plural = "" if n == 1 else "s"
    return f"{n} {unit}{plural} ago" if past else f"in {n} {unit}{plural}"


class EventStore:

    def __init__(self) -> None:
        self._lock = threading.Lock()
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    title       TEXT NOT NULL,
                    kind        TEXT NOT NULL DEFAULT 'event',
                    when_utc    TEXT NOT NULL,
                    created_utc TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    notes       TEXT DEFAULT '',
                    reminded    INTEGER NOT NULL DEFAULT 0,
                    ask_before  INTEGER NOT NULL DEFAULT 0,
                    ask_dayof   INTEGER NOT NULL DEFAULT 0,
                    ask_after   INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                );
                """
            )
            self._db.commit()

    # ── meta (timezone + briefing bookkeeping) ───────────────────────

    def get_meta(self, key: str) -> str | None:
        with self._lock:
            row = self._db.execute(
                "SELECT value FROM meta WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            self._db.commit()

    def get_tz(self) -> str | None:
        return self.get_meta("tz")

    def set_tz(self, tz_name: str) -> None:
        if tz_name:
            self.set_meta("tz", tz_name)

    # ── CRUD ─────────────────────────────────────────────────────────

    def add(self, title: str, when_utc: datetime, kind: str = "event",
            notes: str = "") -> dict:
        title = (title or "").strip() or "something"
        kind = "reminder" if kind == "reminder" else "event"
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO events(title, kind, when_utc, created_utc, notes) "
                "VALUES(?, ?, ?, ?, ?)",
                (
                    title,
                    kind,
                    when_utc.astimezone(timezone.utc).isoformat(),
                    _utc_now().isoformat(),
                    notes or "",
                ),
            )
            self._db.commit()
            row = self._db.execute(
                "SELECT * FROM events WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
        return dict(row)

    def list_pending(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM events WHERE status = 'pending' ORDER BY when_utc"
            ).fetchall()
        return [dict(r) for r in rows]

    def cancel(self, event_id: int) -> bool:
        with self._lock:
            cur = self._db.execute(
                "UPDATE events SET status = 'cancelled' "
                "WHERE id = ? AND status = 'pending'",
                (event_id,),
            )
            self._db.commit()
        return cur.rowcount > 0

    def delete(self, event_id: int) -> bool:
        """Hard-remove a row. Used once a task is spent — after Violet has
        voiced its terminal line (a fired reminder, or the 'how did it go?'
        follow-up). Cancelling keeps a tombstone; deleting clears it for good
        so the schedule list reflects only what's still live."""
        with self._lock:
            cur = self._db.execute(
                "DELETE FROM events WHERE id = ?", (event_id,)
            )
            self._db.commit()
        return cur.rowcount > 0

    def _set_flag(self, event_id: int, field: str, *, done: bool = False) -> None:
        assert field in ("reminded", "ask_before", "ask_dayof", "ask_after")
        with self._lock:
            self._db.execute(
                f"UPDATE events SET {field} = 1"
                + (", status = 'done'" if done else "")
                + " WHERE id = ?",
                (event_id,),
            )
            self._db.commit()

    # ── querying for the scheduler ───────────────────────────────────

    def due(self, tz_name: str | None, now_utc: datetime | None = None) -> list[dict]:
        """Return items that should be voiced right now, each as
        {event, stage}. stage ∈ reminder | before | dayof | after. The
        caller marks the matching flag once it has spoken so it never
        repeats. Missed before/dayof windows simply don't fire; the
        always-eventually 'after' stage guarantees the follow-up."""
        now = now_utc or _utc_now()
        out: list[dict] = []
        for ev in self.list_pending():
            when = datetime.fromisoformat(ev["when_utc"])

            if ev["kind"] == "reminder":
                if not ev["reminded"] and now >= when:
                    out.append({"event": ev, "stage": "reminder"})
                continue

            # events: heads-up the day before, reminder the day of, and a
            # "how did it go?" once it's comfortably past.
            now_d = _local_date(now, tz_name)
            ev_d = _local_date(when, tz_name)

            if not ev["ask_after"] and now >= when + AFTER_BUFFER:
                out.append({"event": ev, "stage": "after"})
            elif not ev["ask_dayof"] and now_d == ev_d and now < when:
                out.append({"event": ev, "stage": "dayof"})
            elif (not ev["ask_before"] and not ev["ask_dayof"]
                  and now < when and now_d == ev_d - timedelta(days=1)):
                out.append({"event": ev, "stage": "before"})
        return out

    def mark_stage(self, event_id: int, stage: str) -> None:
        if stage == "reminder":
            self._set_flag(event_id, "reminded", done=True)
        elif stage == "after":
            self._set_flag(event_id, "ask_after", done=True)
        elif stage == "dayof":
            self._set_flag(event_id, "ask_dayof")
        elif stage == "before":
            self._set_flag(event_id, "ask_before")

    def upcoming(self, tz_name: str | None,
                 now_utc: datetime | None = None) -> list[dict]:
        """Pending events between now and UPCOMING_DAYS out, plus today's —
        for the first-boot-of-day briefing and a 'what's coming up' tool."""
        now = now_utc or _utc_now()
        horizon = now + timedelta(days=UPCOMING_DAYS)
        out = []
        for ev in self.list_pending():
            if ev["kind"] != "event":
                continue
            when = datetime.fromisoformat(ev["when_utc"])
            if now - AFTER_BUFFER <= when <= horizon:
                out.append(ev)
        return out


store = EventStore()
