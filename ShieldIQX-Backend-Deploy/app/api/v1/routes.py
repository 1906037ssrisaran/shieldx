from datetime import UTC, datetime
from io import BytesIO
from ipaddress import ip_address
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape
from slowapi import Limiter
from starlette.concurrency import run_in_threadpool

from app.core.audit import recent_audit_events, record_audit
from app.core.auth import (
    Principal,
    Role,
    create_session_cookie,
    get_principal,
    require_roles,
    revoke_session,
)
from app.core.config import Settings, get_settings
from app.services import store
from app.core.privacy import mask_sensitive_data
from app.services.gemini import generate
from app.services import warehouse
from app.services.detection import evaluate_case

router = APIRouter()


def _user_rate_key(request: Request) -> str:
    address = request.client.host if request.client else "unknown"
    try:
        address = str(ip_address(address))
    except ValueError:
        address = "unknown"
    principal = getattr(request.state, "shieldiq_principal", None)
    if principal:
        return f"{address}:{principal.tenant_id}:{principal.user_id}"
    return address


limiter = Limiter(key_func=_user_rate_key)
Authenticated = Annotated[Principal, Depends(get_principal)]
AnalystOrAdmin = Annotated[Principal, Depends(require_roles(Role.FRAUD_ANALYST, Role.ADMIN))]
Investigator = Annotated[
    Principal,
    Depends(require_roles(Role.FRAUD_ANALYST, Role.ADMIN, Role.COMPLIANCE_OFFICER)),
]
Compliance = Annotated[Principal, Depends(require_roles(Role.COMPLIANCE_OFFICER, Role.ADMIN))]
RiskRole = Annotated[Principal, Depends(require_roles(Role.RISK_MANAGER, Role.ADMIN))]


class SessionRequest(BaseModel):
    idToken: str = Field(min_length=40, max_length=10000)


class CaseCreate(BaseModel):
    title: str = Field(min_length=5, max_length=180)
    alertId: str | None = Field(default=None, max_length=80)


class CaseUpdate(BaseModel):
    status: Literal["open", "investigating", "under_review", "closed"] | None = None
    owner: str | None = Field(default=None, min_length=1, max_length=120)
    priority: Literal["low", "medium", "high", "critical"] | None = None
    expectedVersion: int = Field(ge=1)


class NoteCreate(BaseModel):
    body: str = Field(min_length=2, max_length=5000)


class CopilotRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    conversationId: str | None = Field(default=None, max_length=80)


class ReportCreate(BaseModel):
    reportType: str = Field(pattern="^(sar|investigation|executive|regulatory)$")


