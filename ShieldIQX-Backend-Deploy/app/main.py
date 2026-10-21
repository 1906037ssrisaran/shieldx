import logging
import os
import sys

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.health import router as health_router
from app.api.v1.routes import limiter, router as api_router
from app.core.config import get_settings
from app.core.middleware import RequestContextMiddleware
from app.core.observability import RequestMetricsMiddleware

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("shieldiq.api")
settings = get_settings()

app = FastAPI(
    title="ShieldIQ X API",
    description="Explainable fraud investigation and risk intelligence API.",
    version="0.2.0",
    docs_url="/docs" if settings.environment == "local" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment == "local" else None,
)
app.state.limiter = limiter
app.add_middleware(RequestMetricsMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Demo-Role",
        "X-Demo-User",
    ],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_error(request: Request, error: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "rate_limited",
                "message": "Rate limit exceeded",
                "requestId": getattr(request.state, "request_id", "unknown"),
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, error: StarletteHTTPException):
    code = {
        401: "unauthenticated",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "invalid_request",
        429: "rate_limited",
        502: "upstream_failure",
        503: "unavailable",
    }.get(error.status_code, "request_failed")
    return JSONResponse(
        status_code=error.status_code,
        headers=error.headers,
        content={
            "error": {
                "code": code,
                "message": error.detail if isinstance(error.detail, str) else "Request failed",
                "requestId": getattr(request.state, "request_id", "unknown"),
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    fields = [
        {"field": ".".join(str(part) for part in item["loc"]), "message": item["msg"]}
        for item in error.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_request",
                "message": "Request validation failed",
                "requestId": getattr(request.state, "request_id", "unknown"),
                "details": fields,
            }
        },
    )


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(
        "Unhandled API exception requestId=%s errorType=%s",
        request_id,
        type(error).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "The request could not be completed",
                "requestId": request_id,
            }
        },
    )


app.include_router(health_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api/v1")
