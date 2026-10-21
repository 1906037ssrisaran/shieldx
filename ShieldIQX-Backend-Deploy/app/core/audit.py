import json
import logging
from threading import RLock
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import firebase_admin
from firebase_admin import firestore

from app.core.auth import Principal
from app.core.config import Settings

logger = logging.getLogger("shieldiq.audit")
_local_events: list[dict[str, Any]] = []
_events_lock = RLock()


def record_audit(
    settings: Settings,
    principal: Principal,
    action: str,
    resource_type: str,
    resource_id: str,
    request_id: str,
    *,
    outcome: str = "success",
    metadata: dict[str, Any] | None = None,
) -> None:
    event = {
        "eventId": str(uuid4()),
        "tenantId": principal.tenant_id,
        "actorId": principal.user_id,
        "actorRole": principal.role.value,
        "action": action,
        "resourceType": resource_type,
        "resourceId": resource_id,
        "occurredAt": datetime.now(UTC).isoformat(),
        "requestId": request_id,
        "outcome": outcome,
        "metadata": metadata or {},
    }
    with _events_lock:
        _local_events.append(event)
        del _local_events[:-500]
    logger.info(json.dumps(event, separators=(",", ":"), default=str))
    if settings.demo_mode:
        return
    try:
        app = firebase_admin.get_app()
        firestore.client(app=app, database_id=settings.firestore_database_id).collection(
            "auditEvents"
        ).document(event["eventId"]).create(event)
    except ValueError:
        logger.error("Audit persistence is unavailable: Firebase Admin has not been initialized")
        raise RuntimeError("Audit persistence is unavailable")
    except Exception:
        logger.exception("Failed to persist audit event %s", event["eventId"])
        raise


def recent_audit_events(settings: Settings, principal: Principal, limit: int = 50) -> list[dict[str, Any]]:
    if settings.demo_mode:
        with _events_lock:
            return [
                event
                for event in reversed(_local_events)
                if event["tenantId"] == principal.tenant_id
            ][:limit]
    try:
        app = firebase_admin.get_app()
        documents = (
            firestore.client(app=app, database_id=settings.firestore_database_id)
            .collection("auditEvents")
            .where("tenantId", "==", principal.tenant_id)
            .order_by("occurredAt", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        return [document.to_dict() or {} for document in documents]
    except Exception:
        logger.exception("Failed to read audit events for tenant %s", principal.tenant_id)
        raise
