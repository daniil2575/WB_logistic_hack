from fastapi import APIRouter, Query, HTTPException
from datetime import datetime
import pandas as pd

from ..services.forecast_service import get_forecast, get_all_forecasts
from ..services.simulator import get_current_time
from ..models.schemas import ForecastResponse

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/{route_id}", response_model=ForecastResponse)
def forecast_route(
    route_id: int,
    t: datetime | None = Query(default=None, description="Inference timestamp (ISO 8601). Defaults to simulator current time."),
):
    ts = pd.Timestamp(t) if t else get_current_time()
    return get_forecast(route_id, ts)


@router.get("/", response_model=list[ForecastResponse])
def forecast_all(
    t: datetime | None = Query(default=None, description="Inference timestamp. Defaults to simulator current time."),
):
    ts = pd.Timestamp(t) if t else get_current_time()
    return get_all_forecasts(ts)
