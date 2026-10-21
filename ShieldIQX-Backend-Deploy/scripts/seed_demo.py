import argparse
import os
from datetime import UTC, datetime

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from google.cloud import bigquery

from app.services import store

TENANT_ID = "northstar-demo"
CASE_ID = "CASE-1042"


def seed_firestore(project_id: str) -> None:
    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app(options={"projectId": project_id})
    client = firestore.client(app=app)
    now = datetime.now(UTC).isoformat()
    batch = client.batch()
    tenant_ref = client.collection("tenants").document(TENANT_ID)
    batch.set(
        tenant_ref,
        {"name": "Northstar Financial — Synthetic Demo", "status": "active", "createdAt": now},
        merge=True,
    )

    for case in store.DEMO_CASES:
        case_ref = client.collection("cases").document(case["id"])
        batch.set(case_ref, case, merge=True)
        for evidence in store.DEMO_EVIDENCE_BY_CASE.get(case["id"], []):
            evidence_ref = case_ref.collection("evidence").document(evidence["id"])
            batch.set(
                evidence_ref,
                evidence | {"tenantId": TENANT_ID, "caseId": case["id"], "synthetic": True},
                merge=True,
            )
        for event in store.DEMO_TIMELINE_BY_CASE.get(case["id"], []):
            event_ref = case_ref.collection("events").document(event["id"])
            batch.set(
                event_ref,
                {
                    "tenantId": TENANT_ID,
                    "type": event["type"],
                    "occurredAt": event["time"],
                    "summary": event["title"],
                    "description": event["description"],
                    "evidenceRefs": [event["id"]] if event["id"].startswith("EV-") else [],
                },
                merge=True,
            )

    for node in store.DEMO_NODES:
        node_ref = client.collection("entityNodes").document(node["id"])
        batch.set(
            node_ref,
            {
                "tenantId": TENANT_ID,
                "type": node["type"],
                "maskedLabel": node["label"],
                "riskScore": node["risk"],
                "x": node["x"],
                "y": node["y"],
            },
            merge=True,
        )
    for edge in store.DEMO_EDGES:
        edge_ref = client.collection("entityEdges").document(edge["id"])
        batch.set(
            edge_ref,
            {
                "tenantId": TENANT_ID,
                "sourceNodeId": edge["source"],
                "targetNodeId": edge["target"],
                "relationship": edge["label"],
                "relationshipType": edge["type"],
                "caseIds": [CASE_ID],
                "confidence": 0.94 if edge["type"] == "transfer" else 0.78,
                "validFrom": "2026-10-13T09:09:00+00:00",
                "evidenceRefs": [edge["evidenceId"]],
            },
            merge=True,
        )
    batch.commit()


def seed_bigquery(project_id: str, dataset_id: str) -> None:
    client = bigquery.Client(project=project_id)
    transaction_rows = []
    for transaction in store.DEMO_TRANSACTIONS:
        transaction_rows.append(
            {
                "tenant_id": TENANT_ID,
                "case_id": transaction["caseId"],
                "transaction_id": transaction["id"],
                "event_ts": transaction["time"],
                "account_ref": transaction["from"],
                "counterparty_ref": transaction["to"],
                "amount_minor": transaction["amountMinor"],
                "currency": transaction["currency"],
                "channel": transaction["channel"],
                "status": transaction["status"],
                "risk_band": transaction["risk"],
                "source_ref": transaction["evidenceId"],
                "ingested_at": datetime.now(UTC).isoformat(),
            }
        )
    alert_rows = []
    for alert in store.DEMO_ALERTS:
        alert_rows.append(
            {
                "tenant_id": TENANT_ID,
                "alert_id": alert["id"],
                "case_id": alert["caseId"],
                "subject_ref": alert["subject"],
                "alert_type": alert["type"],
                "created_at": alert["createdAt"],
                "score": alert["score"],
                "severity": alert["severity"],
                "amount_minor": alert["amountMinor"],
                "currency": alert["currency"],
                "region": "North America",
                "reason_codes": alert["reasons"],
                "detection_version": "synthetic-rules-v1",
                "status": "investigating",
            }
        )

    table_root = f"{project_id}.{dataset_id}"
    for table_id, rows in (
        ("transactions", transaction_rows),
        ("alerts", alert_rows),
    ):
        errors = client.insert_rows_json(
            f"{table_root}.{table_id}",
            rows,
            row_ids=[row.get("transaction_id", row.get("alert_id")) for row in rows],
        )
        if errors:
            raise RuntimeError(f"BigQuery seed failed for {table_id}: {errors}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Load synthetic ShieldIQ demo records.")
    parser.add_argument("--confirm-synthetic-only", action="store_true")
    parser.add_argument("--dataset", default=os.getenv("BIGQUERY_DATASET", "shieldiq"))
    parser.add_argument(
        "--user",
        action="append",
        default=[],
        metavar="UID:EMAIL:ROLE",
        help="Provision a pre-created Firebase Auth user's tenant role profile (repeatable).",
    )
    args = parser.parse_args()
    environment = os.getenv("SHIELDIQ_ENV", "local").lower()
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not args.confirm_synthetic_only:
        raise SystemExit("Pass --confirm-synthetic-only to acknowledge that only synthetic data is seeded.")
    if environment not in {"local", "development", "staging"}:
        raise SystemExit("Synthetic demo seeding is blocked in production.")
    if not project_id:
        raise SystemExit("Set GOOGLE_CLOUD_PROJECT and configure Application Default Credentials.")

    user_records = []
    allowed_roles = {"admin", "fraud_analyst", "compliance_officer", "risk_manager"}
    for value in args.user:
        parts = value.split(":", 2)
        if len(parts) != 3 or not parts[0] or not parts[1] or parts[2] not in allowed_roles:
            raise SystemExit("Each --user must be UID:EMAIL:admin|fraud_analyst|compliance_officer|risk_manager")
        user_records.append(
            {
                "uid": parts[0],
                "email": parts[1],
                "role": parts[2],
                "status": "active",
                "tenantId": TENANT_ID,
            }
        )

    if len({record["uid"] for record in user_records}) != len(user_records):
        raise SystemExit("Each Firebase UID may be provisioned only once per invocation.")

    if user_records:
        try:
            app = firebase_admin.get_app()
        except ValueError:
            app = firebase_admin.initialize_app(options={"projectId": project_id})
        for record in user_records:
            firebase_user = firebase_auth.get_user(record["uid"], app=app)
            if not firebase_user.email or firebase_user.email.lower() != record["email"].lower():
                raise SystemExit(f"The supplied email does not match Firebase user {record['uid']}.")

    seed_firestore(project_id)
    seed_bigquery(project_id, args.dataset)
    if user_records:
        try:
            app = firebase_admin.get_app()
        except ValueError:
            app = firebase_admin.initialize_app(options={"projectId": project_id})
        client = firestore.client(app=app)
        batch = client.batch()
        for record in user_records:
            batch.set(
                client.collection("users").document(record["uid"]),
                record | {"createdAt": datetime.now(UTC).isoformat()},
                merge=True,
            )
        batch.commit()
    print(f"Synthetic ShieldIQ demo data loaded into project {project_id}, tenant {TENANT_ID}.")


if __name__ == "__main__":
    main()
