import json
import logging
from time import perf_counter

from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("shieldiq.http")


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        started = perf_counter()
        response = await call_next(request)
        duration_ms = round((perf_counter() - started) * 1000, 2)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        logger.info(
            json.dumps(
                {
                    "event": "http.request",
                    "requestId": getattr(request.state, "request_id", "unknown"),
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "durationMs": duration_ms,
                },
                separators=(",", ":"),
            )
        )
        return response
