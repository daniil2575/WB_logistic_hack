from fastapi import APIRouter
import pandas as pd

from ..services.simulator import get_current_time, set_time, tick, reset
from ..services.planner_service import get_transport_orders
from ..services.forecast_service import invalidate_cache
from ..services.data_loader import get_time_bounds, get_all_route_ids
from ..models.schemas import SimulateTickResponse, SimulateSetTimeRequest, SimulateStatusResponse

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.get("/status", response_model=SimulateStatusResponse)
def simulate_status():
    min_t, max_t = get_time_bounds()
    return SimulateStatusResponse(
        current_time=get_current_time(),
        min_time=min_t,
        max_time=max_t,
        available_routes=get_all_route_ids(),
    )


@router.post("/tick", response_model=SimulateTickResponse)
def simulate_tick():
    prev, current = tick()
    invalidate_cache()
    new_orders_resp = get_transport_orders(current)
    return SimulateTickResponse(
        previous_time=prev,
        current_time=current,
        new_orders=new_orders_resp.orders,
    )


@router.post("/set", response_model=SimulateStatusResponse)
def simulate_set(body: SimulateSetTimeRequest):
    set_time(pd.Timestamp(body.timestamp))
    invalidate_cache()
    min_t, max_t = get_time_bounds()
    return SimulateStatusResponse(
        current_time=get_current_time(),
        min_time=min_t,
        max_time=max_t,
        available_routes=get_all_route_ids(),
    )


@router.post("/reset", response_model=SimulateStatusResponse)
def simulate_reset():
    reset()
    invalidate_cache()
    min_t, max_t = get_time_bounds()
    return SimulateStatusResponse(
        current_time=get_current_time(),
        min_time=min_t,
        max_time=max_t,
        available_routes=get_all_route_ids(),
    )
