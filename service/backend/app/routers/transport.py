from fastapi import APIRouter, Query
from datetime import datetime
import pandas as pd

from ..services.planner_service import get_transport_orders
from ..services.simulator import get_current_time
from ..models.schemas import TransportOrdersResponse

router = APIRouter(prefix="/transport", tags=["transport"])


@router.get("/orders", response_model=TransportOrdersResponse)
def transport_orders(
    t: datetime | None = Query(default=None, description="Inference timestamp. Defaults to simulator current time."),
    route_id: int | None = Query(default=None, description="Filter by route_id. Returns all routes if omitted."),
):
    ts = pd.Timestamp(t) if t else get_current_time()
    return get_transport_orders(ts, route_id)
