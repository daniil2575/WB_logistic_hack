"""
Forecast service.

Priority:
  1. Full Ridge stack inference — GRU h27b + GRU h23 + TFT h39 + LGBM + Naive → Ridge
     Uses last 48 points from train history up to current_time.
     source = "ridge_stack_live"
  2. Rolling mean fallback — used when any checkpoint is missing or
     route has insufficient history.
     source = "rolling_mean_fallback"
"""

import pandas as pd
import numpy as np

from .data_loader import get_train, get_all_route_ids, get_history
from .simulator import get_current_time
from .model_loader import predict_stack, stack_available
from ..models.schemas import ForecastStep, ForecastResponse

STEP_MINUTES = 30
N_STEPS = 10
HISTORY_LOOKBACK = 400  # enough for naive (336) + lags (48)

_forecast_cache: dict[str, list] = {}
_route_forecast_cache: dict[str, "ForecastResponse"] = {}


def _rolling_forecast(route_id: int, inference_ts: pd.Timestamp) -> list[float]:
    """
    Fallback: rolling mean of last 48 points with hour-of-day scaling.
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
        scale = hourly_means.get(future_ts.hour, global_mean) / global_mean
        preds.append(max(0.0, round(base * scale, 2)))
    return preds


def get_forecast(route_id: int, inference_ts: pd.Timestamp | None = None) -> ForecastResponse:
    if inference_ts is None:
        inference_ts = get_current_time()

    route_cache_key = f"{route_id}:{inference_ts}"
    if route_cache_key in _route_forecast_cache:
        return _route_forecast_cache[route_cache_key]

    source = "rolling_mean_fallback"
    preds: list[float] | None = None
    lows: list[float] | None = None
    highs: list[float] | None = None

    if stack_available():
        history = get_history(route_id, up_to=inference_ts, lookback=HISTORY_LOOKBACK)
        if len(history) >= 48:
            stack_result = predict_stack(route_id, history, inference_ts)
            if stack_result is not None:
                preds, lows, highs = stack_result
                source = "ridge_stack_live"

    if preds is None:
        preds = _rolling_forecast(route_id, inference_ts)

    steps = [
        ForecastStep(
            step=i + 1,
            timestamp=inference_ts + pd.Timedelta(minutes=STEP_MINUTES * (i + 1)),
            y_pred=pred,
            y_pred_lo=lows[i] if lows else None,
            y_pred_hi=highs[i] if highs else None,
        )
        for i, pred in enumerate(preds)
    ]

    response = ForecastResponse(
        route_id=route_id,
        inference_timestamp=inference_ts,
        predictions=steps,
        source=source,
    )
    _route_forecast_cache[route_cache_key] = response
    if len(_route_forecast_cache) > 200:
        del _route_forecast_cache[next(iter(_route_forecast_cache))]
    return response


def invalidate_cache() -> None:
    _forecast_cache.clear()
    _route_forecast_cache.clear()


def get_all_forecasts(inference_ts: pd.Timestamp | None = None, limit: int = 10) -> list[ForecastResponse]:
    if inference_ts is None:
        inference_ts = get_current_time()
    cache_key = str(inference_ts)
    if cache_key in _forecast_cache:
        return _forecast_cache[cache_key]
    route_ids = get_all_route_ids()[:limit]
    results = [get_forecast(rid, inference_ts) for rid in route_ids]
    _forecast_cache[cache_key] = results
    if len(_forecast_cache) > 10:
        del _forecast_cache[next(iter(_forecast_cache))]
    return results
