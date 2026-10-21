from fastapi.testclient import TestClient
from types import SimpleNamespace

import pytest

import app.core.auth as auth
from app.api.v1.routes import get_settings
from app.core.auth import Principal, Role
from app.core.privacy import mask_sensitive_text
from app.main import app
from app.services import store
from app.services.detection import evaluate_case
from app.services.gemini import AgentOutput, Claim, validate_citations

client = TestClient(app)


def test_case_update_requires_current_version() -> None:
    store._local_cases.clear()

    response = client.patch(
        "/api/v1/cases/CASE-1042",
        headers={"X-Demo-Role": "fraud_analyst"},
        json={"status": "under_review", "expectedVersion": 3},
    )
    assert response.status_code == 200
    assert response.json()["version"] == 4

    stale = client.patch(
        "/api/v1/cases/CASE-1042",
        headers={"X-Demo-Role": "fraud_analyst"},
        json={"status": "closed", "expectedVersion": 3},
    )
    assert stale.status_code == 409


def test_analyst_cannot_access_admin_policy() -> None:
    response = client.get(
        "/api/v1/admin/policy",
        headers={"X-Demo-Role": "fraud_analyst"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_risk_manager_can_run_bounded_simulation() -> None:
    response = client.post(
        "/api/v1/simulations",
        headers={"X-Demo-Role": "risk_manager"},
        json={
            "caseId": "CASE-1042",
            "horizonDays": 30,
            "unmitigatedAmountMinor": 8472500,
            "containmentRate": 0.65,
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert 0 <= result["fraudExpansionProbability"] <= 1
    assert result["expectedLossMinor"] > 0
    assert "not a loss forecast" in result["uncertainty"]
    assert result["assumptions"]
    assert result["aiAssessmentStatus"] == "not_configured"
    assert result["aiAssessment"] is None


def test_detection_score_only_uses_evidence_linked_signals() -> None:
    case = {
        "reasonCodes": [
            "VELOCITY_SPIKE",
            "SHARED_DEVICE",
            "NEW_BENEFICIARY",
            "LOCATION_ANOMALY",
            "UNRECOGNIZED_SIGNAL",
        ]
    }
    evidence = [
        {"id": "EV-TXN", "type": "transaction", "summary": "Rapid transfer"},
        {"id": "EV-DEVICE", "type": "device", "summary": "Device shared across accounts"},
        {"id": "EV-BEN", "type": "beneficiary", "summary": "First transfer to beneficiary"},
    ]

    result = evaluate_case(case, evidence)

    assert result["score"] == 87
    assert len(result["factors"]) == 3
    assert result["unsupportedSignals"] == ["LOCATION_ANOMALY"]
    assert result["unmappedSignals"] == ["UNRECOGNIZED_SIGNAL"]
    assert all(factor["evidenceRefs"] for factor in result["factors"])
    assert not evaluate_case(case, evidence, alert_threshold=90)["thresholdTriggered"]
    assert result["thresholdTriggered"]
    assert "prioritization only" in result["decisionBoundary"]


def test_detection_endpoint_returns_auditable_reasoning() -> None:
    headers = {"X-Demo-Role": "fraud_analyst"}
    response = client.post("/api/v1/cases/CASE-1042/detections/evaluate", headers=headers)

    assert response.status_code == 200
    result = response.json()
    assert result["score"] == 87
    assert result["ruleVersion"] == "shieldiq-fraud-rules-v1"
    assert "EV-DEV-4408" in {
        reference for factor in result["factors"] for reference in factor["evidenceRefs"]
    }
    case = client.get("/api/v1/cases/CASE-1042", headers=headers).json()["case"]
    alert = next(
        item
        for item in client.get("/api/v1/alerts", headers=headers).json()["items"]
        if item["id"] == case["alertId"]
    )
    assert case["riskScore"] == result["score"]
    assert alert["score"] == result["score"]


def test_empty_case_is_readable_but_not_scored_without_evidence() -> None:
    headers = {"X-Demo-Role": "fraud_analyst"}
    created = client.post(
        "/api/v1/cases",
        headers=headers,
        json={"title": "Evidence-free intake case"},
    )
    assert created.status_code == 201
    case_id = created.json()["id"]

    detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
    evaluation = client.post(
        f"/api/v1/cases/{case_id}/detections/evaluate",
        headers=headers,
    )

    assert detail.status_code == 200
    assert detail.json()["evidence"] == []
    assert evaluation.status_code == 422


def test_case_assignment_rejects_unknown_tenant_users() -> None:
    headers = {"X-Demo-Role": "fraud_analyst"}
    detail = client.get("/api/v1/cases/CASE-1042", headers=headers)
    case = detail.json()["case"]

    response = client.patch(
        "/api/v1/cases/CASE-1042",
        headers=headers,
        json={"owner": "someone outside the tenant", "expectedVersion": case["version"]},
    )

    assert response.status_code == 422
    assert "active user in this tenant" in response.json()["error"]["message"]


def test_generated_claims_cannot_cite_unretrieved_evidence() -> None:
    result = AgentOutput(
        answer="A transfer was observed.",
        claims=[
            Claim(
                text="A transfer was observed.",
                evidenceRefs=["EV-UNAUTHORIZED"],
                classification="observed_fact",
            )
        ],
        uncertainties=[],
        recommendedActions=[],
    )

    with pytest.raises(ValueError, match="outside the authorized evidence set"):
        validate_citations(result, {"evidence": [{"id": "EV-AUTHORIZED"}]})


def test_sensitive_identifiers_are_redacted_from_stored_text() -> None:
    masked = mask_sensitive_text(
        "Contact analyst@example.com about account 1234-5678-9012."
    )

    assert "analyst@example.com" not in masked
    assert "1234-5678-9012" not in masked
    assert "***@" in masked
    assert "[MASKED_IDENTIFIER]" in masked


def test_relationship_type_filter_keeps_connected_context() -> None:
    response = client.get(
        "/api/v1/cases/CASE-1042/graph?entity_type=device",
        headers={"X-Demo-Role": "fraud_analyst"},
    )

    assert response.status_code == 200
    body = response.json()
    assert {node["type"] for node in body["nodes"]} == {"account", "device"}
    assert len(body["edges"]) >= 3
    assert body["clusters"]


def test_unapproved_report_cannot_be_exported() -> None:
    principal = Principal(
        user_id="demo-compliance",
        tenant_id="northstar-demo",
        role=Role.COMPLIANCE_OFFICER,
    )
    report = {
        "id": "RPT-TEST-0001",
        "tenantId": principal.tenant_id,
        "caseId": "CASE-1042",
        "reportType": "sar",
        "version": 1,
        "status": "draft",
        "content": {"answer": "Synthetic draft"},
        "evidenceRefs": [],
    }
    store._local_reports[report["id"]] = report

    response = client.get(
        f"/api/v1/cases/{report['caseId']}/reports/{report['id']}/export",
        headers={"X-Demo-Role": "compliance_officer"},
    )

    assert response.status_code == 409
    assert "approved" in response.json()["error"]["message"]


def test_report_creator_cannot_approve_their_own_draft() -> None:
    principal = Principal(
        user_id="demo-compliance",
        tenant_id="northstar-demo",
        role=Role.COMPLIANCE_OFFICER,
    )
    report = {
        "id": "RPT-SELF-REVIEW-001",
        "tenantId": principal.tenant_id,
        "caseId": "CASE-1042",
        "reportType": "sar",
        "version": 1,
        "status": "draft",
        "createdBy": principal.user_id,
        "content": {"answer": "Synthetic draft"},
        "evidenceRefs": [],
    }
    store._local_reports[report["id"]] = report

    response = client.post(
        f"/api/v1/cases/{report['caseId']}/reports/{report['id']}/review",
        headers={"X-Demo-Role": "compliance_officer", "X-Demo-User": "demo-compliance"},
        json={"decision": "approved", "comment": "Reviewed evidence."},
    )

    assert response.status_code == 409
    assert "different user" in response.json()["error"]["message"]


def test_unconfigured_vertex_generation_fails_explicitly() -> None:
    isolated_settings = SimpleNamespace(demo_mode=True, google_cloud_project=None)
    app.dependency_overrides[get_settings] = lambda: isolated_settings
    try:
        response = client.post(
            "/api/v1/cases/CASE-1042/agents/explain",
            headers={"X-Demo-Role": "fraud_analyst"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 503
    assert "Vertex AI is not configured" in response.json()["error"]["message"]


def test_non_local_environment_does_not_accept_demo_headers(monkeypatch) -> None:
    production_settings = SimpleNamespace(demo_mode=False, session_cookie_name="shieldiq_session")
    monkeypatch.setattr(auth, "get_settings", lambda: production_settings)
    response = client.get(
        "/api/v1/auth/me",
        headers={"X-Demo-Role": "admin", "X-Demo-User": "forged-admin"},
    )

    assert response.status_code == 401
