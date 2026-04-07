from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset

TARGET_COL = "target_2h"
ROUTE_COL = "route_id"
TIME_COL = "timestamp"
OFFICE_COL = "office_from_id"
ID_COL = "id"
PRED_LEN = 10


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def metric_parts(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[float, float, float]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = max(float(y_true.sum()), 1e-12)
    wape = float(np.abs(y_pred - y_true).sum() / denom)
    rbias = float(abs(y_pred.sum() / denom - 1.0))
    return wape + rbias, wape, rbias


def choose_global_k(
    y_true: np.ndarray,
    y_pred_denorm: np.ndarray,
    grid: Iterable[float] | None = None,
) -> tuple[float, float, float, float]:
    if grid is None:
        grid = np.arange(0.80, 1.21, 0.01)

    best_k = 1.0
    best_score = float("inf")
    best_wape = float("inf")
    best_bias = float("inf")

    y_true = np.asarray(y_true, dtype=float)
    y_pred_denorm = np.asarray(y_pred_denorm, dtype=float)

    for k in grid:
        pred_k = np.maximum(0.0, y_pred_denorm * float(k))
        score_k, wape_k, bias_k = metric_parts(y_true.reshape(-1), pred_k.reshape(-1))
        if score_k < best_score:
            best_k = float(k)
            best_score = float(score_k)
            best_wape = float(wape_k)
            best_bias = float(bias_k)

    return best_k, best_score, best_wape, best_bias


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df[TIME_COL] = pd.to_datetime(df[TIME_COL])
    df["hour"] = df[TIME_COL].dt.hour.astype(np.int16)
    df["dayofweek"] = df[TIME_COL].dt.dayofweek.astype(np.int16)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24.0).astype(np.float32)
    df["dow_sin"] = np.sin(2 * np.pi * df["dayofweek"] / 7.0).astype(np.float32)
    df["dow_cos"] = np.cos(2 * np.pi * df["dayofweek"] / 7.0).astype(np.float32)
    return df


def load_df(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix == ".csv":
        return pd.read_csv(path)
    raise ValueError(f"Unsupported file format: {path}")


def ensure_columns(df: pd.DataFrame, required: set[str], df_name: str) -> None:
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"{df_name} is missing columns: {missing}")


def build_route_and_office_indices(train_h: pd.DataFrame, test_h: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[int, int], dict[int, int]]:
    route_ids = sorted(train_h[ROUTE_COL].unique())
    route2idx = {int(r): i for i, r in enumerate(route_ids)}

    office_ids = sorted(train_h[OFFICE_COL].dropna().unique())
    office2idx = {int(o): i + 1 for i, o in enumerate(office_ids)}

    unknown_test_routes = sorted(set(map(int, test_h[ROUTE_COL].unique())) - set(route2idx))
    if unknown_test_routes:
        raise ValueError(
            f"Found {len(unknown_test_routes)} test routes that do not exist in the reduced train window. "
            f"First few: {unknown_test_routes[:5]}"
        )

    train_h = train_h.copy()
    test_h = test_h.copy()
    train_h["route_idx"] = train_h[ROUTE_COL].map(route2idx).astype(np.int64)
    train_h["office_idx"] = train_h[OFFICE_COL].map(office2idx).fillna(0).astype(np.int64)
    test_h["route_idx"] = test_h[ROUTE_COL].map(route2idx).astype(np.int64)
    test_h["office_idx"] = test_h[OFFICE_COL].map(office2idx).fillna(0).astype(np.int64)
    return train_h, test_h, route2idx, office2idx


