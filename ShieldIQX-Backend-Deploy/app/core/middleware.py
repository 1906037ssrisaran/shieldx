from time import perf_counter
from uuid import UUID, uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        supplied_id = request.headers.get("x-request-id", "")
        try:
            request_id = str(UUID(supplied_id))
        except (ValueError, AttributeError):
            request_id = str(uuid4())
        request.state.request_id = request_id
        started = perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["Server-Timing"] = f"app;dur={(perf_counter() - started) * 1000:.2f}"
        return response
