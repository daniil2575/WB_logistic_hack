from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import forecast, transport, metrics, simulate

app = FastAPI(
    title="WB Logistics — Transport Planning Service",
    description="Forecasts parcel volumes and automatically generates transport orders for WildBerries warehouses.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forecast.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(simulate.router, prefix="/api")


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
