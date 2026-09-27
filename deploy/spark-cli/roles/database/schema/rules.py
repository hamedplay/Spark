from __future__ import annotations

from dataclasses import dataclass

from .models import ExtensionClassification


PLATFORM_SCHEMAS = frozenset({
    "auth",
    "storage",
    "realtime",
    "supabase_migrations",
    "_supabase",
    "_extensions",
    "extensions",
    "graphql",
    "graphql_public",
    "vault",
    "pgsodium",
    "information_schema",
    "pg_catalog",
})

PLATFORM_EXTENSIONS = frozenset({
    "pg_net",
    "pg_graphql",
    "supabase_vault",
    "pgsodium",
})

COMMON_APP_EXTENSIONS = frozenset({
    "pgcrypto",
    "uuid-ossp",
    "pg_trgm",
})

SECURITY_MARKERS = (
    "PASSWORD",
    "SECRET",
    "TOKEN",
    "PRIVATE KEY",
    "JWT",
    "SERVICE_ROLE",
)


@dataclass(frozen=True)
class OwnershipRules:
    owned_schemas: frozenset[str] = frozenset()
    shared_schemas: frozenset[str] = frozenset()
    platform_schemas: frozenset[str] = PLATFORM_SCHEMAS


def classify_extension(name: str) -> ExtensionClassification:
    normalized = name.strip().lower()
    if normalized in PLATFORM_EXTENSIONS:
        return ExtensionClassification.SUPABASE_MANAGED
    if normalized in COMMON_APP_EXTENSIONS:
        return ExtensionClassification.REQUIRED_CANDIDATE
    return ExtensionClassification.UNCLASSIFIED
