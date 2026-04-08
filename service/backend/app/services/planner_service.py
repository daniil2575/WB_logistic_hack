"""
Transport planner.

Given forecast predictions for a route, decides:
- how many vehicles to dispatch and of which type
- when to dispatch (lead time before peak)

Uses an exact optimizer (exhaustive integer search) to find the minimum-cost
fleet mix for each 2-hour window, rather than a greedy single-vehicle selection.
"""

import math
import uuid
import pandas as pd

from .forecast_service import get_forecast, get_all_forecasts
from .data_loader import get_route_office_map
from .simulator import get_current_time
from ..models.schemas import TransportOrder, TransportOrdersResponse, VehicleType

STEP_MINUTES = 30
FORECAST_WINDOW_STEPS = 4  # sum predictions over 2 hours (4 × 30min) to trigger order

# Vehicles ordered largest → smallest (for naive fallback and lead-time selection)
DEFAULT_COSTS: dict[str, int] = {
    "large":   27000,
    "medium":  10000,
    "gazelle": 4000,
}

VEHICLES: list[VehicleType]  # alias for backwards compatibility — set after definition

BASE_VEHICLES: list[VehicleType] = [
    VehicleType(name="large",   label="Фура",             capacity=1000, lead_time_hours=3.0, cost_rub=DEFAULT_COSTS["large"]),
    VehicleType(name="medium",  label="Средний грузовик", capacity=300,  lead_time_hours=2.0, cost_rub=DEFAULT_COSTS["medium"]),
    VehicleType(name="gazelle", label="Газель",           capacity=100,  lead_time_hours=1.5, cost_rub=DEFAULT_COSTS["gazelle"]),
]


VEHICLES = BASE_VEHICLES  # backwards-compatible alias


def _get_vehicles(tariffs: dict[str, int] | None) -> list[VehicleType]:
    if not tariffs:
        return BASE_VEHICLES
    result = []
    for v in BASE_VEHICLES:
        if v.name in tariffs:
            result.append(v.model_copy(update={"cost_rub": tariffs[v.name]}))
        else:
            result.append(v)
    return result

TRIGGER_THRESHOLD = 0.70  # create an order only if volume >= 70% of smallest vehicle


# ---------------------------------------------------------------------------
# Fleet optimizer
# ---------------------------------------------------------------------------

def _optimize_fleet(volume: float, vehicles: list[VehicleType]) -> tuple[list[tuple[VehicleType, int]], int]:
    """
    Find the cheapest integer combination of vehicles to move `volume` parcels.

    Solves:  min  Σ cost_i · n_i
             s.t. Σ capacity_i · n_i >= volume
                  n_i ∈ ℤ≥0

    Returns ([(vehicle, count), ...], optimal_cost_rub).
    Only non-zero counts are included.
    """
    large   = next(v for v in vehicles if v.name == "large")
    medium  = next(v for v in vehicles if v.name == "medium")
    gazelle = next(v for v in vehicles if v.name == "gazelle")

    best_cost = math.inf
    best_l = best_m = best_g = 0

    max_l = math.ceil(volume / large.capacity)
    max_m = math.ceil(volume / medium.capacity)

    for l in range(max_l + 1):
        for m in range(max_m + 1):
            remaining = volume - l * large.capacity - m * medium.capacity
            g = max(0, math.ceil(remaining / gazelle.capacity)) if remaining > 0 else 0
            cost = l * large.cost_rub + m * medium.cost_rub + g * gazelle.cost_rub
            if cost < best_cost:
                best_cost = cost
                best_l, best_m, best_g = l, m, g

    result = []
    if best_l: result.append((large,   best_l))
    if best_m: result.append((medium,  best_m))
    if best_g: result.append((gazelle, best_g))
    return result, int(best_cost)


def _naive_cost(volume: float, vehicles: list[VehicleType]) -> int:
    """Cost of the naive strategy: one smallest-sufficient vehicle (or multiple large)."""
    for vehicle in reversed(vehicles):  # smallest first
        if volume <= vehicle.capacity:
            return vehicle.cost_rub
    large = next(v for v in vehicles if v.name == "large")
    return math.ceil(volume / large.capacity) * large.cost_rub


