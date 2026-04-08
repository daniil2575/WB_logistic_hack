"""
Full Ridge stack inference for the service.

Pipeline (mirrors make_h41b_stack.py):
  GRU h27b ──┐
  GRU h23  ──┤
  TFT h39  ──┼──► build meta-features ──► Ridge Stack ──► y_pred
  LGBM     ──┤
  Naive    ──┘

Checkpoints expected in app/data/:
  h28_h27b_gru_winsorized_target.pt   — GRU h27b
  h33_h23_lite.pt                     — GRU h23
  h41a_h39_tft_lite.pt                — TFT h39
  lgbm_friday.joblib                  — LGBM DIRMO
  ridge_stack.joblib                  — Ridge meta-learner

Falls back to rolling mean if any checkpoint is missing.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import joblib
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

LOOKBACK_GRU = 24   # h27b, h23
LOOKBACK_TFT = 24   # h39
PRED_LEN = 10


# ---------------------------------------------------------------------------
# GRU architecture (matches src/common.py)
# ---------------------------------------------------------------------------

class GRULite(nn.Module):
    def __init__(self, seq_input_dim, n_routes, n_offices,
                 route_emb_dim=12, office_emb_dim=6, hidden_size=64, pred_len=PRED_LEN):
        super().__init__()
        self.route_emb = nn.Embedding(n_routes, route_emb_dim)
        self.office_emb = nn.Embedding(n_offices + 1, office_emb_dim)
        self.gru = nn.GRU(seq_input_dim, hidden_size, num_layers=1, batch_first=True)
        self.head = nn.Sequential(
            nn.Linear(hidden_size + route_emb_dim + office_emb_dim, 64),
            nn.ReLU(),
            nn.Linear(64, pred_len),
        )

    def forward(self, x, route_idx, office_idx):
        out, _ = self.gru(x)
        last_h = out[:, -1, :]
        return self.head(torch.cat([last_h, self.route_emb(route_idx), self.office_emb(office_idx)], dim=1))


# ---------------------------------------------------------------------------
# TFT architecture (matches src/common.py TFTLite)
# ---------------------------------------------------------------------------

class TFTLite(nn.Module):
    def __init__(self, hist_dim, fut_dim, n_routes, n_offices, hidden=64, pred_len=PRED_LEN):
        super().__init__()
        self.route_emb = nn.Embedding(n_routes, 12)
        self.office_emb = nn.Embedding(n_offices + 1, 6)
        self.hist_encoder = nn.GRU(hist_dim, hidden, batch_first=True)
        self.attn = nn.MultiheadAttention(embed_dim=hidden, num_heads=4, batch_first=True)
        self.future_proj = nn.Linear(fut_dim, hidden)
        self.static_proj = nn.Linear(hidden + 12 + 6, hidden)
        self.head = nn.Sequential(
            nn.Linear(hidden * pred_len, 128),
            nn.ReLU(),
            nn.Linear(128, pred_len),
        )

    def forward(self, x_hist, x_fut, route_idx, office_idx):
        hist_out, _ = self.hist_encoder(x_hist)
        fut_q = self.future_proj(x_fut)
        attn_out, _ = self.attn(query=fut_q, key=hist_out, value=hist_out)
        last_h = hist_out[:, -1, :]
        static = torch.cat([last_h, self.route_emb(route_idx), self.office_emb(office_idx)], dim=1)
        static = self.static_proj(static).unsqueeze(1)
        fused = (attn_out + static).reshape(attn_out.size(0), -1)
        return self.head(fused)


# ---------------------------------------------------------------------------
# Checkpoint loading
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_gru(name: str) -> dict | None:
    path = DATA_DIR / f"{name}.pt"
    if not path.exists():
        return None
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    n_routes = len(ckpt["route2idx"])
    n_offices = len(ckpt["office2idx"])
    model = GRULite(seq_input_dim=5, n_routes=n_routes, n_offices=n_offices)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    ckpt["model"] = model
    return ckpt


@lru_cache(maxsize=1)
def _load_tft() -> dict | None:
    path = DATA_DIR / "h41a_h39_tft_lite.pt"
    if not path.exists():
        return None
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    n_routes = len(ckpt["route2idx"])
    n_offices = len(ckpt["office2idx"])
    model = TFTLite(
        hist_dim=ckpt.get("hist_dim", len(ckpt.get("past_features", [])) or 5),
        fut_dim=ckpt.get("fut_dim", len(ckpt.get("future_features", [])) + 1),
        n_routes=n_routes,
        n_offices=n_offices,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    ckpt["model"] = model
    return ckpt


@lru_cache(maxsize=1)
def _load_lgbm() -> dict | None:
    path = DATA_DIR / "lgbm_friday.joblib"
    if not path.exists():
        return None
    return joblib.load(path)


@lru_cache(maxsize=1)
def _load_ridge() -> dict | None:
    path = DATA_DIR / "ridge_stack.joblib"
    if not path.exists():
        return None
    return joblib.load(path)


def stack_available() -> bool:
    return all([
        (DATA_DIR / "h28_h27b_gru_winsorized_target.pt").exists(),
        (DATA_DIR / "h33_h23_lite.pt").exists(),
        (DATA_DIR / "h41a_h39_tft_lite.pt").exists(),
        (DATA_DIR / "lgbm_friday.joblib").exists(),
        (DATA_DIR / "ridge_stack.joblib").exists(),
    ])


# ---------------------------------------------------------------------------
# Feature helpers
# ---------------------------------------------------------------------------

def _time_features(df: pd.DataFrame) -> pd.DataFrame:
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
def _norm_stats_gru(ckpt_name: str) -> tuple[dict, dict]:
    from .data_loader import get_train
    ckpt = _load_gru(ckpt_name)
    train = get_train()
    train = _time_features(train)
    target_cap = ckpt.get("target_cap")
    if target_cap is not None:
        train["target_win"] = np.minimum(np.maximum(train["target_2h"].values, 0.0), float(target_cap)).astype(np.float32)
    else:
        train["target_win"] = np.maximum(train["target_2h"].values, 0.0).astype(np.float32)
    feats = ["target_win", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    means = train[feats].mean().to_dict()
    stds = {k: max(float(v), 1e-6) for k, v in train[feats].std().to_dict().items()}
    return means, stds


# ---------------------------------------------------------------------------
# Individual model predictions
# ---------------------------------------------------------------------------

def _predict_gru(ckpt_name: str, route_id: int, history: pd.DataFrame) -> np.ndarray | None:
    ckpt = _load_gru(ckpt_name)
    if ckpt is None or len(history) < LOOKBACK_GRU:
        return None
    if route_id not in ckpt["route2idx"]:
        return None

    means, stds = _norm_stats_gru(ckpt_name)
    hist = history.tail(LOOKBACK_GRU).copy()
    hist = _time_features(hist)
    target_cap = ckpt.get("target_cap")
    if target_cap is not None:
        hist["target_win"] = np.minimum(
            np.maximum(hist["target_2h"].values, 0.0), float(target_cap)
        ).astype(np.float32)
    else:
        hist["target_win"] = np.maximum(hist["target_2h"].values, 0.0).astype(np.float32)

    feats = ["target_win", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    for f in feats:
        hist[f] = ((hist[f] - means[f]) / stds[f]).astype(np.float32)

    x = torch.tensor(hist[feats].values[np.newaxis], dtype=torch.float32)
    ri = torch.tensor([ckpt["route2idx"][route_id]], dtype=torch.long)
    office_id = int(hist["office_from_id"].iloc[-1]) if "office_from_id" in hist.columns else 0
    oi = torch.tensor([ckpt["office2idx"].get(office_id, 0)], dtype=torch.long)

    with torch.no_grad():
        pred = ckpt["model"](x, ri, oi).cpu().numpy()[0]

    pred_real = np.maximum(0.0, pred * ckpt["target_std"] + ckpt["target_mean"])
    return np.maximum(0.0, pred_real * ckpt["best_k"])


def _predict_tft(route_id: int, history: pd.DataFrame, inference_ts: pd.Timestamp) -> np.ndarray | None:
    ckpt = _load_tft()
    if ckpt is None or len(history) < LOOKBACK_TFT:
        return None
    if route_id not in ckpt["route2idx"]:
        return None

    # Build hist features same as train_h41a_h39_tft.py
    hist = history.tail(LOOKBACK_TFT).copy()
    hist = _time_features(hist)
    target_cap = ckpt.get("target_cap")
    if target_cap is not None:
        hist["target_win"] = np.minimum(
            np.maximum(hist["target_2h"].values, 0.0), float(target_cap)
        ).astype(np.float32)
    else:
        hist["target_win"] = np.maximum(hist["target_2h"].values, 0.0).astype(np.float32)

    hist_feats = ["target_win", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    means = ckpt.get("feature_means", {})
    stds = ckpt.get("feature_stds", {})
    for f in hist_feats:
        if f in means:
            hist[f] = ((hist[f] - means[f]) / max(stds.get(f, 1.0), 1e-6)).astype(np.float32)

    x_hist = torch.tensor(hist[hist_feats].values[np.newaxis], dtype=torch.float32)

    # Future features: hour_sin, hour_cos, dow_sin, dow_cos for each future step
    fut_rows = []
    for step in range(1, PRED_LEN + 1):
        future_ts = inference_ts + pd.Timedelta(minutes=30 * step)
        h = future_ts.hour
        d = future_ts.dayofweek
        fut_rows.append([
            np.sin(2 * np.pi * h / 24.0),
            np.cos(2 * np.pi * h / 24.0),
            np.sin(2 * np.pi * d / 7.0),
            np.cos(2 * np.pi * d / 7.0),
            step / PRED_LEN,  # horizon_idx
        ])
    x_fut = torch.tensor(np.array(fut_rows, dtype=np.float32)[np.newaxis], dtype=torch.float32)

    ri = torch.tensor([ckpt["route2idx"][route_id]], dtype=torch.long)
    office_id = int(hist["office_from_id"].iloc[-1]) if "office_from_id" in hist.columns else 0
    oi = torch.tensor([ckpt["office2idx"].get(office_id, 0)], dtype=torch.long)

    with torch.no_grad():
        pred = ckpt["model"](x_hist, x_fut, ri, oi).cpu().numpy()[0]

    pred_real = np.maximum(0.0, pred * ckpt["target_std"] + ckpt["target_mean"])
    return np.maximum(0.0, pred_real * ckpt["best_k"])


def _predict_lgbm(route_id: int, history: pd.DataFrame) -> np.ndarray | None:
    ckpt = _load_lgbm()
    if ckpt is None or len(history) < 48:
        return None

    route2idx = ckpt["route2idx"]
    office2idx = ckpt["office2idx"]
    if route_id not in route2idx:
        return None

    hist = history.copy()
    hist = _time_features(hist)
    hist["dow"] = hist["dayofweek"]
    hist["is_friday"] = (hist["dow"] == 4).astype(np.int8)
    hist["is_friday_lunch"] = ((hist["dow"] == 4) & (hist["hour"] >= 11) & (hist["hour"] <= 15)).astype(np.int8)

    target = hist["target_2h"].values.astype(np.float32)
    for lag in [1, 2, 3, 6, 12, 24, 48]:
        col = np.full(len(hist), np.nan, dtype=np.float32)
        col[lag:] = target[:-lag] if lag < len(target) else []
        hist[f"lag_{lag}"] = col
    for window in [3, 6, 12, 24, 48]:
        hist[f"roll_mean_{window}"] = (
            pd.Series(target).shift(1).rolling(window, min_periods=1).mean().values.astype(np.float32)
        )
    for weeks in [1, 2, 3, 4]:
        lag_steps = weeks * 336
        col = np.full(len(hist), np.nan, dtype=np.float32)
        if lag_steps < len(target):
            col[lag_steps:] = target[:-lag_steps]
        hist[f"lag_friday_{weeks}w"] = col

    friday_lags = [f"lag_friday_{w}w" for w in [1, 2, 3, 4]]
    hist["roll_mean_friday_4w"] = hist[friday_lags].mean(axis=1).astype(np.float32)
    hist["friday_trend"] = 0.0

    hist["route_id"] = route2idx[route_id]
    office_id = int(hist["office_from_id"].iloc[-1]) if "office_from_id" in hist.columns else 0
    hist["office_from_id"] = office2idx.get(office_id, 0)
    hist = hist.fillna(0)

    feature_cols = ckpt["feature_cols"]
    base_row = hist.iloc[-1]

    preds = np.zeros(PRED_LEN, dtype=np.float32)
    for group_name, steps in ckpt["step_groups"].items():
        if group_name not in ckpt["models"]:
            continue
        for step in steps:
            feat = base_row[feature_cols].values.astype(np.float32)
            feat_with_step = np.append(feat, [float(step)])
            pred = float(ckpt["models"][group_name].predict(feat_with_step.reshape(1, -1))[0])
            preds[step - 1] = max(0.0, pred * ckpt["best_k"])

    return preds


def _predict_naive(history: pd.DataFrame) -> np.ndarray | None:
    """Seasonal naive: same time last week (lag 336 steps = 7 days × 48 steps/day)."""
    LAG_STEPS = 336
    if len(history) < LAG_STEPS + PRED_LEN:
        return None
    target = history["target_2h"].values
    start = len(target) - LAG_STEPS
    preds = target[start: start + PRED_LEN].astype(np.float32)
    if len(preds) < PRED_LEN:
        return None
    return np.maximum(0.0, preds)


# ---------------------------------------------------------------------------
# Full stack inference
# ---------------------------------------------------------------------------

def predict_stack(
    route_id: int, history: pd.DataFrame, inference_ts: pd.Timestamp
) -> tuple[list[float], list[float], list[float]] | None:
    """
    Run full Ridge stack inference.
    Returns (preds, lows, highs) — each a list of 10 floats, or None if any base model fails.
    Confidence interval derived from spread of 5 base models:
      lo = max(0, pred - 1.5 * std(base))
      hi = pred + 1.5 * std(base)
    """
    pred_h27b  = _predict_gru("h28_h27b_gru_winsorized_target", route_id, history)
    pred_h23   = _predict_gru("h33_h23_lite", route_id, history)
    pred_h39   = _predict_tft(route_id, history, inference_ts)
    pred_lgbm  = _predict_lgbm(route_id, history)
    pred_naive = _predict_naive(history)

    if any(p is None for p in [pred_h27b, pred_h23, pred_h39, pred_lgbm, pred_naive]):
        return None

    ridge = _load_ridge()
    if ridge is None:
        return None

    results, lows, highs = [], [], []
    for step in range(PRED_LEN):
        h27b  = float(pred_h27b[step])
        h23   = float(pred_h23[step])
        h39   = float(pred_h39[step])
        lgbm  = float(pred_lgbm[step])
        naive = float(pred_naive[step])

        base       = [h27b, h23, h39, lgbm, naive]
        mean_      = float(np.mean(base))
        std_       = float(np.std(base))
        diff_27_39 = abs(h27b - h39)
        diff_23_39 = abs(h23 - h39)

        feat = np.array([[h27b, h23, h39, lgbm, naive, mean_, std_, diff_27_39, diff_23_39]], dtype=np.float32)
        pred = round(max(0.0, float(ridge["models"]["all"].predict(feat)[0])), 2)

        results.append(pred)
        lows.append(round(max(0.0, pred - 1.5 * std_), 2))
        highs.append(round(pred + 1.5 * std_, 2))

    return results, lows, highs