class ReviewRequest(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    comment: str = Field(min_length=2, max_length=1000)


class SimulationRequest(BaseModel):
    caseId: str = Field(min_length=3, max_length=80)
    horizonDays: int = Field(default=30, ge=1, le=365)
    unmitigatedAmountMinor: int = Field(default=8472500, ge=0, le=10_000_000_000)
    containmentRate: float = Field(default=0.65, ge=0, le=1)


class PolicyUpdate(BaseModel):
    alertThreshold: int = Field(ge=1, le=100)
    reviewRequired: Literal[True]
    expectedVersion: int = Field(ge=1)


class UserRoleUpdate(BaseModel):
    role: Role
    status: str = Field(pattern="^(active|suspended)$")


async def _audit(
    settings: Settings,
    principal: Principal,
    request: Request,
    action: str,
    resource_type: str,
    resource_id: str,
    **metadata: Any,
) -> None:
    await run_in_threadpool(
        record_audit,
        settings,
        principal,
        action,
        resource_type,
        resource_id,
        getattr(request.state, "request_id", "unknown"),
        metadata=metadata,
    )


def _case_or_404(settings: Settings, principal: Principal, case_id: str) -> dict[str, Any]:
    case = store.get_case(settings, principal, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _case_evidence(settings: Settings, principal: Principal, case_id: str) -> list[dict[str, Any]]:
    _case_or_404(settings, principal, case_id)
    if settings.demo_mode:
        evidence = store.DEMO_EVIDENCE_BY_CASE.get(case_id, [])
        return mask_sensitive_data(evidence)
    from app.services.store import _firestore_client

    snapshots = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("evidence")
        .limit(50)
        .stream()
    )
    allowed_fields = {"id", "type", "title", "observedAt", "source", "summary", "confidence"}
    evidence = []
    for snapshot in snapshots:
        row = snapshot.to_dict() or {}
        item = {key: row[key] for key in allowed_fields if key in row}
        item.setdefault("id", snapshot.id)
        evidence.append(item)
    return mask_sensitive_data(evidence)


def _agent_payload(case: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "case": {
            "id": case["id"],
            "title": case["title"],
            "riskScore": case.get("riskScore"),
            "reasonCodes": case.get("reasonCodes", []),
            "status": case.get("status"),
        },
        "evidence": evidence,
    }


def _require_evidence(evidence: list[dict[str, Any]]) -> None:
    if not evidence:
        raise HTTPException(status_code=422, detail="This investigation has no authorized evidence to analyze")


def _active_tenant_owner(settings: Settings, principal: Principal, owner: str) -> bool:
    if owner == "Unassigned":
        return True
    if settings.demo_mode:
        return owner in {
            "Maya Chen",
            "Jordan Lee",
            "Unassigned",
            "demo-analyst",
            "demo-compliance",
            "demo-risk",
            "demo-admin",
            "demo-fraud_analyst",
            "demo-compliance_officer",
            "demo-risk_manager",
        }
    from app.services.store import _firestore_client

    profile = (
        _firestore_client(settings)
        .collection("users")
        .document(owner)
        .get()
        .to_dict()
    )
    return bool(
        profile
        and profile.get("tenantId") == principal.tenant_id
        and profile.get("status") == "active"
    )


def _tenant_assignees(settings: Settings, principal: Principal) -> list[dict[str, str]]:
    if settings.demo_mode:
        return [
            {"id": "Maya Chen", "label": "Maya Chen"},
            {"id": "Jordan Lee", "label": "Jordan Lee"},
            {"id": "Unassigned", "label": "Unassigned"},
            {"id": "demo-fraud_analyst", "label": "Fraud analyst (demo)"},
            {"id": "demo-compliance_officer", "label": "Compliance officer (demo)"},
            {"id": "demo-risk_manager", "label": "Risk manager (demo)"},
            {"id": "demo-admin", "label": "Administrator (demo)"},
        ]
    from app.services.store import _firestore_client

    documents = (
        _firestore_client(settings)
        .collection("users")
        .where("tenantId", "==", principal.tenant_id)
        .limit(200)
        .stream()
    )
    assignees = []
    for document in documents:
        profile = document.to_dict() or {}
        if profile.get("status") != "active":
            continue
        label = profile.get("displayName") or profile.get("email") or document.id
        assignees.append({"id": document.id, "label": str(label)})
    return assignees + [{"id": "Unassigned", "label": "Unassigned"}]


def _tenant_risk_policy(settings: Settings, principal: Principal) -> dict[str, Any]:
    defaults = {"alertThreshold": 75, "reviewRequired": True, "version": 1}
    if settings.demo_mode:
        return defaults | {"editable": False}
    from app.services.store import _firestore_client

    snapshot = (
        _firestore_client(settings)
        .collection("tenants")
        .document(principal.tenant_id)
        .collection("settings")
        .document("riskPolicy")
        .get()
    )
    policy = defaults | (snapshot.to_dict() if snapshot.exists else {"editable": True})
    threshold = policy.get("alertThreshold")
    if type(threshold) is not int or not 1 <= threshold <= 100:
        raise HTTPException(status_code=503, detail="Tenant risk policy configuration is invalid")
    if policy.get("reviewRequired") is not True:
        raise HTTPException(status_code=503, detail="Tenant policy cannot disable required human review")
    return policy


def nodes_by_id(nodes: list[dict[str, Any]]) -> set[str]:
    return {node["id"] for node in nodes}


def _clusters(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    node_ids = {node["id"] for node in nodes}
    clusters = []
    for node in nodes:
        if node["type"] not in {"device", "ip", "phone", "email"}:
            continue
        linked = {
            edge["target"] if edge["source"] == node["id"] else edge["source"]
            for edge in edges
            if edge["source"] == node["id"] or edge["target"] == node["id"]
        } & node_ids
        if len(linked) >= 3:
            clusters.append(
                {
                    "id": f"cluster-{node['id']}",
                    "label": f"Shared {node['type']} cluster",
                    "nodeIds": sorted(linked | {node["id"]}),
                    "risk": "critical" if node.get("risk", 0) >= 85 else "high",
                }
            )
    return clusters


def _persist_report_artifact(
    settings: Settings,
    principal: Principal,
    report: dict[str, Any],
    format: str,
    content: bytes,
    content_type: str,
) -> None:
    if settings.demo_mode:
        return
    if not settings.gcs_evidence_bucket:
        raise HTTPException(status_code=503, detail="Cloud Storage report bucket is not configured")
    from google.cloud import storage

    object_name = (
        f"tenants/{principal.tenant_id}/cases/{report['caseId']}/reports/"
        f"{report['id']}/v{report['version']}.{format}"
    )
    blob = storage.Client(project=settings.google_cloud_project).bucket(
        settings.gcs_evidence_bucket
    ).blob(object_name)
    blob.metadata = {
        "caseId": report["caseId"],
        "reportId": report["id"],
        "reportVersion": str(report["version"]),
        "tenantId": principal.tenant_id,
    }
    from google.api_core.exceptions import PreconditionFailed

    try:
        blob.upload_from_string(content, content_type=content_type, if_generation_match=0)
    except PreconditionFailed:
        blob.reload()
        if blob.download_as_bytes() != content:
            raise HTTPException(status_code=409, detail="An immutable report artifact already exists with different content")


@router.get("/auth/me")
async def who_am_i(principal: Authenticated):
    return {
        "userId": principal.user_id,
        "tenantId": principal.tenant_id,
        "role": principal.role.value,
        "email": principal.email,
    }


@router.post("/auth/session", status_code=204)
async def establish_session(body: SessionRequest, response: Response, settings: Annotated[Settings, Depends(get_settings)]):
    if settings.demo_mode:
        raise HTTPException(status_code=404, detail="Firebase session exchange is disabled in demo mode")
    from app.core.auth import _principal_from_verified_token

    await run_in_threadpool(_principal_from_verified_token, body.idToken, settings)
    cookie = await run_in_threadpool(create_session_cookie, body.idToken, settings)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=cookie,
        max_age=settings.session_cookie_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.environment != "local",
        samesite="strict",
        path="/",
    )


@router.delete("/auth/session", status_code=204)
async def end_session(request: Request, response: Response, settings: Annotated[Settings, Depends(get_settings)]):
    session_token = request.cookies.get(settings.session_cookie_name)
    if session_token and not settings.demo_mode:
        await run_in_threadpool(revoke_session, session_token, settings)
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.environment != "local",
        samesite="strict",
        path="/",
    )


