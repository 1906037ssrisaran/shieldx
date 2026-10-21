from copy import deepcopy
from datetime import UTC, datetime
from threading import RLock
from typing import Any
from uuid import uuid4

from firebase_admin import firestore

from app.core.auth import Principal
from app.core.config import Settings

_lock = RLock()
_local_cases: dict[str, dict[str, Any]] = {}
_local_notes: dict[str, list[dict[str, Any]]] = {}
_local_reports: dict[str, dict[str, Any]] = {}
_local_report_versions: dict[tuple[str, int], dict[str, Any]] = {}
_local_messages: dict[str, list[dict[str, Any]]] = {}


def _firestore_client(settings: Settings):
    import firebase_admin

    try:
        app = firebase_admin.get_app()
    except ValueError as error:
        raise RuntimeError("Firestore is not initialized") from error
    return firestore.client(app=app, database_id=settings.firestore_database_id)


def list_cases(settings: Settings, principal: Principal) -> list[dict[str, Any]]:
    seeded = [
        deepcopy(case)
        for case in DEMO_CASES
        if principal.tenant_id == "northstar-demo" or case["tenantId"] == principal.tenant_id
    ]
    if settings.demo_mode:
        with _lock:
            overrides = deepcopy(_local_cases)
        by_id = {case["id"]: case for case in seeded}
        by_id.update({case_id: row for case_id, row in overrides.items() if row["tenantId"] == principal.tenant_id})
        return sorted(by_id.values(), key=lambda case: case["updatedAt"], reverse=True)
    documents = (
        _firestore_client(settings)
        .collection("cases")
        .where("tenantId", "==", principal.tenant_id)
        .stream()
    )
    return sorted(
        [document.to_dict() | {"id": document.id} for document in documents],
        key=lambda case: case.get("updatedAt", ""),
        reverse=True,
    )


def get_case(settings: Settings, principal: Principal, case_id: str) -> dict[str, Any] | None:
    if settings.demo_mode:
        with _lock:
            case = _local_cases.get(case_id)
            if case and case["tenantId"] == principal.tenant_id:
                return deepcopy(case)
        case = next((row for row in DEMO_CASES if row["id"] == case_id), None)
        return deepcopy(case) if case else None
    snapshot = _firestore_client(settings).collection("cases").document(case_id).get()
    if not snapshot.exists:
        return None
    case = snapshot.to_dict() or {}
    if case.get("tenantId") != principal.tenant_id:
        return None
    return case | {"id": snapshot.id}


def save_case(settings: Settings, principal: Principal, case: dict[str, Any]) -> dict[str, Any]:
    if settings.demo_mode:
        with _lock:
            _local_cases[case["id"]] = deepcopy(case)
        return deepcopy(case)
    reference = _firestore_client(settings).collection("cases").document(case["id"])
    reference.set(case, merge=True)
    return case


def create_case(settings: Settings, principal: Principal, title: str, alert_id: str | None) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    case = {
        "id": f"CASE-{uuid4().hex[:8].upper()}",
        "tenantId": principal.tenant_id,
        "title": title,
        "status": "open",
        "priority": "medium",
        "riskScore": 0,
        "owner": principal.user_id,
        "createdAt": now,
        "updatedAt": now,
        "version": 1,
        "alertId": alert_id,
        "amountMinor": 0,
        "currency": "USD",
        "subject": "Unassigned entity",
        "reasonCodes": [],
        "evidenceCount": 0,
    }
    return save_case(settings, principal, case)


