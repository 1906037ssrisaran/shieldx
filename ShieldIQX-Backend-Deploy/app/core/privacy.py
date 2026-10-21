import re
from typing import Any

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_LONG_DIGITS = re.compile(r"(?<!\w)(?:\+?\d[\s().-]*){8,}(?!\w)")


def mask_sensitive_text(value: str) -> str:
    value = _EMAIL.sub(
        lambda match: match.group(0)[:1] + "***@" + match.group(0).split("@", 1)[1],
        value,
    )
    return _LONG_DIGITS.sub("[MASKED_IDENTIFIER]", value)


def mask_sensitive_data(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: mask_sensitive_data(item) for key, item in value.items()}
    if isinstance(value, list):
        return [mask_sensitive_data(item) for item in value]
    if isinstance(value, str):
        return mask_sensitive_text(value)
    return value