@router.get("/dashboard/summary")
async def dashboard_summary(
    request: Request,
    principal: Authenticated,
    settings: Annotated[Settings, Depends(get_settings)],
):
    cases = await run_in_threadpool(store.list_cases, settings, principal)
    metrics = None if settings.demo_mode else await warehouse.dashboard_metrics(settings, principal)
    alerts = store.DEMO_ALERTS if settings.demo_mode else await warehouse.list_alerts(settings, principal, 100)
    exposure_minor = sum(case["amountMinor"] for case in cases if case["status"] != "closed")
    await _audit(settings, principal, request, "dashboard.read", "dashboard", "executive")
    return {
        "asOf": datetime.now(UTC).isoformat(),
        "window": "Last 24 hours",
        "freshness": "Synthetic demo data" if settings.demo_mode else "Live case data",
        "fraudExposureMinor": exposure_minor if settings.demo_mode else metrics["fraudExposureMinor"],
        "moneySavedMinor": 21847500 if settings.demo_mode else metrics["moneySavedMinor"],
        "activeCases": sum(case["status"] != "closed" for case in cases),
        "criticalAlerts": sum(alert["severity"] == "critical" for alert in alerts) if settings.demo_mode else metrics["criticalAlerts"],
        "precisionPercent": 91.8 if settings.demo_mode else None,
        "medianInvestigationMinutes": 18 if settings.demo_mode else None,
        "trend": [
            {"date": "Oct 07", "exposure": 44000, "prevented": 21000},
            {"date": "Oct 08", "exposure": 52000, "prevented": 34000},
            {"date": "Oct 09", "exposure": 39000, "prevented": 28500},
            {"date": "Oct 10", "exposure": 67000, "prevented": 49000},
            {"date": "Oct 11", "exposure": 58000, "prevented": 42000},
            {"date": "Oct 12", "exposure": 81000, "prevented": 59000},
            {"date": "Oct 13", "exposure": 73000, "prevented": 63000},
        ] if settings.demo_mode else metrics["trend"],
        "heatmap": [
            {"region": "North America", "count": 42, "risk": "high"},
            {"region": "Western Europe", "count": 27, "risk": "elevated"},
            {"region": "APAC", "count": 19, "risk": "moderate"},
            {"region": "LATAM", "count": 14, "risk": "elevated"},
        ] if settings.demo_mode else metrics["heatmap"],
        "recommendation": (
            "Review the shared-device cluster in CASE-1042; three accounts share device DVC-4408."
            if settings.demo_mode
            else "No AI recommendation is available until evidence retrieval is configured."
        ),
        "recommendationCaseId": "CASE-1042" if settings.demo_mode else None,
    }


@router.get("/alerts")
async def list_alerts(
    principal: Authenticated,
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = 25,
):
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 100")
    items = store.DEMO_ALERTS[:limit] if settings.demo_mode else await warehouse.list_alerts(settings, principal, limit)
    return {"items": items, "nextPageToken": None}


@router.get("/cases")
async def cases(
    principal: Authenticated,
    settings: Annotated[Settings, Depends(get_settings)],
):
    return {"items": await run_in_threadpool(store.list_cases, settings, principal)}