def update_case(settings: Settings, principal: Principal, case: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    expected_version = case.get("version", 0)
    if settings.demo_mode:
        with _lock:
            current = _local_cases.get(case["id"], case)
            if current.get("version", 0) != expected_version:
                raise ValueError("Case changed since it was loaded")
            updated = current | changes | {
                "updatedAt": datetime.now(UTC).isoformat(),
                "version": expected_version + 1,
            }
            _local_cases[case["id"]] = deepcopy(updated)
            return deepcopy(updated)
    client = _firestore_client(settings)
    reference = client.collection("cases").document(case["id"])
    transaction = client.transaction()

    @firestore.transactional
    def update_in_transaction(transaction):
        snapshot = reference.get(transaction=transaction)
        current = snapshot.to_dict() if snapshot.exists else None
        if not current or current.get("tenantId") != principal.tenant_id:
            raise LookupError("Case not found")
        if current.get("version", 0) != expected_version:
            raise ValueError("Case changed since it was loaded")
        updated = current | changes | {
            "updatedAt": datetime.now(UTC).isoformat(),
            "version": expected_version + 1,
        }
        transaction.set(reference, updated)
        return updated

    return update_in_transaction(transaction)


def add_note(
    settings: Settings,
    principal: Principal,
    case_id: str,
    body: str,
) -> dict[str, Any]:
    note = {
        "id": f"NOTE-{uuid4().hex[:8]}",
        "caseId": case_id,
        "tenantId": principal.tenant_id,
        "authorId": principal.user_id,
        "body": body,
        "createdAt": datetime.now(UTC).isoformat(),
    }
    if settings.demo_mode:
        with _lock:
            _local_notes.setdefault(case_id, []).append(note)
    else:
        _firestore_client(settings).collection("cases").document(case_id).collection("notes").document(
            note["id"]
        ).create(note)
    return note


def list_notes(settings: Settings, principal: Principal, case_id: str) -> list[dict[str, Any]]:
    if settings.demo_mode:
        with _lock:
            return deepcopy(_local_notes.get(case_id, []))
    snapshots = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("notes")
        .order_by("createdAt")
        .stream()
    )
    return [snapshot.to_dict() or {} for snapshot in snapshots]


def save_report(settings: Settings, principal: Principal, report: dict[str, Any]) -> dict[str, Any]:
    if settings.demo_mode:
        with _lock:
            _local_reports[report["id"]] = deepcopy(report)
            _local_report_versions[(report["id"], report["version"])] = deepcopy(report)
        return deepcopy(report)
    client = _firestore_client(settings)
    latest = (
        client.collection("cases")
        .document(report["caseId"])
        .collection("reports")
        .document(report["id"])
    )
    version = latest.collection("versions").document(str(report["version"]))
    batch = client.batch()
    batch.set(latest, report)
    batch.create(version, report)
    batch.commit()
    return report


def get_report(settings: Settings, principal: Principal, case_id: str, report_id: str) -> dict[str, Any] | None:
    if settings.demo_mode:
        with _lock:
            report = _local_reports.get(report_id)
            return (
                deepcopy(report)
                if report
                and report["caseId"] == case_id
                and report["tenantId"] == principal.tenant_id
                else None
            )
    snapshot = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("reports")
        .document(report_id)
        .get()
    )
    report = snapshot.to_dict() if snapshot.exists else None
    if not report or report.get("tenantId") != principal.tenant_id or report.get("caseId") != case_id:
        return None
    return report


def append_message(
    settings: Settings,
    principal: Principal,
    case_id: str,
    message: dict[str, Any],
) -> None:
    if settings.demo_mode:
        with _lock:
            _local_messages.setdefault(case_id, []).append(deepcopy(message))
        return
    _firestore_client(settings).collection("cases").document(case_id).collection("messages").document(
        message["id"]
    ).create(message)


def list_messages(settings: Settings, principal: Principal, case_id: str) -> list[dict[str, Any]]:
    if settings.demo_mode:
        with _lock:
            return deepcopy(_local_messages.get(case_id, []))
    snapshots = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("messages")
        .order_by("createdAt")
        .limit(100)
        .stream()
    )
    return [snapshot.to_dict() or {} for snapshot in snapshots]


def seed_case(case_id: str) -> dict[str, Any] | None:
    row = next((case for case in DEMO_CASES if case["id"] == case_id), None)
    return deepcopy(row) if row else None


def case_events(settings: Settings, principal: Principal, case_id: str) -> list[dict[str, Any]]:
    if settings.demo_mode:
        return deepcopy(DEMO_TIMELINE_BY_CASE.get(case_id, []))
    snapshots = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("events")
        .where("tenantId", "==", principal.tenant_id)
        .order_by("occurredAt")
        .limit(200)
        .stream()
    )
    return [
        {
            "id": snapshot.id,
            "time": snapshot.get("occurredAt"),
            "type": snapshot.get("type"),
            "title": snapshot.get("summary"),
            "description": snapshot.get("description", ""),
        }
        for snapshot in snapshots
    ]