# ---------------------------------------------------------------------------
# Order builder
# ---------------------------------------------------------------------------

def _build_orders_for_route(
    route_id: int,
    office_id: int,
    predictions: list,
    current_time: pd.Timestamp,
    vehicles: list[VehicleType],
) -> tuple[list[TransportOrder], int]:
    """
    Returns (orders, naive_cost_for_this_route).
    """
    orders = []
    naive_cost_total = 0
    n = len(predictions)

    i = 0
    while i < n:
        window = predictions[i:i + FORECAST_WINDOW_STEPS]
        if not window:
            break

        volume = sum(p.y_pred for p in window)
        smallest_trigger = vehicles[-1].capacity * TRIGGER_THRESHOLD  # 70 parcels

        if volume >= smallest_trigger:
            fleet, opt_cost = _optimize_fleet(volume, vehicles)
            naive_cost_total += _naive_cost(volume, vehicles)

            # Lead time = max lead time across chosen vehicle types (so all arrive in time)
            lead_time = max(v.lead_time_hours for v, _ in fleet) if fleet else 1.5
            peak_ts = window[-1].timestamp
            dispatch_at = peak_ts - pd.Timedelta(hours=lead_time)

            if dispatch_at >= current_time:
                total_capacity = sum(v.capacity * cnt for v, cnt in fleet)
                for vehicle, count in fleet:
                    vol_per = round(volume * (vehicle.capacity * count) / total_capacity, 1)
                    vol_each = round(vol_per / count, 1)
                    for _ in range(count):
                        orders.append(TransportOrder(
                            order_id=str(uuid.uuid4())[:8],
                            route_id=route_id,
                            office_from_id=office_id,
                            created_at=current_time,
                            dispatch_at=dispatch_at,
                            vehicle=vehicle,
                            forecast_volume=vol_each,
                            utilization=round(vol_each / vehicle.capacity, 3),
                        ))

            i += FORECAST_WINDOW_STEPS
        else:
            i += 1

    return orders, naive_cost_total


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_transport_orders(
    inference_ts: pd.Timestamp | None = None,
    route_id: int | None = None,
    tariffs: dict[str, int] | None = None,
) -> TransportOrdersResponse:
    if inference_ts is None:
        inference_ts = get_current_time()

    vehicles = _get_vehicles(tariffs)
    route_office = get_route_office_map()

    if route_id is not None:
        forecasts = [get_forecast(route_id, inference_ts)]
    else:
        forecasts = get_all_forecasts(inference_ts)

    all_orders: list[TransportOrder] = []
    naive_cost_total = 0

    for fc in forecasts:
        rid = fc.route_id
        office_id = route_office.get(rid, 0)
        orders, naive_cost = _build_orders_for_route(rid, office_id, fc.predictions, inference_ts, vehicles)
        all_orders.extend(orders)
        naive_cost_total += naive_cost

    # Deduplicate: if same (route_id, dispatch_at window), keep optimal set
    # — group by (route_id, rounded dispatch_at slot) and keep all within each slot
    seen_keys: set[tuple] = set()
    deduped: list[TransportOrder] = []
    for order in all_orders:
        slot = (order.route_id, round(order.dispatch_at.timestamp() / 1800))
        if slot not in seen_keys:
            seen_keys.add(slot)
        deduped.append(order)
    all_orders = deduped
    all_orders.sort(key=lambda o: o.dispatch_at)

    total_cost = sum(o.vehicle.cost_rub for o in all_orders)
    savings = max(0, naive_cost_total - total_cost)

    return TransportOrdersResponse(
        simulation_time=inference_ts,
        orders=all_orders,
        total_orders=len(all_orders),
        total_cost_rub=total_cost,
        naive_cost_rub=naive_cost_total,
        savings_rub=savings,
    )
