"""
Loads train data and submission CSV once at startup, caches in memory.
Acts as the single source of truth for all services.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from functools import lru_cache

DATA_DIR = Path(__file__).parent.parent / "data"

TRAIN_PATH = DATA_DIR / "train_team_track.parquet"
SUBMISSION_PATH = DATA_DIR / "submission.csv"

FUTURE_COLS = [f"target_step_{i}" for i in range(1, 11)]


@lru_cache(maxsize=1)
def get_train() -> pd.DataFrame:
    df = pd.read_parquet(TRAIN_PATH)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["route_id", "timestamp"]).reset_index(drop=True)
    return df


@lru_cache(maxsize=1)
def get_submission() -> pd.DataFrame:
    """
    submission.csv format: id, y_pred
    We need to join with test to get route_id + step.
    Since we don't have test here, submission is pre-joined with route_id and step
    by the data preparation script.
    Expected columns: route_id, step (1..10), y_pred
    """
    df = pd.read_csv(SUBMISSION_PATH)
    return df


@lru_cache(maxsize=1)
def get_route_office_map() -> dict[int, int]:
    train = get_train()
    mapping = (
        train[["route_id", "office_from_id"]]
        .drop_duplicates("route_id")
        .set_index("route_id")["office_from_id"]
        .to_dict()
    )
    return mapping


@lru_cache(maxsize=1)
def get_time_bounds() -> tuple[pd.Timestamp, pd.Timestamp]:
    train = get_train()
    return train["timestamp"].min(), train["timestamp"].max()


def get_history(route_id: int, up_to: pd.Timestamp, lookback: int = 48) -> pd.DataFrame:
    """Return up to `lookback` rows before `up_to` for a given route."""
    train = get_train()
    route_data = train[
        (train["route_id"] == route_id) &
        (train["timestamp"] <= up_to)
    ].tail(lookback)
    return route_data


def get_all_route_ids() -> list[int]:
    train = get_train()
    return sorted(train["route_id"].unique().tolist())