@router.get("/users/assignees")
async def list_assignees(
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    items = await run_in_threadpool(_tenant_assignees, settings, principal)
    await _audit(settings, principal, request, "case.assignees.read", "tenant_users", principal.tenant_id, userCount=len(items))
    return {"items": items}


@router.post("/cases", status_code=201)
async def create_case(
    body: CaseCreate,
    request: Request,
    principal: AnalystOrAdmin,
    settings: Annotated[Settings, Depends(get_settings)],
):
    if body.alertId and settings.demo_mode and not any(alert["id"] == body.alertId for alert in store.DEMO_ALERTS):
        raise HTTPException(status_code=404, detail="Alert not found")
    if body.alertId and not settings.demo_mode and not await warehouse.alert_belongs_to_tenant(
        settings,
        principal,
        body.alertId,
    ):
        raise HTTPException(status_code=404, detail="Alert not found")
    case = await run_in_threadpool(
        store.create_case,
        settings,
        principal,
        mask_sensitive_data(body.title),
        body.alertId,
    )
    await _audit(settings, principal, request, "case.create", "case", case["id"])
    return case


@router.get("/cases/{case_id}")
async def case_detail(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    notes = await run_in_threadpool(store.list_notes, settings, principal, case_id)
    if settings.demo_mode:
        transactions = [
            transaction for transaction in store.DEMO_TRANSACTIONS
            if transaction["caseId"] == case_id
        ]
    else:
        transactions = await warehouse.list_transactions(settings, principal, case_id)
    timeline = await run_in_threadpool(store.case_events, settings, principal, case_id)
    await _audit(settings, principal, request, "case.read", "case", case_id)
    return {
        "case": mask_sensitive_data(case),
        "evidence": evidence,
        "notes": mask_sensitive_data(notes),
        "transactions": mask_sensitive_data(transactions),
        "timeline": mask_sensitive_data(timeline),
    }


@router.patch("/cases/{case_id}")
async def update_case(
    case_id: str,
    body: CaseUpdate,
    request: Request,
    principal: AnalystOrAdmin,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    if body.expectedVersion != case.get("version"):
        raise HTTPException(status_code=409, detail="Case changed since it was loaded; refresh and retry")
    changes = body.model_dump(exclude={"expectedVersion"}, exclude_none=True)
    if changes.get("owner") and not await run_in_threadpool(
        _active_tenant_owner,
        settings,
        principal,
        changes["owner"].strip(),
    ):
        raise HTTPException(status_code=422, detail="Owner must identify an active user in this tenant")
    if "owner" in changes:
        changes["owner"] = changes["owner"].strip()
    try:
        updated = await run_in_threadpool(store.update_case, settings, principal, case, changes)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    await _audit(settings, principal, request, "case.update", "case", case_id, changedFields=list(changes))
    return mask_sensitive_data(updated)


@router.post("/cases/{case_id}/notes", status_code=201)
async def add_case_note(
    case_id: str,
    body: NoteCreate,
    request: Request,
    principal: AnalystOrAdmin,
    settings: Annotated[Settings, Depends(get_settings)],
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    note = await run_in_threadpool(
        store.add_note,
        settings,
        principal,
        case_id,
        mask_sensitive_data(body.body),
    )
    await _audit(settings, principal, request, "case.note.create", "case", case_id, noteId=note["id"])
    return mask_sensitive_data(note)


@router.get("/cases/{case_id}/graph")
async def case_graph(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
    query: str = Query(default="", max_length=100),
    entity_type: str | None = None,
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    nodes, edges = await run_in_threadpool(store.case_graph, settings, principal, case_id)
    if entity_type:
        matching = {node["id"] for node in nodes if node["type"] == entity_type}
        connected = {
            node_id
            for edge in edges
            if edge["source"] in matching or edge["target"] in matching
            for node_id in (edge["source"], edge["target"])
        }
        nodes = [node for node in nodes if node["id"] in matching | connected]
        edges = [edge for edge in edges if edge["source"] in connected and edge["target"] in connected]
    if query:
        matches = {node["id"] for node in nodes if query.lower() in node["label"].lower()}
        connected = {
            node_id
            for edge in edges
            if edge["source"] in matches or edge["target"] in matches
            for node_id in (edge["source"], edge["target"])
        }
        nodes = [node for node in nodes if node["id"] in matches | connected]
        selected_ids = nodes_by_id(nodes)
        edges = [edge for edge in edges if edge["source"] in selected_ids and edge["target"] in selected_ids]
    clusters = _clusters(nodes, edges)
    await _audit(settings, principal, request, "graph.read", "case", case_id, nodeCount=len(nodes))
    return {"nodes": nodes[:100], "edges": edges[:200], "clusters": clusters}


@router.get("/cases/{case_id}/transactions")
async def case_transactions(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    transactions = (
        [transaction for transaction in store.DEMO_TRANSACTIONS if transaction["caseId"] == case_id]
        if settings.demo_mode
        else await warehouse.list_transactions(settings, principal, case_id)
    )
    await _audit(settings, principal, request, "case.transactions.read", "case", case_id, transactionCount=len(transactions))
    return {"items": mask_sensitive_data(transactions)}


@router.post("/cases/{case_id}/detections/evaluate")
async def evaluate_fraud_risk(
    case_id: str,
    request: Request,
    principal: AnalystOrAdmin,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    if not evidence:
        raise HTTPException(status_code=422, detail="Risk evaluation requires authorized case evidence")
    policy = await run_in_threadpool(_tenant_risk_policy, settings, principal)
    result = evaluate_case(case, evidence, policy["alertThreshold"])
    await _audit(settings, principal, request, "detection.evaluate", "case", case_id, ruleVersion=result["ruleVersion"], score=result["score"])
    return result


@router.post("/cases/{case_id}/agents/explain")
@limiter.limit("10/minute")
async def explain_case(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    _require_evidence(evidence)
    run_id = str(uuid4())
    result = await generate(
        settings,
        "Explain the risk factors and separate observed facts from inferences.",
        _agent_payload(case, evidence),
        run_id,
    )
    await _audit(settings, principal, request, "ai.explain", "case", case_id, runId=run_id, evidenceCount=len(evidence))
    return {"agent": "explainability", "runId": run_id, "model": settings.gemini_model, **result.model_dump(), "reviewStatus": "unreviewed"}


@router.post("/cases/{case_id}/agents/brief")
@limiter.limit("10/minute")
async def case_brief(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    _require_evidence(evidence)
    run_id = str(uuid4())
    result = await generate(
        settings,
        "Write an investigator briefing grounded in the case evidence.",
        _agent_payload(case, evidence),
        run_id,
    )
    await _audit(settings, principal, request, "ai.brief", "case", case_id, runId=run_id)
    return {"agent": "investigator-briefing", "runId": run_id, "model": settings.gemini_model, **result.model_dump(), "reviewStatus": "unreviewed"}


@router.get("/cases/{case_id}/copilot/messages")
async def copilot_history(
    case_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    messages = await run_in_threadpool(store.list_messages, settings, principal, case_id)
    await _audit(settings, principal, request, "copilot.history.read", "case", case_id, messageCount=len(messages))
    return {"items": mask_sensitive_data(messages)}


@router.post("/cases/{case_id}/copilot/messages")
@limiter.limit("10/minute")
async def copilot_message(
    case_id: str,
    body: CopilotRequest,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    _require_evidence(evidence)
    safe_question = mask_sensitive_data(body.question)
    payload = _agent_payload(case, evidence) | {"question": safe_question}
    conversation_id = body.conversationId or str(uuid4())
    history = await run_in_threadpool(store.list_messages, settings, principal, case_id)
    payload["conversationContext"] = [
        {"role": item["role"], "content": item["content"]}
        for item in history
        if item.get("conversationId") == conversation_id
    ][-12:]
    run_id = str(uuid4())
    result = await generate(
        settings,
        "Answer the investigator's case-scoped question and suggest evidence-led next steps.",
        payload,
        run_id,
    )
    now = datetime.now(UTC).isoformat()
    await run_in_threadpool(store.append_message, settings, principal, case_id, {"id": str(uuid4()), "conversationId": conversation_id, "role": "user", "content": safe_question, "createdAt": now})
    await run_in_threadpool(store.append_message, settings, principal, case_id, {"id": run_id, "conversationId": conversation_id, "role": "assistant", "content": result.answer, "claims": [claim.model_dump() for claim in result.claims], "uncertainties": result.uncertainties, "recommendedActions": result.recommendedActions, "model": settings.gemini_model, "createdAt": datetime.now(UTC).isoformat()})
    await _audit(settings, principal, request, "ai.copilot", "case", case_id, runId=run_id, conversationId=conversation_id)
    return {"conversationId": conversation_id, "runId": run_id, **result.model_dump(), "reviewStatus": "unreviewed"}


@router.post("/cases/{case_id}/reports", status_code=201)
@limiter.limit("5/minute")
async def create_report(
    case_id: str,
    body: ReportCreate,
    request: Request,
    principal: Annotated[Principal, Depends(require_roles(Role.COMPLIANCE_OFFICER, Role.ADMIN, Role.FRAUD_ANALYST))],
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, case_id)
    evidence = await run_in_threadpool(_case_evidence, settings, principal, case_id)
    _require_evidence(evidence)
    timeline = await run_in_threadpool(store.case_events, settings, principal, case_id)
    run_id = str(uuid4())
    generated = await generate(
        settings,
        f"Draft a {body.reportType} investigation report. Identify unknown fields; do not invent facts.",
        _agent_payload(case, evidence),
        run_id,
    )
    safe_evidence = mask_sensitive_data(
        [
            {
                "id": item.get("id"),
                "title": item.get("title"),
                "observedAt": item.get("observedAt"),
                "source": item.get("source"),
                "summary": item.get("summary"),
                "confidence": item.get("confidence"),
            }
            for item in evidence
        ]
    )
    safe_timeline = mask_sensitive_data(timeline)
    report = {
        "id": f"RPT-{uuid4().hex[:10].upper()}",
        "tenantId": principal.tenant_id,
        "caseId": case_id,
        "reportType": body.reportType,
        "aiRunId": run_id,
        "version": 1,
        "status": "draft",
        "createdBy": principal.user_id,
        "createdAt": datetime.now(UTC).isoformat(),
        "reviewedBy": None,
        "reviewComment": None,
        "content": generated.model_dump(),
        "evidenceRefs": sorted({reference for claim in generated.claims for reference in claim.evidenceRefs}),
        "evidence": safe_evidence,
        "timeline": safe_timeline,
        "reasonCodes": case.get("reasonCodes", []),
        "recommendations": generated.recommendedActions,
        "uncertainties": generated.uncertainties,
    }
    await run_in_threadpool(store.save_report, settings, principal, report)
    await _audit(settings, principal, request, "report.create", "report", report["id"], reportType=body.reportType, aiRunId=run_id)
    return report


@router.get("/cases/{case_id}/reports/{report_id}/versions")
async def report_versions(
    case_id: str,
    report_id: str,
    request: Request,
    principal: Investigator,
    settings: Annotated[Settings, Depends(get_settings)],
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    report = await run_in_threadpool(store.get_report, settings, principal, case_id, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if settings.demo_mode:
        versions = [
            item
            for (stored_id, _), item in store._local_report_versions.items()
            if stored_id == report_id
        ]
        items = sorted(versions, key=lambda item: item["version"])
        await _audit(settings, principal, request, "report.versions.read", "report", report_id, versionCount=len(items))
        return {"items": items}
    from app.services.store import _firestore_client

    snapshots = (
        _firestore_client(settings)
        .collection("cases")
        .document(case_id)
        .collection("reports")
        .document(report_id)
        .collection("versions")
        .order_by("version")
        .limit(50)
        .stream()
    )
    items = [snapshot.to_dict() or {} for snapshot in snapshots]
    await _audit(settings, principal, request, "report.versions.read", "report", report_id, versionCount=len(items))
    return {"items": items}


@router.post("/cases/{case_id}/reports/{report_id}/review")
async def review_report(
    case_id: str,
    report_id: str,
    body: ReviewRequest,
    request: Request,
    principal: Compliance,
    settings: Annotated[Settings, Depends(get_settings)],
):
    await run_in_threadpool(_case_or_404, settings, principal, case_id)
    report = await run_in_threadpool(store.get_report, settings, principal, case_id, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only draft reports can be reviewed")
    if report.get("createdBy") == principal.user_id:
        raise HTTPException(status_code=409, detail="A report draft must be reviewed by a different user")
    report |= {
        "status": body.decision,
        "reviewedBy": principal.user_id,
        "reviewedAt": datetime.now(UTC).isoformat(),
        "reviewComment": mask_sensitive_data(body.comment),
        "version": report["version"] + 1,
    }
    await run_in_threadpool(store.save_report, settings, principal, report)
    await _audit(settings, principal, request, f"report.{body.decision}", "report", report_id)
    return report


@router.get("/cases/{case_id}/reports/{report_id}/export")
async def export_report(
    case_id: str,
    report_id: str,
    request: Request,
    principal: Compliance,
    settings: Annotated[Settings, Depends(get_settings)],
    format: str = "json",
):
    report = await run_in_threadpool(store.get_report, settings, principal, case_id, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report["status"] != "approved":
        raise HTTPException(status_code=409, detail="Report must be approved before export")
    await _audit(settings, principal, request, "report.export.request", "report", report_id, format=format)
    if format == "json":
        import json

        serialized = json.dumps(report, indent=2).encode("utf-8")
        await run_in_threadpool(_persist_report_artifact, settings, principal, report, format, serialized, "application/json")
        await _audit(settings, principal, request, "report.export", "report", report_id, format=format)
        return Response(content=serialized, media_type="application/json")
    if format == "html":
        document = _report_html(report)
        await run_in_threadpool(_persist_report_artifact, settings, principal, report, format, document.encode("utf-8"), "text/html")
        await _audit(settings, principal, request, "report.export", "report", report_id, format=format)
        return Response(content=document, media_type="text/html")
    if format == "pdf":
        buffer = BytesIO()
        _build_report_pdf(report, buffer)
        buffer.seek(0)
        pdf_content = buffer.getvalue()
        await run_in_threadpool(_persist_report_artifact, settings, principal, report, format, pdf_content, "application/pdf")
        await _audit(settings, principal, request, "report.export", "report", report_id, format=format)
        buffer.seek(0)
        return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'})
    raise HTTPException(status_code=422, detail="format must be json, html, or pdf")


def _report_html(report: dict[str, Any]) -> str:
    import html

    section = lambda title, body: f"<section><h2>{title}</h2>{body}</section>"
    evidence_rows = "".join(
        f"<li><strong>{html.escape(str(item.get('title') or item.get('id') or 'Evidence'))}</strong> "
        f"<span>{html.escape(str(item.get('observedAt') or ''))} · {html.escape(str(item.get('source') or ''))}</span>"
        f"<p>{html.escape(str(item.get('summary') or ''))}</p></li>"
        for item in report.get("evidence", [])
    )
    timeline_rows = "".join(
        f"<li><time>{html.escape(str(item.get('time') or ''))}</time> "
        f"<strong>{html.escape(str(item.get('title') or 'Event'))}</strong>"
        f"<p>{html.escape(str(item.get('description') or ''))}</p></li>"
        for item in report.get("timeline", [])
    )
    reasoning_rows = "".join(
        f"<li><p>{html.escape(str(item.get('text') or ''))}</p>"
        f"<small>{html.escape(str(item.get('classification') or ''))} · "
        f"evidence: {html.escape(', '.join(item.get('evidenceRefs', [])))}</small></li>"
        for item in report["content"].get("claims", [])
    )
    actions = "".join(f"<li>{html.escape(str(item))}</li>" for item in report.get("recommendations", []))
    uncertainties = "".join(f"<li>{html.escape(str(item))}</li>" for item in report.get("uncertainties", []))
    narrative = html.escape(str(report["content"].get("answer", "")))
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>ShieldIQ {html.escape(report['reportType'].upper())}</title>"
        "<style>body{font:15px/1.6 Arial,sans-serif;max-width:900px;margin:40px auto;color:#162033}"
        "h1{color:#075bd8}h2{margin-top:30px;border-bottom:1px solid #d8e0ec;padding-bottom:6px}"
        "li{margin:12px 0}small,time,span{color:#53647c}pre{white-space:pre-wrap}</style>"
        f"</head><body><h1>{html.escape(report['reportType'].upper())} · {html.escape(report['caseId'])}</h1>"
        "<p>Approved draft · Human review remains required before regulatory submission.</p>"
        f"<h2>Investigation narrative</h2><p>{narrative}</p>"
        f"{section('Reasoning and cited claims', f'<ul>{reasoning_rows}</ul>')}"
        f"{section('Evidence', f'<ul>{evidence_rows}</ul>')}"
        f"{section('Timeline', f'<ol>{timeline_rows}</ol>')}"
        f"{section('Recommendations', f'<ul>{actions}</ul>')}"
        f"{section('Unknowns and limitations', f'<ul>{uncertainties}</ul>')}"
        f"<p>Evidence references: {html.escape(', '.join(report.get('evidenceRefs', [])))}</p>"
        "</body></html>"
    )


def _build_report_pdf(report: dict[str, Any], buffer: BytesIO) -> None:
    styles = getSampleStyleSheet()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=50,
        leftMargin=50,
        topMargin=48,
        bottomMargin=48,
        title=f"ShieldIQ {report['reportType']} {report['caseId']}",
    )

    def paragraph(value: Any, style="BodyText") -> Paragraph:
        safe = str(value).encode("latin-1", errors="replace").decode("latin-1")
        return Paragraph(escape(safe).replace("\n", "<br/>"), styles[style])

    story = [
        paragraph(f"{report['reportType'].upper()} · {report['caseId']}", "Title"),
        paragraph("Approved draft · Human review required before regulatory submission."),
        Spacer(1, 12),
        paragraph("Investigation narrative", "Heading2"),
        paragraph(report["content"].get("answer", "")),
        paragraph("Reasoning and cited claims", "Heading2"),
    ]
    for claim in report["content"].get("claims", []):
        story.append(paragraph(claim.get("text", "")))
        story.append(paragraph(f"{claim.get('classification', '')} · {', '.join(claim.get('evidenceRefs', []))},", "Italic"))
        story.append(Spacer(1, 4))
    story.append(paragraph("Evidence", "Heading2"))
    for item in report.get("evidence", []):
        story.extend(
            [
                paragraph(item.get("title") or item.get("id") or "Evidence", "Heading3"),
                paragraph(f"{item.get('observedAt', '')} · {item.get('source', '')}", "Italic"),
                paragraph(item.get("summary", "")),
                Spacer(1, 5),
            ]
        )
    story.append(paragraph("Timeline", "Heading2"))
    timeline_data = [[paragraph("Time", "Heading3"), paragraph("Event", "Heading3"), paragraph("Details", "Heading3")]]
    for item in report.get("timeline", []):
        timeline_data.append(
            [
                paragraph(item.get("time", "")),
                paragraph(item.get("title", "")),
                paragraph(item.get("description", "")),
            ]
        )
    if len(timeline_data) > 1:
        table = Table(timeline_data, repeatRows=1, colWidths=[100, 145, 220])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EFF8")),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CAD4E2")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(table)
    story.append(paragraph("Recommendations", "Heading2"))
    story.extend(paragraph(f"• {item}") for item in report.get("recommendations", []))
    story.append(paragraph("Unknowns and limitations", "Heading2"))
    story.extend(paragraph(f"• {item}") for item in report.get("uncertainties", []))
    story.append(paragraph(f"Evidence references: {', '.join(report.get('evidenceRefs', []))}", "Italic"))
    document.build(story)


@router.post("/simulations")
async def simulate_risk(
    body: SimulationRequest,
    request: Request,
    principal: RiskRole,
    settings: Annotated[Settings, Depends(get_settings)],
):
    case = await run_in_threadpool(_case_or_404, settings, principal, body.caseId)
    if settings.demo_mode:
        graph_nodes, graph_edges = store.DEMO_NODES, store.DEMO_EDGES
    else:
        graph_nodes, graph_edges = await run_in_threadpool(
            store.case_graph,
            settings,
            principal,
            body.caseId,
        )
    linked_accounts = sum(1 for node in graph_nodes if node.get("type") == "account")
    current_accounts = max(linked_accounts, 1)
    base_probability = min(
        0.92,
        0.18
        + (case.get("riskScore", 0) / 100) * 0.55
        + max(linked_accounts - 2, 0) * 0.025,
    )
    horizon_factor = min(3.0, body.horizonDays / 30)
    probability = round(min(0.92, base_probability * horizon_factor), 3)
    expected_loss = round(body.unmitigatedAmountMinor * probability * (1 - body.containmentRate))
    projected_new_accounts = round(current_accounts * probability * (1 - body.containmentRate))
    output = {
        "runId": str(uuid4()),
        "caseId": body.caseId,
        "model": "transparent-scenario-v1",
        "horizonDays": body.horizonDays,
        "fraudExpansionProbability": probability,
        "expectedLossMinor": expected_loss,
        "currency": case.get("currency", "USD"),
        "affectedAccounts": current_accounts + projected_new_accounts,
        "currentlyLinkedAccounts": linked_accounts,
        "networkEvidence": {
            "accountNodes": linked_accounts,
            "relationshipEdges": len(graph_edges),
            "source": "case relationship graph",
        },
        "recommendedAction": "Prioritize human review of linked accounts and validate beneficiary ownership.",
        "assumptions": [
            f"Unmitigated amount: {body.unmitigatedAmountMinor} minor units",
            f"Containment effectiveness assumed: {body.containmentRate:.0%}",
            f"Horizon multiplier: min(3, {body.horizonDays}/30)",
            f"Network growth: current accounts + rounded(account count × expansion signal × (1 − containment)); {len(graph_edges)} linked edges observed.",
            "Scenario heuristic uses case score and linked graph context; it is not a calibrated predictive model.",
        ],
        "uncertainty": "Illustrative scenario only; not a loss forecast or payment decision.",
        "createdAt": datetime.now(UTC).isoformat(),
    }
    if settings.google_cloud_project:
        evidence = await run_in_threadpool(_case_evidence, settings, principal, body.caseId)
        _require_evidence(evidence)
        run_id = output["runId"]
        assessment = await generate(
            settings,
            "Interpret the supplied forward-looking fraud scenario. Explain plausible pathways and mitigations, "
            "distinguish scenario assumptions from observed facts, do not change or invent the numeric outputs, "
            "and clearly state that this is not a calibrated forecast.",
            {
                "case": case,
                "evidence": evidence,
                "relationshipGraph": {"nodes": graph_nodes, "edges": graph_edges},
                "scenario": output,
            },
            run_id,
        )
        output["aiAssessment"] = assessment.model_dump()
        output["aiAssessmentStatus"] = "generated"
    else:
        output["aiAssessment"] = None
        output["aiAssessmentStatus"] = "not_configured"
    await _audit(settings, principal, request, "simulation.run", "case", body.caseId, runId=output["runId"], horizonDays=body.horizonDays)
    return output


@router.get("/admin/audit")
async def audit_status(
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
):
    return {"status": "Audit events are written as structured Cloud Logging entries and Firestore auditEvents documents."}


@router.get("/admin/audit/events")
async def audit_events(
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = 50,
):
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 200")
    return {"items": await run_in_threadpool(recent_audit_events, settings, principal, limit)}


@router.get("/admin/policy")
async def get_policy(
    request: Request,
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
    settings: Annotated[Settings, Depends(get_settings)],
):
    policy = await run_in_threadpool(_tenant_risk_policy, settings, principal)
    await _audit(settings, principal, request, "admin.policy.read", "tenant_policy", principal.tenant_id)
    return policy


@router.patch("/admin/policy")
async def update_policy(
    body: PolicyUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
    settings: Annotated[Settings, Depends(get_settings)],
):
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="Demo policy controls are read-only")
    from firebase_admin import firestore
    from app.services.store import _firestore_client

    client = await run_in_threadpool(_firestore_client, settings)
    reference = client.collection("tenants").document(principal.tenant_id).collection("settings").document("riskPolicy")
    transaction = client.transaction()

    @firestore.transactional
    def update_policy(transaction):
        snapshot = reference.get(transaction=transaction)
        current = snapshot.to_dict() if snapshot.exists else {
            "alertThreshold": 75,
            "reviewRequired": True,
            "version": 1,
        }
        if current.get("version", 1) != body.expectedVersion:
            raise ValueError("Policy changed since it was loaded")
        policy = body.model_dump(exclude={"expectedVersion"}) | {
            "version": body.expectedVersion + 1,
            "updatedAt": datetime.now(UTC).isoformat(),
            "updatedBy": principal.user_id,
        }
        transaction.set(reference, policy)
        return policy

    try:
        policy = await run_in_threadpool(update_policy, transaction)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await _audit(settings, principal, request, "admin.policy.update", "tenant_policy", principal.tenant_id, alertThreshold=body.alertThreshold)
    return policy | {"editable": True}


@router.get("/admin/users")
async def list_tenant_users(
    request: Request,
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
    settings: Annotated[Settings, Depends(get_settings)],
):
    if settings.demo_mode:
        items = [
            {"id": "demo-analyst", "email": "maya.chen@northstar.demo", "role": "fraud_analyst", "status": "active"},
            {"id": "demo-compliance", "email": "jordan.lee@northstar.demo", "role": "compliance_officer", "status": "active"},
            {"id": "demo-risk", "email": "risk.team@northstar.demo", "role": "risk_manager", "status": "active"},
        ]
    else:
        from app.services.store import _firestore_client

        def fetch_users():
            return list(
                _firestore_client(settings)
                .collection("users")
                .where("tenantId", "==", principal.tenant_id)
                .limit(200)
                .stream()
            )

        documents = await run_in_threadpool(fetch_users)
        items = []
        for document in documents:
            row = document.to_dict() or {}
            items.append({"id": document.id, "email": row.get("email"), "role": row.get("role"), "status": row.get("status")})
    await _audit(settings, principal, request, "admin.users.read", "tenant_users", principal.tenant_id, userCount=len(items))
    return {"items": items}


@router.patch("/admin/users/{user_id}")
async def update_tenant_user(
    user_id: str,
    body: UserRoleUpdate,
    request: Request,
    principal: Annotated[Principal, Depends(require_roles(Role.ADMIN))],
    settings: Annotated[Settings, Depends(get_settings)],
):
    if user_id == principal.user_id:
        raise HTTPException(status_code=409, detail="Administrators cannot modify their own account")
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="Demo user management is read-only")
    from app.services.store import _firestore_client

    reference = _firestore_client(settings).collection("users").document(user_id)
    snapshot = await run_in_threadpool(reference.get)
    if not snapshot.exists or (snapshot.to_dict() or {}).get("tenantId") != principal.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    await run_in_threadpool(
        reference.update,
        {
            "role": body.role.value,
            "status": body.status,
            "updatedAt": datetime.now(UTC).isoformat(),
            "updatedBy": principal.user_id,
        },
    )
    await _audit(settings, principal, request, "admin.user.update", "user", user_id, role=body.role.value, status=body.status)
    return {"id": user_id, "role": body.role.value, "status": body.status}
