from fastapi import APIRouter, Query
from datetime import datetime
import pandas as pd

from ..services.metrics_service import get_metrics
from ..services.simulator import get_current_time
from ..models.schemas import MetricsSummary

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/", response_model=MetricsSummary)
def metrics(
    t: datetime | None = Query(default=None, description="Inference timestamp. Defaults to simulator current time."),
):
    ts = pd.Timestamp(t) if t else get_current_time()
    return get_metrics(ts)
