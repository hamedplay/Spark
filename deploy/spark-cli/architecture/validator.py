from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from config.models import EnvironmentConfig


class ValidationStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_TESTED = "NOT_TESTED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True)
class ValidationIssue:
    check: str
    status: ValidationStatus
    message: str


@dataclass(frozen=True)
class ValidationReport:
    issues: tuple[ValidationIssue, ...]

    @property
    def ok(self) -> bool:
        return all(issue.status != ValidationStatus.FAIL for issue in self.issues)


def validate_architecture(config: EnvironmentConfig) -> ValidationReport:
    issues: list[ValidationIssue] = []
    issues.append(ValidationIssue("schema-version", ValidationStatus.PASS, f"schema_version={config.schema_version}"))
    issues.append(ValidationIssue("environment-mode", ValidationStatus.PASS, f"mode={config.mode}"))

    for role in ("reverse_proxy", "application", "database"):
        matches = [node for node in config.nodes.values() if node.role == role]
        issues.append(ValidationIssue(
            f"role-{role}",
            ValidationStatus.PASS if len(matches) == 1 else ValidationStatus.FAIL,
            "configured" if len(matches) == 1 else f"expected exactly one {role} node",
        ))

    issues.append(ValidationIssue(
        "network-rules",
        ValidationStatus.PASS if config.network.rules else ValidationStatus.NOT_APPLICABLE,
        f"{len(config.network.rules)} declarative rule(s)" if config.network.rules else "no network rules configured",
    ))
    issues.append(ValidationIssue(
        "jump-server",
        ValidationStatus.PASS if config.jump_server.enabled and config.jump_server.host else ValidationStatus.NOT_TESTED,
        f"configured at {config.jump_server.host}" if config.jump_server.enabled and config.jump_server.host else "enabled without a host or not configured; no address was guessed",
    ))
    return ValidationReport(tuple(issues))
