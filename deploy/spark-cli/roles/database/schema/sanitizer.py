from __future__ import annotations

from dataclasses import dataclass

from .models import Disposition, StatementAnalysis


@dataclass(frozen=True)
class SanitizationDecision:
    disposition: Disposition
    reason: str


def decision_for(analysis: StatementAnalysis) -> SanitizationDecision:
    """M3.6-A only exposes deterministic classification decisions.

    No SQL transformation or baseline generation is performed in this milestone.
    """
    return SanitizationDecision(
        disposition=analysis.disposition,
        reason=f"{analysis.category.value}:{analysis.ownership.value}",
    )