def save_json(path: str | Path, payload: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


class SeqDataset(Dataset):
    def __init__(self, samples: list[dict]):
        self.samples = samples

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        s = self.samples[idx]
        out: dict[str, torch.Tensor] = {
            "x": torch.tensor(s["x"], dtype=torch.float32),
            "route_idx": torch.tensor(s["route_idx"], dtype=torch.long),
            "office_idx": torch.tensor(s["office_idx"], dtype=torch.long),
        }
        if "y" in s:
            out["y"] = torch.tensor(s["y"], dtype=torch.float32)
        if "y_true_raw" in s:
            out["y_true_raw"] = torch.tensor(s["y_true_raw"], dtype=torch.float32)
        if "route_id" in s:
            out["route_id"] = torch.tensor(s["route_id"], dtype=torch.long)
        if "weight" in s:
            out["weight"] = torch.tensor(s["weight"], dtype=torch.float32)
        return out


class TFTLiteDataset(Dataset):
    def __init__(self, samples: list[dict]):
        self.samples = samples

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        s = self.samples[idx]
        out: dict[str, torch.Tensor] = {
            "x_hist": torch.tensor(s["x_hist"], dtype=torch.float32),
            "x_fut": torch.tensor(s["x_fut"], dtype=torch.float32),
            "route_idx": torch.tensor(s["route_idx"], dtype=torch.long),
            "office_idx": torch.tensor(s["office_idx"], dtype=torch.long),
        }
        if "y" in s:
            out["y"] = torch.tensor(s["y"], dtype=torch.float32)
        if "y_true_raw" in s:
            out["y_true_raw"] = torch.tensor(s["y_true_raw"], dtype=torch.float32)
        if "route_id" in s:
            out["route_id"] = torch.tensor(s["route_id"], dtype=torch.long)
        return out


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


class TFTLite(nn.Module):
    def __init__(
        self,
        hist_dim: int,
        fut_dim: int,
        n_routes: int,
        n_offices: int,
        hidden: int = 64,
        pred_len: int = PRED_LEN,
    ):
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

    def forward(
        self,
        x_hist: torch.Tensor,
        x_fut: torch.Tensor,
        route_idx: torch.Tensor,
        office_idx: torch.Tensor,
    ) -> torch.Tensor:
        hist_out, _ = self.hist_encoder(x_hist)
        fut_q = self.future_proj(x_fut)
        attn_out, _ = self.attn(query=fut_q, key=hist_out, value=hist_out)
        last_h = hist_out[:, -1, :]
        static = torch.cat([last_h, self.route_emb(route_idx), self.office_emb(office_idx)], dim=1)
        static = self.static_proj(static).unsqueeze(1)
        fused = attn_out + static
        fused = fused.reshape(fused.size(0), -1)
        return self.head(fused)


class NBEATSBlock(nn.Module):
    def __init__(self, input_size: int, theta_size: int, hidden_size: int, n_layers: int, lookback: int, pred_len: int):
        super().__init__()
        layers: list[nn.Module] = [nn.Linear(input_size, hidden_size), nn.ReLU()]
        for _ in range(n_layers - 1):
            layers += [nn.Linear(hidden_size, hidden_size), nn.ReLU()]
        self.fc = nn.Sequential(*layers)
        self.backcast_linear = nn.Linear(hidden_size, theta_size)
        self.forecast_linear = nn.Linear(hidden_size, theta_size)
        self.backcast_basis = nn.Linear(theta_size, lookback, bias=False)
        self.forecast_basis = nn.Linear(theta_size, pred_len, bias=False)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.fc(x)
        backcast = self.backcast_basis(self.backcast_linear(h))
        forecast = self.forecast_basis(self.forecast_linear(h))
        return backcast, forecast


class NBEATSLite(nn.Module):
    def __init__(
        self,
        lookback: int,
        pred_len: int,
        n_routes: int,
        n_offices: int,
        hidden_size: int = 256,
        n_blocks: int = 3,
        n_layers: int = 4,
        theta_size: int = 32,
    ):
        super().__init__()
        self.lookback = lookback
        self.pred_len = pred_len
        self.route_emb = nn.Embedding(n_routes, 12)
        self.office_emb = nn.Embedding(n_offices + 1, 6)
        input_size = lookback + 12 + 6
        self.blocks = nn.ModuleList([
            NBEATSBlock(input_size, theta_size, hidden_size, n_layers, lookback, pred_len)
            for _ in range(n_blocks)
        ])

    def forward(self, x: torch.Tensor, route_idx: torch.Tensor, office_idx: torch.Tensor) -> torch.Tensor:
        # x: (B, lookback) — normalized target sequence
        r_emb = self.route_emb(route_idx)
        o_emb = self.office_emb(office_idx)
        residual = x
        forecast = torch.zeros(x.size(0), self.pred_len, device=x.device)
        for block in self.blocks:
            inp = torch.cat([residual, r_emb, o_emb], dim=1)
            backcast, block_forecast = block(inp)
            residual = residual - backcast
            forecast = forecast + block_forecast
        return forecast


def run_epoch_gru(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    loader,
    device: str,
    train_mode: bool,
) -> float:
    model.train() if train_mode else model.eval()
    losses: list[float] = []
    for batch in loader:
        x = batch["x"].to(device)
        y = batch["y"].to(device)
        route_idx = batch["route_idx"].to(device)
        office_idx = batch["office_idx"].to(device)
        with torch.set_grad_enabled(train_mode):
            pred = model(x, route_idx, office_idx)
            if "weight" in batch and train_mode:
                w = batch["weight"].to(device)  # (B,)
                loss_per_sample = torch.nn.functional.l1_loss(pred, y, reduction="none").mean(dim=1)  # (B,)
                loss = (loss_per_sample * w).mean()
            else:
                loss = criterion(pred, y)
            if train_mode:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
        losses.append(float(loss.item()))
    return float(np.mean(losses)) if losses else float("nan")


def run_epoch_tft(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    loader,
    device: str,
    train_mode: bool,
) -> float:
    model.train() if train_mode else model.eval()
    losses: list[float] = []
    for batch in loader:
        x_hist = batch["x_hist"].to(device)
        x_fut = batch["x_fut"].to(device)
        y = batch["y"].to(device)
        route_idx = batch["route_idx"].to(device)
        office_idx = batch["office_idx"].to(device)
        with torch.set_grad_enabled(train_mode):
            pred = model(x_hist, x_fut, route_idx, office_idx)
            loss = criterion(pred, y)
            if train_mode:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
        losses.append(float(loss.item()))
    return float(np.mean(losses)) if losses else float("nan")
