from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    service: str


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="shieldiq-api")


@router.get("/health/ready", response_model=HealthResponse, tags=["health"])
async def readiness() -> HealthResponse:
    return HealthResponse(status="ready", service="shieldiq-api")