def case_graph(settings: Settings, principal: Principal, case_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if settings.demo_mode:
        if case_id == "CASE-1042":
            return deepcopy(DEMO_NODES), deepcopy(DEMO_EDGES)
        return [], []
    client = _firestore_client(settings)
    edge_snapshots = (
        client.collection("entityEdges")
        .where("tenantId", "==", principal.tenant_id)
        .where("caseIds", "array_contains", case_id)
        .limit(200)
        .stream()
    )
    edges = []
    node_ids: set[str] = set()
    for snapshot in edge_snapshots:
        edge = snapshot.to_dict() or {}
        source = edge.get("sourceNodeId")
        target = edge.get("targetNodeId")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        node_ids.update((source, target))
        edges.append(
            {
                "id": snapshot.id,
                "source": source,
                "target": target,
                "label": edge.get("relationship", "RELATED"),
                "type": edge.get("relationshipType", "related"),
                "evidenceId": (edge.get("evidenceRefs") or [""])[0],
            }
        )
    nodes = []
    for node_id in sorted(node_ids)[:100]:
        snapshot = client.collection("entityNodes").document(node_id).get()
        if not snapshot.exists:
            continue
        row = snapshot.to_dict() or {}
        if row.get("tenantId") != principal.tenant_id:
            continue
        nodes.append(
            {
                "id": snapshot.id,
                "type": row.get("type", "entity"),
                "label": row.get("maskedLabel", "Masked entity"),
                "risk": row.get("riskScore", 0),
                "x": row.get("x", 0),
                "y": row.get("y", 0),
            }
        )
    return nodes, edges


DEMO_CASES = [
    {
        "id": "CASE-1042",
        "tenantId": "northstar-demo",
        "title": "Rapid pass-through transfers",
        "status": "investigating",
        "priority": "critical",
        "riskScore": 87,
        "owner": "Maya Chen",
        "createdAt": "2026-10-13T09:18:00+00:00",
        "updatedAt": "2026-10-13T09:42:00+00:00",
        "version": 3,
        "alertId": "ALT-8821",
        "amountMinor": 8472500,
        "currency": "USD",
        "subject": "ACCT •• 4821",
        "reasonCodes": ["VELOCITY_SPIKE", "SHARED_DEVICE", "NEW_BENEFICIARY"],
        "evidenceCount": 8,
    },
    {
        "id": "CASE-1038",
        "tenantId": "northstar-demo",
        "title": "Unusual cross-border activity",
        "status": "under_review",
        "priority": "high",
        "riskScore": 84,
        "owner": "Jordan Lee",
        "createdAt": "2026-10-13T08:30:00+00:00",
        "updatedAt": "2026-10-13T09:20:00+00:00",
        "version": 2,
        "alertId": "ALT-8814",
        "amountMinor": 3210000,
        "currency": "USD",
        "subject": "ACCT •• 1036",
        "reasonCodes": ["LOCATION_ANOMALY", "NEW_DEVICE"],
        "evidenceCount": 5,
    },
    {
        "id": "CASE-1031",
        "tenantId": "northstar-demo",
        "title": "Merchant refund velocity",
        "status": "open",
        "priority": "medium",
        "riskScore": 69,
        "owner": "Unassigned",
        "createdAt": "2026-10-12T16:05:00+00:00",
        "updatedAt": "2026-10-13T08:14:00+00:00",
        "version": 1,
        "alertId": "ALT-8799",
        "amountMinor": 1850000,
        "currency": "USD",
        "subject": "MERCH •• 7712",
        "reasonCodes": ["REFUND_VELOCITY"],
        "evidenceCount": 4,
    },
]

DEMO_ALERTS = [
    {
        "id": "ALT-8821",
        "caseId": "CASE-1042",
        "subject": "ACCT •• 4821",
        "type": "Rapid pass-through transfers",
        "score": 87,
        "severity": "critical",
        "createdAt": "2026-10-13T09:18:00+00:00",
        "amountMinor": 8472500,
        "currency": "USD",
        "reasons": ["VELOCITY_SPIKE", "SHARED_DEVICE", "NEW_BENEFICIARY"],
    },
    {
        "id": "ALT-8814",
        "caseId": "CASE-1038",
        "subject": "ACCT •• 1036",
        "type": "Unusual cross-border activity",
        "score": 84,
        "severity": "high",
        "createdAt": "2026-10-13T08:30:00+00:00",
        "amountMinor": 3210000,
        "currency": "USD",
        "reasons": ["LOCATION_ANOMALY", "NEW_DEVICE"],
    },
    {
        "id": "ALT-8799",
        "caseId": "CASE-1031",
        "subject": "MERCH •• 7712",
        "type": "Merchant refund velocity",
        "score": 69,
        "severity": "medium",
        "createdAt": "2026-10-13T07:42:00+00:00",
        "amountMinor": 1850000,
        "currency": "USD",
        "reasons": ["REFUND_VELOCITY"],
    },
]

DEMO_TRANSACTIONS = [
    {
        "id": "TX-71001",
        "caseId": "CASE-1042",
        "time": "2026-10-13T09:12:14+00:00",
        "from": "ACCT •• 4821",
        "to": "ACCT •• 9304",
        "amountMinor": 2980000,
        "currency": "USD",
        "channel": "Wire",
        "status": "settled",
        "risk": "critical",
        "evidenceId": "EV-TRX-71001",
    },
    {
        "id": "TX-71002",
        "caseId": "CASE-1042",
        "time": "2026-10-13T09:17:52+00:00",
        "from": "ACCT •• 9304",
        "to": "ACCT •• 2190",
        "amountMinor": 2745000,
        "currency": "USD",
        "channel": "ACH",
        "status": "settled",
        "risk": "high",
        "evidenceId": "EV-TRX-71002",
    },
    {
        "id": "TX-71003",
        "caseId": "CASE-1042",
        "time": "2026-10-13T09:24:09+00:00",
        "from": "ACCT •• 2190",
        "to": "MERCH •• 7712",
        "amountMinor": 2740000,
        "currency": "USD",
        "channel": "Card",
        "status": "review",
        "risk": "high",
        "evidenceId": "EV-TRX-71003",
    },
    {
        "id": "TX-70998",
        "caseId": "CASE-1042",
        "time": "2026-10-13T08:57:31+00:00",
        "from": "ACCT •• 4821",
        "to": "MERCH •• 1198",
        "amountMinor": 12400,
        "currency": "USD",
        "channel": "Card",
        "status": "settled",
        "risk": "low",
        "evidenceId": "EV-TRX-70998",
    },
    {
        "id": "TX-70811",
        "caseId": "CASE-1038",
        "time": "2026-10-13T08:17:03+00:00",
        "from": "ACCT •• 1036",
        "to": "ACCT •• 7702",
        "amountMinor": 3210000,
        "currency": "USD",
        "channel": "Wire",
        "status": "review",
        "risk": "high",
        "evidenceId": "EV-LOC-1038",
    },
    {
        "id": "TX-70701",
        "caseId": "CASE-1031",
        "time": "2026-10-12T15:51:20+00:00",
        "from": "MERCH •• 7712",
        "to": "ACCT •• 6603",
        "amountMinor": 1850000,
        "currency": "USD",
        "channel": "Refund",
        "status": "review",
        "risk": "medium",
        "evidenceId": "EV-REF-1031",
    },
]

DEMO_EVIDENCE = [
    {
        "id": "EV-TRX-71001",
        "type": "transaction",
        "title": "Outbound wire • $29,800.00",
        "observedAt": "2026-10-13T09:12:14+00:00",
        "source": "Core ledger · synthetic",
        "summary": "Account •• 4821 sent $29,800 to account •• 9304.",
        "confidence": "verified_record",
    },
    {
        "id": "EV-TRX-71002",
        "type": "transaction",
        "title": "Follow-on ACH • $27,450.00",
        "observedAt": "2026-10-13T09:17:52+00:00",
        "source": "Core ledger · synthetic",
        "summary": "Account •• 9304 sent $27,450 to account •• 2190, 5m 38s after receipt.",
        "confidence": "verified_record",
    },
    {
        "id": "EV-DEV-4408",
        "type": "device",
        "title": "Device DVC-4408 observed on 3 accounts",
        "observedAt": "2026-10-13T09:10:00+00:00",
        "source": "Device telemetry · synthetic",
        "summary": "A device fingerprint was observed on accounts •• 4821, •• 9304, and •• 2190.",
        "confidence": "observed_link",
    },
    {
        "id": "EV-IP-221",
        "type": "network",
        "title": "New network location",
        "observedAt": "2026-10-13T09:09:00+00:00",
        "source": "Sign-in telemetry · synthetic",
        "summary": "Sign-in from a new network region preceded the transfer sequence by 3 minutes.",
        "confidence": "observed_signal",
    },
    {
        "id": "EV-BEN-991",
        "type": "beneficiary",
        "title": "First transfer to beneficiary",
        "observedAt": "2026-10-13T09:12:14+00:00",
        "source": "Beneficiary registry · synthetic",
        "summary": "The destination account had no prior transfer history for account •• 4821.",
        "confidence": "verified_record",
    },
]

DEMO_EVIDENCE_BY_CASE = {
    "CASE-1042": DEMO_EVIDENCE,
    "CASE-1038": [
        {
            "id": "EV-LOC-1038",
            "type": "transaction",
            "title": "Cross-border wire • $32,100.00",
            "observedAt": "2026-10-13T08:17:03+00:00",
            "source": "Core ledger · synthetic",
            "summary": "Account •• 1036 initiated a wire to a newly observed counterparty.",
            "confidence": "verified_record",
        },
        {
            "id": "EV-DEV-1038",
            "type": "device",
            "title": "First-seen device",
            "observedAt": "2026-10-13T08:14:00+00:00",
            "source": "Device telemetry · synthetic",
            "summary": "Sign-in device was not observed on this account during the prior 90-day window.",
            "confidence": "observed_signal",
        },
        {
            "id": "EV-LOC-ALT-1038",
            "type": "network",
            "title": "Sign-in region differs from recent baseline",
            "observedAt": "2026-10-13T08:13:00+00:00",
            "source": "Sign-in telemetry · synthetic",
            "summary": "Observed country differs from the account's recent activity; travel context is unknown.",
            "confidence": "observed_signal",
        },
    ],
    "CASE-1031": [
        {
            "id": "EV-REF-1031",
            "type": "transaction",
            "title": "Refund volume above merchant baseline",
            "observedAt": "2026-10-12T15:51:20+00:00",
            "source": "Card ledger · synthetic",
            "summary": "A group of refund events exceeded the configured merchant velocity threshold.",
            "confidence": "verified_record",
        },
        {
            "id": "EV-MERCH-1031",
            "type": "merchant",
            "title": "Merchant refund pattern",
            "observedAt": "2026-10-12T16:05:00+00:00",
            "source": "Merchant monitoring · synthetic",
            "summary": "Refund activity increased relative to the synthetic 30-day comparison window.",
            "confidence": "observed_signal",
        },
    ],
}

DEMO_NODES = [
    {"id": "acct-4821", "type": "account", "label": "ACCT •• 4821", "risk": 96, "x": 100, "y": 160},
    {"id": "acct-9304", "type": "account", "label": "ACCT •• 9304", "risk": 88, "x": 360, "y": 75},
    {"id": "acct-2190", "type": "account", "label": "ACCT •• 2190", "risk": 82, "x": 600, "y": 165},
    {"id": "device-4408", "type": "device", "label": "DVC-4408", "risk": 91, "x": 360, "y": 260},
    {"id": "merchant-7712", "type": "merchant", "label": "MERCH •• 7712", "risk": 68, "x": 850, "y": 165},
    {"id": "ip-203-0-113", "type": "ip", "label": "IP 203.0.113.*", "risk": 74, "x": 100, "y": 330},
    {"id": "phone-4082", "type": "phone", "label": "PHONE •• 4082", "risk": 51, "x": 600, "y": 340},
    {"id": "email-north", "type": "email", "label": "n•••@mail.example", "risk": 44, "x": 850, "y": 345},
]

DEMO_EDGES = [
    {"id": "edge-transfer-1", "source": "acct-4821", "target": "acct-9304", "label": "TRANSFER · $29.8K", "type": "transfer", "evidenceId": "EV-TRX-71001"},
    {"id": "edge-transfer-2", "source": "acct-9304", "target": "acct-2190", "label": "TRANSFER · $27.5K", "type": "transfer", "evidenceId": "EV-TRX-71002"},
    {"id": "edge-transfer-3", "source": "acct-2190", "target": "merchant-7712", "label": "TRANSFER · $27.4K", "type": "transfer", "evidenceId": "EV-TRX-71003"},
    {"id": "edge-device-1", "source": "acct-4821", "target": "device-4408", "label": "SHARED DEVICE", "type": "device", "evidenceId": "EV-DEV-4408"},
    {"id": "edge-device-2", "source": "acct-9304", "target": "device-4408", "label": "SHARED DEVICE", "type": "device", "evidenceId": "EV-DEV-4408"},
    {"id": "edge-device-3", "source": "acct-2190", "target": "device-4408", "label": "SHARED DEVICE", "type": "device", "evidenceId": "EV-DEV-4408"},
    {"id": "edge-login-1", "source": "acct-4821", "target": "ip-203-0-113", "label": "LOGIN · NEW", "type": "network", "evidenceId": "EV-IP-221"},
    {"id": "edge-phone-1", "source": "acct-4821", "target": "phone-4082", "label": "OWNERSHIP", "type": "ownership", "evidenceId": "EV-DEV-4408"},
    {"id": "edge-email-1", "source": "acct-2190", "target": "email-north", "label": "OWNERSHIP", "type": "ownership", "evidenceId": "EV-BEN-991"},
]

DEMO_TIMELINE = [
    {"id": "EV-IP-221", "time": "2026-10-13T09:09:00+00:00", "type": "signal", "title": "New network region observed", "description": "New network region observed before transfer activity."},
    {"id": "EV-DEV-4408", "time": "2026-10-13T09:10:00+00:00", "type": "relationship", "title": "Device linked across three accounts", "description": "Device DVC-4408 appeared across the payment chain."},
    {"id": "EV-TRX-71001", "time": "2026-10-13T09:12:14+00:00", "type": "transaction", "title": "Outbound wire · $29,800", "description": "Account •• 4821 to account •• 9304."},
    {"id": "EV-TRX-71002", "time": "2026-10-13T09:17:52+00:00", "type": "transaction", "title": "Follow-on ACH · $27,450", "description": "Account •• 9304 to account •• 2190, 5m 38s later."},
    {"id": "EV-TRX-71003", "time": "2026-10-13T09:24:09+00:00", "type": "transaction", "title": "Merchant transfer · $27,400", "description": "Account •• 2190 to merchant •• 7712."},
    {"id": "ALT-8821", "time": "2026-10-13T09:28:00+00:00", "type": "alert", "title": "Velocity and shared-device alert raised", "description": "Rule set FI-4.2 · three reason codes."},
    {"id": "CASE-1042", "time": "2026-10-13T09:42:00+00:00", "type": "case", "title": "Investigation opened", "description": "Assigned to Maya Chen for human review."},
]

DEMO_TIMELINE_BY_CASE = {
    "CASE-1042": DEMO_TIMELINE,
    "CASE-1038": [
        {"id": "EV-LOC-ALT-1038", "time": "2026-10-13T08:13:00+00:00", "type": "signal", "title": "Unusual sign-in region observed", "description": "Observed region differs from recent account activity; travel context is unknown."},
        {"id": "EV-DEV-1038", "time": "2026-10-13T08:14:00+00:00", "type": "relationship", "title": "First-seen device sign-in", "description": "Device not observed in the prior 90-day activity window."},
        {"id": "EV-LOC-1038", "time": "2026-10-13T08:17:03+00:00", "type": "transaction", "title": "Cross-border wire · $32,100", "description": "Account •• 1036 to a newly observed counterparty."},
        {"id": "ALT-8814", "time": "2026-10-13T08:30:00+00:00", "type": "alert", "title": "Location and device alert raised", "description": "Synthetic detection rule set FI-4.2."},
    ],
    "CASE-1031": [
        {"id": "EV-REF-1031", "time": "2026-10-12T15:51:20+00:00", "type": "transaction", "title": "Refund activity above baseline", "description": "Refund velocity exceeded the synthetic merchant threshold."},
        {"id": "ALT-8799", "time": "2026-10-13T07:42:00+00:00", "type": "alert", "title": "Merchant refund alert raised", "description": "Synthetic merchant-monitoring alert."},
    ],
}
