"""
Transport planner.

Given forecast predictions for a route, decides:
- how many vehicles to dispatch
- which vehicle type
- when to dispatch (lead time before peak)
"""

import uuid
import pandas as pd
from datetime import datetime

from .forecast_service import get_forecast, get_all_forecasts
from .data_loader import get_route_office_map
from .simulator import get_current_time
from ..models.schemas import TransportOrder, TransportOrdersResponse, VehicleType

STEP_MINUTES = 30
FORECAST_WINDOW_STEPS = 4  # sum predictions over 2 hours (4 × 30min) to trigger order

VEHICLES: list[VehicleType] = [
    VehicleType(name="large",  label="Фура",             capacity=1000, lead_time_hours=3.0, cost_rub=27000),
    VehicleType(name="medium", label="Средний грузовик", capacity=300,  lead_time_hours=2.0, cost_rub=10000),
    VehicleType(name="gazelle",label="Газель",           capacity=100,  lead_time_hours=1.5, cost_rub=4000),
]

FILL_THRESHOLD = 0.70  # request vehicle if forecast >= 70% of capacity


def _select_vehicle(volume: float) -> VehicleType:
    """Pick the smallest vehicle that can handle the volume at fill_threshold."""
    for vehicle in reversed(VEHICLES):  # smallest first
        if volume <= vehicle.capacity * FILL_THRESHOLD:
            return vehicle
    return VEHICLES[0]  # largest


def _build_orders_for_route(
    route_id: int,
    office_id: int,
    predictions: list,
    current_time: pd.Timestamp,
) -> list[TransportOrder]:
    orders = []
    n = len(predictions)

    i = 0
    while i < n:
        # Sum next FORECAST_WINDOW_STEPS predictions
        window = predictions[i:i + FORECAST_WINDOW_STEPS]
        volume = sum(p.y_pred for p in window)

        if len(window) == 0:
            break

        # Check if any vehicle threshold is triggered
        smallest_trigger = VEHICLES[-1].capacity * FILL_THRESHOLD  # gazelle threshold = 70
        if volume >= smallest_trigger:
            vehicle = _select_vehicle(volume)
            peak_ts = window[-1].timestamp  # end of the window = dispatch time
            dispatch_at = peak_ts - pd.Timedelta(hours=vehicle.lead_time_hours)

            # Only create order if dispatch_at is in the future
            if dispatch_at >= current_time:
                utilization = min(volume / vehicle.capacity, 1.0)
                orders.append(TransportOrder(
                    order_id=str(uuid.uuid4())[:8],
                    route_id=route_id,
                    office_from_id=office_id,
                    created_at=current_time,
                    dispatch_at=dispatch_at,
                    vehicle=vehicle,
                    forecast_volume=round(volume, 1),
                    utilization=round(utilization, 3),
                ))
            i += FORECAST_WINDOW_STEPS  # advance past this window
        else:
            i += 1

    return orders


def get_transport_orders(
    inference_ts: pd.Timestamp | None = None,
    route_id: int | None = None,
) -> TransportOrdersResponse:
    if inference_ts is None:
        inference_ts = get_current_time()

    route_office = get_route_office_map()

    if route_id is not None:
        forecasts = [get_forecast(route_id, inference_ts)]
    else:
        forecasts = get_all_forecasts(inference_ts)

    all_orders: list[TransportOrder] = []
    for fc in forecasts:
        rid = fc.route_id
        office_id = route_office.get(rid, 0)
        orders = _build_orders_for_route(rid, office_id, fc.predictions, inference_ts)
        all_orders.extend(orders)

    total_cost = sum(o.vehicle.cost_rub for o in all_orders)

    return TransportOrdersResponse(
        simulation_time=inference_ts,
        orders=all_orders,
        total_orders=len(all_orders),
        total_cost_rub=total_cost,
    )
