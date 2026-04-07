"""
Forecast service.

Priority:
  1. Live GRU inference — loads checkpoint h28_h27b_gru_winsorized_target.pt,
     takes last 24 points from train history up to current_time, runs model.
  2. Rolling mean fallback — used when checkpoint is unavailable or route
     has insufficient history (< 24 points).
"""

import pandas as pd
import numpy as np

from .data_loader import get_train, get_all_route_ids, get_history
from .simulator import get_current_time
from .model_loader import predict, model_available
from ..models.schemas import ForecastStep, ForecastResponse

STEP_MINUTES = 30
N_STEPS = 10
LOOKBACK = 24


def _rolling_forecast(route_id: int, inference_ts: pd.Timestamp) -> list[float]:
    """
    Fallback forecast: rolling mean of last 48 points with hour-of-day scaling.
    Used when model checkpoint is absent or route has < LOOKBACK history points.
    """
    train = get_train()
    hist = train[
        (train["route_id"] == route_id) &
        (train["timestamp"] <= inference_ts)
    ].tail(48)

    if len(hist) == 0:
        return [0.0] * N_STEPS

    base = float(hist["target_2h"].mean())

    route_data = train[train["route_id"] == route_id].copy()
    route_data["hour"] = route_data["timestamp"].dt.hour
    hourly_means = route_data.groupby("hour")["target_2h"].mean()
    global_mean = float(route_data["target_2h"].mean()) or 1.0

    preds = []
    for step in range(1, N_STEPS + 1):
        future_ts = inference_ts + pd.Timedelta(minutes=STEP_MINUTES * step)
        hour = future_ts.hour
        scale = hourly_means.get(hour, global_mean) / global_mean
        preds.append(max(0.0, round(base * scale, 2)))

    return preds


def get_forecast(route_id: int, inference_ts: pd.Timestamp | None = None) -> ForecastResponse:
    if inference_ts is None:
        inference_ts = get_current_time()

    source = "rolling_mean_fallback"
    preds: list[float] | None = None

    # --- Live GRU inference ---
    if model_available():
        history = get_history(route_id, up_to=inference_ts, lookback=LOOKBACK)
        if len(history) >= LOOKBACK:
            preds = predict(route_id, history)
            if preds is not None:
                source = "gru_h27b_live"

    # --- Fallback ---
    if preds is None:
        preds = _rolling_forecast(route_id, inference_ts)

    steps = []
    for i, pred in enumerate(preds):
        step = i + 1
        ts = inference_ts + pd.Timedelta(minutes=STEP_MINUTES * step)
        steps.append(ForecastStep(step=step, timestamp=ts, y_pred=pred))

    return ForecastResponse(
        route_id=route_id,
        inference_timestamp=inference_ts,
        predictions=steps,
        source=source,
    )


def get_all_forecasts(inference_ts: pd.Timestamp | None = None) -> list[ForecastResponse]:
    if inference_ts is None:
        inference_ts = get_current_time()
    route_ids = get_all_route_ids()
    return [get_forecast(rid, inference_ts) for rid in route_ids]
