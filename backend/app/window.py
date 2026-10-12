"""Time window ↔ bar indexes.

A window "09:30–10:30" covers the bars that START at 09:30, 09:35 … 10:25, i.e. bars a=3 … b=14.
`to` is the window's end time (exclusive bar boundary), so the full day is 09:15–15:30 → 0…74.
"""
from __future__ import annotations

from dataclasses import dataclass

from .config import BAR_MINUTES, BARS_PER_SESSION, SESSION_END_MIN, SESSION_START_MIN


class WindowError(ValueError):
    pass


def parse_hhmm(text: str) -> int:
    try:
        hh, mm = text.strip().split(":")
        h, m = int(hh), int(mm)
    except (ValueError, AttributeError):
        raise WindowError(f"Bad time {text!r}; expected HH:MM") from None
    if not (0 <= h < 24 and 0 <= m < 60):
        raise WindowError(f"Bad time {text!r}")
    return h * 60 + m


def fmt_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def bar_start(bar: int) -> str:
    return fmt_hhmm(SESSION_START_MIN + bar * BAR_MINUTES)


BAR_LABELS = [bar_start(i) for i in range(BARS_PER_SESSION)]


@dataclass(frozen=True)
class Window:
    a: int  # first bar, inclusive
    b: int  # last bar, inclusive

    @property
    def start(self) -> str:
        return bar_start(self.a)

    @property
    def end(self) -> str:
        return fmt_hhmm(SESSION_START_MIN + (self.b + 1) * BAR_MINUTES)

    @property
    def bars(self) -> int:
        return self.b - self.a + 1

    def as_dict(self) -> dict:
        return {"from": self.start, "to": self.end, "a": self.a, "b": self.b, "bars": self.bars}


FULL_DAY = Window(0, BARS_PER_SESSION - 1)


def parse_window(start: str | None, end: str | None) -> Window:
    s = SESSION_START_MIN if not start else parse_hhmm(start)
    e = SESSION_END_MIN if not end else parse_hhmm(end)
    if s < SESSION_START_MIN or e > SESSION_END_MIN:
        raise WindowError(f"Window must be inside {fmt_hhmm(SESSION_START_MIN)}–{fmt_hhmm(SESSION_END_MIN)}")
    if (s - SESSION_START_MIN) % BAR_MINUTES or (e - SESSION_START_MIN) % BAR_MINUTES:
        raise WindowError(f"Times must fall on {BAR_MINUTES}-minute bar boundaries")
    if e <= s:
        raise WindowError("'to' must be after 'from'")
    return Window((s - SESSION_START_MIN) // BAR_MINUTES, (e - SESSION_START_MIN) // BAR_MINUTES - 1)
