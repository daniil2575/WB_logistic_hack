"""
Time simulator: manages the "current time" of the demo.
All services ask the simulator for the current timestamp.
"""

import pandas as pd
from .data_loader import get_time_bounds

# Default start: last day of train data at 06:00 (gives history, approaches test window)
_DEFAULT_START_OFFSET_HOURS = -24

_current_time: pd.Timestamp | None = None
STEP_MINUTES = 30


def _default_start() -> pd.Timestamp:
    _, max_time = get_time_bounds()
    return max_time.floor("30min") - pd.Timedelta(hours=24)


def get_current_time() -> pd.Timestamp:
    global _current_time
    if _current_time is None:
        _current_time = _default_start()
    return _current_time


def set_time(ts: pd.Timestamp) -> pd.Timestamp:
    global _current_time
    min_t, max_t = get_time_bounds()
    if ts < min_t:
        ts = min_t
    if ts > max_t:
        ts = max_t
    _current_time = ts.floor("30min")
    return _current_time


def tick() -> tuple[pd.Timestamp, pd.Timestamp]:
    """Advance time by one step (30 min). Returns (prev, new)."""
    prev = get_current_time()
    _, max_t = get_time_bounds()
    new = prev + pd.Timedelta(minutes=STEP_MINUTES)
    if new > max_t:
        new = max_t
    global _current_time
    _current_time = new
    return prev, new


def reset() -> pd.Timestamp:
    global _current_time
    _current_time = _default_start()
    return _current_time
