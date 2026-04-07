"""
Metrics service: computes business KPIs from orders and forecasts.
"""

import pandas as pd
from collections import defaultdict

from .planner_service import get_transport_orders, VEHICLES
from .simulator import get_current_time
from ..models.schemas import MetricsSummary, RouteMetrics


def get_metrics(inference_ts: pd.Timestamp | None = None) -> MetricsSummary:
    if inference_ts is None:
        inference_ts = get_current_time()

    orders_resp = get_transport_orders(inference_ts)
    orders = orders_resp.orders

    if not orders:
        return MetricsSummary(
            simulation_time=inference_ts,
            avg_utilization=0.0,
            on_time_dispatch_rate=1.0,
            total_orders=0,
            total_cost_rub=0,
            cost_per_parcel_rub=0.0,
            routes=[],
        )

    # Aggregate per route
    route_stats: dict[int, dict] = defaultdict(lambda: {
        "utilizations": [],
        "orders": 0,
        "cost": 0,
        "office_from_id": 0,
        "on_time": 0,
    })

    total_parcels = 0.0
    on_time_count = 0

    for order in orders:
        r = route_stats[order.route_id]
        r["utilizations"].append(order.utilization)
        r["orders"] += 1
        r["cost"] += order.vehicle.cost_rub
        r["office_from_id"] = order.office_from_id
        total_parcels += order.forecast_volume

        # on-time = dispatch_at is at least lead_time before peak
        is_on_time = order.dispatch_at >= inference_ts
        if is_on_time:
            r["on_time"] += 1
            on_time_count += 1

    route_metrics = []
    for rid, stats in route_stats.items():
        avg_util = sum(stats["utilizations"]) / len(stats["utilizations"])
        on_time_rate = stats["on_time"] / stats["orders"] if stats["orders"] > 0 else 1.0
        route_metrics.append(RouteMetrics(
            route_id=rid,
            office_from_id=stats["office_from_id"],
            avg_utilization=round(avg_util, 3),
            total_orders=stats["orders"],
            total_cost_rub=stats["cost"],
            on_time_rate=round(on_time_rate, 3),
        ))

    total_orders = len(orders)
    total_cost = orders_resp.total_cost_rub
    avg_util = sum(o.utilization for o in orders) / total_orders
    on_time_rate = on_time_count / total_orders if total_orders > 0 else 1.0
    cost_per_parcel = total_cost / total_parcels if total_parcels > 0 else 0.0

    return MetricsSummary(
        simulation_time=inference_ts,
        avg_utilization=round(avg_util, 3),
        on_time_dispatch_rate=round(on_time_rate, 3),
        total_orders=total_orders,
        total_cost_rub=total_cost,
        cost_per_parcel_rub=round(cost_per_parcel, 2),
        routes=sorted(route_metrics, key=lambda x: x.avg_utilization, reverse=True),
    )
