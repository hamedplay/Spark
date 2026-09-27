from __future__ import annotations

from .models import Ownership
from .rules import OwnershipRules


def split_qualified_name(name: str | None) -> tuple[str | None, str | None]:
    if not name:
        return None, None
    raw = name.strip().rstrip(";,)")
    parts: list[str] = []
    current = []
    quoted = False
    for char in raw:
        if char == '"':
            quoted = not quoted
            current.append(char)
        elif char == "." and not quoted:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    clean = [part.strip().strip('"') for part in parts if part.strip()]
    if len(clean) >= 2:
        return clean[-2].lower(), clean[-1]
    if clean:
        return None, clean[-1]
    return None, None


def resolve_ownership(object_name: str | None, rules: OwnershipRules) -> Ownership:
    schema, _ = split_qualified_name(object_name)
    if schema and schema in rules.platform_schemas:
        return Ownership.PLATFORM_OWNED
    if schema and schema in rules.owned_schemas:
        return Ownership.SPARK_OWNED
    return Ownership.UNCLASSIFIED
