import re
from typing import Any

from fastapi import HTTPException
from google.cloud import bigquery
from google.cloud.bigquery import ScalarQueryParameter
from starlette.concurrency import run_in_threadpool

from app.core.auth import Principal
from app.core.config import Settings
from app.core.privacy import mask_sensitive_data


def _table_name(settings: Settings, table: str) -> str:
    project = settings.google_cloud_project
    dataset = settings.bigquery_dataset
    if not project or not re.fullmatch(r"[A-Za-z0-9_-]+", project) or not re.fullmatch(r"[A-Za-z0-9_]+", dataset):
        raise HTTPException(status_code=503, detail="BigQuery project or dataset is not configured")
    if table not in {"alerts", "transactions"}:
        raise ValueError("Unsupported analytical table")
    return f"`{project}.{dataset}.{table}`"


def _query(
    settings: Settings,
    sql: str,
    tenant_id: str,
    *,
    limit: int = 100,
) -> list[dict[str, Any]]:
    try:
        client = bigquery.Client(project=settings.google_cloud_project)
        configuration = bigquery.QueryJobConfig(
            query_parameters=[
                ScalarQueryParameter("tenantId", "STRING", tenant_id),
                ScalarQueryParameter("resultLimit", "INT64", limit),
            ]
        )
        return mask_sensitive_data(
            [dict(row.items()) for row in client.query(sql, job_config=configuration).result(max_results=limit)]
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="BigQuery analytical data is unavailable") from error


def _alerts(settings: Settings, principal: Principal, limit: int) -> list[dict[str, Any]]:
    table = _table_name(settings, "alerts")
    sql = f"""
        SELECT alert_id AS id, case_id AS caseId, subject_ref AS subject,
               alert_type AS type, score, severity, created_at AS createdAt,
               amount_minor AS amountMinor, currency, reason_codes AS reasons
        FROM {table}
        WHERE tenant_id = @tenantId
        ORDER BY created_at DESC
        LIMIT @resultLimit
    """
    return _query(settings, sql, principal.tenant_id, limit=limit)


async def list_alerts(settings: Settings, principal: Principal, limit: int) -> list[dict[str, Any]]:
    return await run_in_threadpool(_alerts, settings, principal, limit)


def _alert_belongs_to_tenant(settings: Settings, tenant_id: str, alert_id: str) -> bool:
    table = _table_name(settings, "alerts")
    try:
        client = bigquery.Client(project=settings.google_cloud_project)
        config = bigquery.QueryJobConfig(
            query_parameters=[
                ScalarQueryParameter("tenantId", "STRING", tenant_id),
                ScalarQueryParameter("alertId", "STRING", alert_id),
            ]
        )
        sql = f"SELECT 1 FROM {table} WHERE tenant_id = @tenantId AND alert_id = @alertId LIMIT 1"
        return next(iter(client.query(sql, job_config=config).result(max_results=1)), None) is not None
    except Exception as error:
        raise HTTPException(status_code=503, detail="BigQuery alert lookup is unavailable") from error


async def alert_belongs_to_tenant(
    settings: Settings,
    principal: Principal,
    alert_id: str,
) -> bool:
    return await run_in_threadpool(
        _alert_belongs_to_tenant,
        settings,
        principal.tenant_id,
        alert_id,
    )


