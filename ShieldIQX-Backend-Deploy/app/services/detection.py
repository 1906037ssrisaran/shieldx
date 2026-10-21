from typing import Any

RULE_VERSION = "shieldiq-fraud-rules-v1"
REASON_WEIGHTS = {
    "VELOCITY_SPIKE": ("Rapid transaction velocity", 30),
    "SHARED_DEVICE": ("Device observed across multiple accounts", 25),
    "NEW_BENEFICIARY": ("First-seen beneficiary", 20),
    "LOCATION_ANOMALY": ("Activity outside recent location baseline", 20),
    "NEW_DEVICE": ("First-seen device", 16),
    "REFUND_VELOCITY": ("Merchant refund velocity", 18),
    "BEHAVIOR_ANOMALY": ("Behavior differs from observed account baseline", 15),
    "ACCOUNT_ANOMALY": ("Account-level activity anomaly", 14),
    "IP_REPUTATION": ("Network reputation signal", 12),
}
EVIDENCE_TERMS = {
    "VELOCITY_SPIKE": {"transaction", "transfer", "velocity"},
    "SHARED_DEVICE": {"device"},
    "NEW_BENEFICIARY": {"beneficiary", "counterparty", "payee", "transfer"},
    "LOCATION_ANOMALY": {"location", "network", "region", "ip"},
    "NEW_DEVICE": {"device"},
    "REFUND_VELOCITY": {"refund", "merchant", "transaction"},
    "BEHAVIOR_ANOMALY": {"behavior", "baseline", "account"},
    "ACCOUNT_ANOMALY": {"account", "activity", "baseline"},
    "IP_REPUTATION": {"network", "ip", "reputation"},
}


def evaluate_case(
    case: dict[str, Any],
    evidence: list[dict[str, Any]],
    alert_threshold: int = 75,
) -> dict[str, Any]:
    evidence_ids = {item["id"] for item in evidence if item.get("id")}
    reason_codes = list(dict.fromkeys(case.get("reasonCodes", [])))
    factors = []
    unsupported_signals = []
    unmapped_signals = []
    for code in reason_codes:
        reason = REASON_WEIGHTS.get(code)
        if not reason:
            unmapped_signals.append(code)
            continue
        title, points = reason
        tokens = EVIDENCE_TERMS[code]
        related = [
            item
            for item in evidence
            if item.get("id") in evidence_ids
            and (
                item.get("type", "").lower() in tokens
                or any(token in " ".join(str(value) for value in item.values()).lower() for token in tokens)
            )
        ]
        if not related:
            unsupported_signals.append(code)
            continue
        factors.append(
            {
                "reasonCode": code,
                "factor": title,
                "points": points,
                "evidenceRefs": [item["id"] for item in related[:3]],
            }
        )

    score = min(100, 12 + sum(factor["points"] for factor in factors))
    severity = "critical" if score >= 90 else "high" if score >= 75 else "medium" if score >= 50 else "low"
    return {
        "score": score,
        "severity": severity,
        "alertThreshold": alert_threshold,
        "thresholdTriggered": score >= alert_threshold,
        "ruleVersion": RULE_VERSION,
        "factors": factors,
        "unsupportedSignals": unsupported_signals,
        "unmappedSignals": unmapped_signals,
        "evidenceCoverage": round(len({ref for factor in factors for ref in factor["evidenceRefs"]}) / max(len(evidence_ids), 1), 3),
        "decisionBoundary": "Triage prioritization only; not proof and not an automated payment action.",
    }
