from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class StatementCategory(str, Enum):
    SPARK_SCHEMA = "spark_schema"
    SUPABASE_INTERNAL = "supabase_internal"
    DATA = "data"
    ROLE_SECURITY = "role_security"
    DATABASE_LEVEL = "database_level"
    EXTENSION = "extension"
    ENVIRONMENT_SPECIFIC = "environment_specific"
    UNKNOWN = "unknown"


class Disposition(str, Enum):
    KEEP = "keep"
    DROP = "drop"
    FLAG = "flag"
    DEFER = "defer"


class Ownership(str, Enum):
    SPARK_OWNED = "spark_owned"
    PLATFORM_OWNED = "platform_owned"
    UNCLASSIFIED = "unclassified"


class AnalysisResult(str, Enum):
    ANALYZED = "ANALYZED"
    ANALYZED_WITH_REVIEW = "ANALYZED_WITH_REVIEW"
    UNSAFE_INPUT = "UNSAFE_INPUT"
    PARSE_FAILED = "PARSE_FAILED"


class ExtensionClassification(str, Enum):
    REQUIRED_CANDIDATE = "REQUIRED_CANDIDATE"
    SUPABASE_MANAGED = "SUPABASE_MANAGED"
    UNCLASSIFIED = "UNCLASSIFIED"


@dataclass(frozen=True)
class ParsedStatement:
    text: str
    line_start: int
    line_end: int
    kind: str = "sql"
    copy_rows_skipped: int | None = None


@dataclass(frozen=True)
class StatementAnalysis:
    category: StatementCategory
    disposition: Disposition
    ownership: Ownership
    object_type: str | None
    object_name: str | None
    line_start: int
    line_end: int
    security_sensitive: bool = False


@dataclass(frozen=True)
class ExtensionInventoryItem:
    name: str
    classification: ExtensionClassification


@dataclass
class AnalysisReport:
    source_sha256: str
    size_bytes: int
    statements: int = 0
    copy_blocks: int = 0
    copy_rows_skipped: int = 0
    categories: dict[str, int] = field(default_factory=dict)
    objects: dict[str, int] = field(default_factory=dict)
    extensions: list[ExtensionInventoryItem] = field(default_factory=list)
    sensitive_count: int = 0
    unknown_count: int = 0
    unclassified_count: int = 0
    result: AnalysisResult = AnalysisResult.ANALYZED

    def to_dict(self) -> dict:
        return {
            "format_version": 1,
            "source": {
                "type": "legacy-sql-backup",
                "sha256": self.source_sha256,
                "size_bytes": self.size_bytes,
            },
            "summary": {
                "statements": self.statements,
                "copy_blocks": self.copy_blocks,
                "copy_rows_skipped": self.copy_rows_skipped,
            },
            "categories": dict(sorted(self.categories.items())),
            "objects": dict(sorted(self.objects.items())),
            "extensions": [
                {"name": item.name, "classification": item.classification.value}
                for item in sorted(self.extensions, key=lambda item: item.name)
            ],
            "security": {
                "sensitive_statements_present": self.sensitive_count > 0,
                "count": self.sensitive_count,
            },
            "review": {
                "unknown_count": self.unknown_count,
                "unclassified_count": self.unclassified_count,
            },
            "result": self.result.value,
        }