def _dashboard_metrics(settings: Settings, tenant_id: str) -> dict[str, Any]:
    table = _table_name(settings, "alerts")
    try:
        client = bigquery.Client(project=settings.google_cloud_project)
        config = bigquery.QueryJobConfig(
            query_parameters=[ScalarQueryParameter("tenantId", "STRING", tenant_id)]
        )
        summary_sql = f"""
            SELECT
              COALESCE(SUM(IF(status NOT IN ('closed', 'false_positive'), amount_minor, 0)), 0) AS exposure,
              COALESCE(SUM(IF(status IN ('prevented', 'recovered'), amount_minor, 0)), 0) AS safeguarded,
              COUNTIF(severity = 'critical' AND status NOT IN ('closed', 'false_positive')) AS critical,
              COUNTIF(status NOT IN ('closed', 'false_positive')) AS active
            FROM {table}
            WHERE tenant_id = @tenantId
              AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        """
        summary_rows = list(client.query(summary_sql, job_config=config).result(max_results=1))
        trend_sql = f"""
            SELECT FORMAT_TIMESTAMP('%b %d', created_at) AS date,
                   SAFE_DIVIDE(SUM(IF(status NOT IN ('closed', 'false_positive'), amount_minor, 0)), 100000) AS exposure,
                   SAFE_DIVIDE(SUM(IF(status IN ('prevented', 'recovered'), amount_minor, 0)), 100000) AS prevented
            FROM {table}
            WHERE tenant_id = @tenantId
              AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at), date
            ORDER BY DATE(created_at)
        """
        trend_rows = list(client.query(trend_sql, job_config=config).result(max_results=7))
        region_sql = f"""
            SELECT COALESCE(region, 'Unspecified') AS region, COUNT(*) AS count,
                   CASE
                     WHEN COUNT(*) >= 30 THEN 'high'
                     WHEN COUNT(*) >= 15 THEN 'elevated'
                     ELSE 'moderate'
                   END AS risk
            FROM {table}
            WHERE tenant_id = @tenantId
              AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
            GROUP BY region
            ORDER BY count DESC
            LIMIT 8
        """
        region_rows = list(client.query(region_sql, job_config=config).result(max_results=8))
        summary = dict(summary_rows[0].items()) if summary_rows else {}
        return {
            "fraudExposureMinor": int(summary.get("exposure", 0)),
            "moneySavedMinor": int(summary.get("safeguarded", 0)),
            "criticalAlerts": int(summary.get("critical", 0)),
            "activeAlerts": int(summary.get("active", 0)),
            "trend": [
                {
                    "date": row["date"],
                    "exposure": float(row["exposure"] or 0),
                    "prevented": float(row["prevented"] or 0),
                }
                for row in trend_rows
            ],
            "heatmap": [
                {"region": row["region"], "count": int(row["count"]), "risk": row["risk"]}
                for row in region_rows
            ],
        }
    except Exception as error:
        raise HTTPException(status_code=503, detail="BigQuery dashboard aggregates are unavailable") from error


async def dashboard_metrics(settings: Settings, principal: Principal) -> dict[str, Any]:
    return await run_in_threadpool(_dashboard_metrics, settings, principal.tenant_id)


def _transactions(settings: Settings, principal: Principal, case_id: str, limit: int) -> list[dict[str, Any]]:
    table = _table_name(settings, "transactions")
    sql = f"""
        SELECT transaction_id AS id, event_ts AS time, account_ref AS `from`,
               counterparty_ref AS `to`, amount_minor AS amountMinor, currency,
               channel, status, risk_band AS risk, source_ref AS evidenceId
        FROM {table}
        WHERE tenant_id = @tenantId AND case_id = @caseId
        ORDER BY event_ts DESC
        LIMIT @resultLimit
    """
    try:
        client = bigquery.Client(project=settings.google_cloud_project)
        configuration = bigquery.QueryJobConfig(
            query_parameters=[
                ScalarQueryParameter("tenantId", "STRING", principal.tenant_id),
                ScalarQueryParameter("caseId", "STRING", case_id),
                ScalarQueryParameter("resultLimit", "INT64", limit),
            ]
        )
        rows = client.query(sql, job_config=configuration).result(max_results=limit)
        return mask_sensitive_data([dict(row.items()) for row in rows])
    except Exception as error:
        raise HTTPException(status_code=503, detail="BigQuery transaction data is unavailable") from error


async def list_transactions(
    settings: Settings,
    principal: Principal,
    case_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return await run_in_threadpool(_transactions, settings, principal, case_id, limit)
