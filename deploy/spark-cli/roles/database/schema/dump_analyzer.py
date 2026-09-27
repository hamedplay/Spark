from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .models import (
    AnalysisReport,
    AnalysisResult,
    Disposition,
    ExtensionInventoryItem,
    Ownership,
    ParsedStatement,
    StatementAnalysis,
    StatementCategory,
)
from .ownership import resolve_ownership
from .parser import SQLParseError, iter_statements
from .rules import OwnershipRules, SECURITY_MARKERS, classify_extension

LEADING_COMMENT_RE = re.compile(r"\A(?:\s|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*", re.MULTILINE)
NAME = r'(?:(?:"(?:[^"]|"")+")|[A-Za-z_][\w$]*)(?:\.(?:(?:"(?:[^"]|"")+")|[A-Za-z_][\w$]*))?'

OBJECT_PATTERNS = (
    ("table", re.compile(rf"^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({NAME})", re.I)),
    ("view", re.compile(rf"^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+({NAME})", re.I)),
    ("materialized_view", re.compile(rf"^CREATE\s+MATERIALIZED\s+VIEW\s+({NAME})", re.I)),
    ("sequence", re.compile(rf"^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?({NAME})", re.I)),
    ("function", re.compile(rf"^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+({NAME})", re.I)),
    ("procedure", re.compile(rf"^CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+({NAME})", re.I)),
    ("index", re.compile(rf"^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:{NAME})\s+ON\s+(?:ONLY\s+)?({NAME})", re.I)),
    ("trigger", re.compile(rf"^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+(?:{NAME})[\s\S]*?\sON\s+({NAME})", re.I)),
    ("policy", re.compile(rf"^CREATE\s+POLICY\s+(?:{NAME})\s+ON\s+({NAME})", re.I)),
    ("table", re.compile(rf"^ALTER\s+TABLE\s+(?:ONLY\s+)?({NAME})", re.I)),
    ("sequence", re.compile(rf"^ALTER\s+SEQUENCE\s+({NAME})", re.I)),
    ("function", re.compile(rf"^ALTER\s+FUNCTION\s+({NAME})", re.I)),
    ("schema", re.compile(rf"^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?({NAME})", re.I)),
    ("grant", re.compile(rf"^(?:GRANT|REVOKE)[\s\S]*?\sON\s+(?:TABLE|SEQUENCE|FUNCTION|PROCEDURE|ALL\s+TABLES\s+IN\s+SCHEMA)?\s*({NAME})", re.I)),
)

EXTENSION_RE = re.compile(r'^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][\w-]*))', re.I)
COPY_NAME_RE = re.compile(rf"^COPY\s+({NAME})", re.I)
INSERT_NAME_RE = re.compile(rf"^INSERT\s+INTO\s+({NAME})", re.I)
OWNER_RE = re.compile(r"\bOWNER\s+TO\b", re.I)
ROLE_RE = re.compile(r"^(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|GROUP)\b|^SET\s+ROLE\b", re.I)
DATABASE_RE = re.compile(r"^(?:CREATE|DROP|ALTER)\s+DATABASE\b", re.I)
UNKNOWN_REVIEW_RE = re.compile(r"^(?:DO\b|CREATE\s+(?:EVENT\s+TRIGGER|CAST|OPERATOR|AGGREGATE)\b|ALTER\s+SYSTEM\b|COMMENT\s+ON\b)", re.I)


def _clean(statement: str) -> str:
    return LEADING_COMMENT_RE.sub("", statement).strip()


def _security_sensitive(text: str) -> bool:
    upper = text.upper()
    return any(marker in upper for marker in SECURITY_MARKERS)


def _object(text: str) -> tuple[str | None, str | None]:
    for object_type, pattern in OBJECT_PATTERNS:
        match = pattern.search(text)
        if match:
            return object_type, match.group(1)
    return None, None


