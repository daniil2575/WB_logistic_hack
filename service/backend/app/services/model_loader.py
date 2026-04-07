"""
Live inference with the GRU h27b model (best checkpoint, seed=42).

Loads the model checkpoint once at startup. For each forecast request:
  1. Pull last LOOKBACK=24 points from train history up to current_time
  2. Compute features: target_win, hour_sin/cos, dow_sin/cos
  3. Normalize using global stats computed from full train
  4. Run GRU forward pass
  5. Denormalize + apply calibration coefficient best_k

Falls back to None if checkpoint not found or route has insufficient history.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from functools import lru_cache
from pathlib import Path

CHECKPOINT_PATH = Path(__file__).parent.parent / "data" / "h28_h27b_gru_winsorized_target.pt"
LOOKBACK = 24
PRED_LEN = 10


# ---------------------------------------------------------------------------
# GRULite — must match the architecture in src/common.py exactly
# ---------------------------------------------------------------------------

class GRULite(nn.Module):
    def __init__(
        self,
        seq_input_dim: int,
        n_routes: int,
        n_offices: int,
        route_emb_dim: int = 12,
        office_emb_dim: int = 6,
        hidden_size: int = 64,
        pred_len: int = PRED_LEN,
    ):
        super().__init__()
        self.route_emb = nn.Embedding(n_routes, route_emb_dim)
        self.office_emb = nn.Embedding(n_offices + 1, office_emb_dim)
        self.gru = nn.GRU(
            input_size=seq_input_dim,
            hidden_size=hidden_size,
            num_layers=1,
            batch_first=True,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size + route_emb_dim + office_emb_dim, 64),
            nn.ReLU(),
            nn.Linear(64, pred_len),
        )

    def forward(self, x: torch.Tensor, route_idx: torch.Tensor, office_idx: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        last_h = out[:, -1, :]
        r_emb = self.route_emb(route_idx)
        o_emb = self.office_emb(office_idx)
        return self.head(torch.cat([last_h, r_emb, o_emb], dim=1))


# ---------------------------------------------------------------------------
# Checkpoint loading
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def load_checkpoint() -> dict | None:
    """Load model checkpoint. Returns None if file not found."""
    if not CHECKPOINT_PATH.exists():
        return None
    ckpt = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    n_routes = len(ckpt["route2idx"])
    n_offices = len(ckpt["office2idx"])
    model = GRULite(seq_input_dim=5, n_routes=n_routes, n_offices=n_offices)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    ckpt["model"] = model
    return ckpt


def model_available() -> bool:
    return load_checkpoint() is not None


# ---------------------------------------------------------------------------
# Feature engineering (must match train_h28_h27b.py exactly)
# ---------------------------------------------------------------------------

def _add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["hour"] = df["timestamp"].dt.hour
    df["dayofweek"] = df["timestamp"].dt.dayofweek
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["dow_sin"] = np.sin(2 * np.pi * df["dayofweek"] / 7.0).astype(np.float32)
    df["dow_cos"] = np.cos(2 * np.pi * df["dayofweek"] / 7.0).astype(np.float32)
    return df


@lru_cache(maxsize=1)
def _get_norm_stats(train_hash: int) -> tuple[dict, dict]:
    """Compute normalization stats from train data (called once)."""
    from .data_loader import get_train
    train = get_train()
    train = _add_time_features(train)
    ckpt = load_checkpoint()
    target_cap = float(ckpt["target_cap"])
    train["target_win"] = np.minimum(
        np.maximum(train["target_2h"].values, 0.0), target_cap
    ).astype(np.float32)
    feats = ["target_win", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    means = train[feats].mean().to_dict()
    stds = {k: max(float(v), 1e-6) for k, v in train[feats].std().to_dict().items()}
    return means, stds


def _norm_stats():
    from .data_loader import get_train
    train = get_train()
    # Use len as a stable hash — doesn't change at runtime
    return _get_norm_stats(len(train))


# ---------------------------------------------------------------------------
# Live inference
# ---------------------------------------------------------------------------

def predict(route_id: int, history: pd.DataFrame) -> list[float] | None:
    """
    Run GRU inference for a single route.

    Parameters
    ----------
    route_id : int
    history  : DataFrame with columns [timestamp, target_2h, office_from_id]
               Must have at least LOOKBACK rows sorted by timestamp.

    Returns
    -------
    list of 10 floats (y_pred for steps 1..10), or None on failure.
    """
    ckpt = load_checkpoint()
    if ckpt is None or len(history) < LOOKBACK:
        return None

    model: GRULite = ckpt["model"]
    route2idx: dict = ckpt["route2idx"]
    office2idx: dict = ckpt["office2idx"]
    target_mean: float = ckpt["target_mean"]
    target_std: float = ckpt["target_std"]
    target_cap: float = ckpt["target_cap"]
    best_k: float = ckpt["best_k"]

    if route_id not in route2idx:
        return None

    hist = history.tail(LOOKBACK).copy()
    hist = _add_time_features(hist)

    means, stds = _norm_stats()
    target_cap_val = float(target_cap)
    hist["target_win"] = np.minimum(
        np.maximum(hist["target_2h"].values, 0.0), target_cap_val
    ).astype(np.float32)

    feats = ["target_win", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    for f in feats:
        hist[f] = ((hist[f] - means[f]) / stds[f]).astype(np.float32)

    x = torch.tensor(hist[feats].values[np.newaxis], dtype=torch.float32)  # [1, 24, 5]

    route_idx = torch.tensor([route2idx[route_id]], dtype=torch.long)
    office_id = int(hist["office_from_id"].iloc[-1]) if "office_from_id" in hist.columns else 0
    office_idx_val = office2idx.get(office_id, 0)
    office_idx = torch.tensor([office_idx_val], dtype=torch.long)

    with torch.no_grad():
        pred = model(x, route_idx, office_idx).cpu().numpy()[0]  # [10]

    pred_real = np.maximum(0.0, pred * target_std + target_mean)
    pred_real = np.maximum(0.0, pred_real * best_k)
    return [round(float(v), 2) for v in pred_real]
