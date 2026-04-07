from pydantic import BaseModel
from datetime import datetime
from typing import Optional


# --- Forecast ---

class ForecastStep(BaseModel):
    step: int
    timestamp: datetime
    y_pred: float


class ForecastResponse(BaseModel):
    route_id: int
    inference_timestamp: datetime
    predictions: list[ForecastStep]


# --- Transport ---

class VehicleType(BaseModel):
    name: str          # "gazelle" | "medium" | "large"
    label: str         # "Газель" | "Средний грузовик" | "Фура"
    capacity: int      # parcels
    lead_time_hours: float
    cost_rub: int


class TransportOrder(BaseModel):
    order_id: str
    route_id: int
    office_from_id: int
    created_at: datetime
    dispatch_at: datetime        # когда должна приехать машина
    vehicle: VehicleType
    forecast_volume: float       # прогнозируемый объём на окно
    utilization: float           # forecast_volume / capacity


class TransportOrdersResponse(BaseModel):
    simulation_time: datetime
    orders: list[TransportOrder]
    total_orders: int
    total_cost_rub: int


# --- Metrics ---

class RouteMetrics(BaseModel):
    route_id: int
    office_from_id: int
    avg_utilization: float
    total_orders: int
    total_cost_rub: int
    on_time_rate: float


class MetricsSummary(BaseModel):
    simulation_time: datetime
    avg_utilization: float
    on_time_dispatch_rate: float
    total_orders: int
    total_cost_rub: int
    cost_per_parcel_rub: float
    routes: list[RouteMetrics]


# --- Simulate ---

class SimulateTickResponse(BaseModel):
    previous_time: datetime
    current_time: datetime
    new_orders: list[TransportOrder]


class SimulateSetTimeRequest(BaseModel):
    timestamp: datetime


class SimulateStatusResponse(BaseModel):
    current_time: datetime
    min_time: datetime
    max_time: datetime
    available_routes: list[int]