def analyze_statement(statement: ParsedStatement, rules: OwnershipRules) -> StatementAnalysis:
    text = _clean(statement.text)
    sensitive = _security_sensitive(text)

    if statement.kind == "meta":
        command = text.split(None, 1)[0].lower()
        category = StatementCategory.DATABASE_LEVEL if command in {r"\c", r"\connect"} else StatementCategory.ENVIRONMENT_SPECIFIC
        return StatementAnalysis(category, Disposition.DROP if command in {r"\c", r"\connect"} else Disposition.FLAG, Ownership.UNCLASSIFIED, "psql_meta", None, statement.line_start, statement.line_end, sensitive)

    copy_match = COPY_NAME_RE.search(text)
    insert_match = INSERT_NAME_RE.search(text)
    if statement.kind == "copy" or insert_match:
        name = copy_match.group(1) if copy_match else insert_match.group(1)
        ownership = resolve_ownership(name, rules)
        return StatementAnalysis(StatementCategory.DATA, Disposition.DROP, ownership, "data", name, statement.line_start, statement.line_end, sensitive)

    if ROLE_RE.search(text):
        return StatementAnalysis(StatementCategory.ROLE_SECURITY, Disposition.DROP, Ownership.UNCLASSIFIED, "role", None, statement.line_start, statement.line_end, True)
    if DATABASE_RE.search(text):
        return StatementAnalysis(StatementCategory.DATABASE_LEVEL, Disposition.DROP, Ownership.UNCLASSIFIED, "database", None, statement.line_start, statement.line_end, sensitive)
    if OWNER_RE.search(text):
        object_type, object_name = _object(text)
        return StatementAnalysis(StatementCategory.ENVIRONMENT_SPECIFIC, Disposition.DROP, resolve_ownership(object_name, rules), object_type, object_name, statement.line_start, statement.line_end, sensitive)

    extension_match = EXTENSION_RE.search(text)
    if extension_match:
        name = extension_match.group(1) or extension_match.group(2)
        classification = classify_extension(name)
        disposition = Disposition.DEFER if classification.value != "UNCLASSIFIED" else Disposition.FLAG
        return StatementAnalysis(StatementCategory.EXTENSION, disposition, Ownership.UNCLASSIFIED, "extension", name, statement.line_start, statement.line_end, sensitive)

    object_type, object_name = _object(text)
    if object_name:
        ownership = resolve_ownership(object_name, rules)
        if ownership == Ownership.PLATFORM_OWNED:
            return StatementAnalysis(StatementCategory.SUPABASE_INTERNAL, Disposition.DROP, ownership, object_type, object_name, statement.line_start, statement.line_end, sensitive)
        if ownership == Ownership.SPARK_OWNED:
            return StatementAnalysis(StatementCategory.SPARK_SCHEMA, Disposition.KEEP, ownership, object_type, object_name, statement.line_start, statement.line_end, sensitive)
        return StatementAnalysis(StatementCategory.UNKNOWN, Disposition.FLAG, ownership, object_type, object_name, statement.line_start, statement.line_end, sensitive)

    if UNKNOWN_REVIEW_RE.search(text) or text:
        return StatementAnalysis(StatementCategory.UNKNOWN, Disposition.FLAG, Ownership.UNCLASSIFIED, None, None, statement.line_start, statement.line_end, sensitive)
    return StatementAnalysis(StatementCategory.UNKNOWN, Disposition.FLAG, Ownership.UNCLASSIFIED, None, None, statement.line_start, statement.line_end, sensitive)


class LegacyDumpAnalyzer:
    def __init__(self, rules: OwnershipRules | None = None):
        self.rules = rules or OwnershipRules()

    @staticmethod
    def _source(path: Path) -> tuple[str, int]:
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        return digest.hexdigest(), size

    def analyze(self, path: str | Path) -> AnalysisReport:
        source = Path(path)
        if not source.is_file():
            raise FileNotFoundError(source)
        checksum, size = self._source(source)
        report = AnalysisReport(source_sha256=checksum, size_bytes=size)
        extension_map: dict[str, ExtensionInventoryItem] = {}
        try:
            with source.open("r", encoding="utf-8", errors="strict", newline="") as handle:
                for statement in iter_statements(handle):
                    analysis = analyze_statement(statement, self.rules)
                    report.statements += 1
                    report.categories[analysis.category.value] = report.categories.get(analysis.category.value, 0) + 1
                    if analysis.object_type:
                        report.objects[analysis.object_type] = report.objects.get(analysis.object_type, 0) + 1
                    if statement.kind == "copy":
                        report.copy_blocks += 1
                        report.copy_rows_skipped += statement.copy_rows_skipped or 0
                    if analysis.security_sensitive:
                        report.sensitive_count += 1
                    if analysis.category == StatementCategory.UNKNOWN:
                        report.unknown_count += 1
                    if analysis.ownership == Ownership.UNCLASSIFIED and analysis.category not in {
                        StatementCategory.ROLE_SECURITY,
                        StatementCategory.DATABASE_LEVEL,
                        StatementCategory.ENVIRONMENT_SPECIFIC,
                        StatementCategory.EXTENSION,
                    }:
                        report.unclassified_count += 1
                    if analysis.category == StatementCategory.EXTENSION and analysis.object_name:
                        extension_map[analysis.object_name.lower()] = ExtensionInventoryItem(
                            analysis.object_name,
                            classify_extension(analysis.object_name),
                        )
        except (UnicodeDecodeError, SQLParseError):
            report.result = AnalysisResult.PARSE_FAILED
            return report

        report.extensions = list(extension_map.values())
        if report.sensitive_count and report.unknown_count:
            report.result = AnalysisResult.ANALYZED_WITH_REVIEW
        elif report.unknown_count or report.unclassified_count or any(item.classification.value == "UNCLASSIFIED" for item in report.extensions):
            report.result = AnalysisResult.ANALYZED_WITH_REVIEW
        else:
            report.result = AnalysisResult.ANALYZED
        return report

    @staticmethod
    def json_text(report: AnalysisReport) -> str:
        return json.dumps(report.to_dict(), ensure_ascii=False, sort_keys=True, indent=2) + "\n"
