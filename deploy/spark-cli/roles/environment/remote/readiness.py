from __future__ import annotations

from config.models import EnvironmentConfig
from roles.environment.health import inspect_environment
from .models import RemoteResult


def _status(results: tuple[RemoteResult, ...], role: str, index: int = 1) -> str:
    matched = [item for item in results if item.node.role == role]
    if len(matched) < index:
        return "NOT_RUN"
    return "PASS" if matched[index - 1].ok else matched[index - 1].status.value


def build_readiness(environment: EnvironmentConfig, results: tuple[RemoteResult, ...], network_ok: bool) -> tuple[dict[str, str], tuple[str, ...]]:
    health = inspect_environment(environment)
    checks = dict(health.checks)
    db = _status(results, "database")
    app = _status(results, "application")
    proxy1 = _status(results, "reverse_proxy", 1)
    proxy2 = _status(results, "reverse_proxy", 2)
    public_keys = ("public_entrypoint",)
    public_ok = all(checks.get(key) == "PASS" for key in public_keys)
    ready = all(value == "PASS" for value in (db, app, proxy1, proxy2)) and health.healthy and network_ok and public_ok
    lines = [
        "SPARK PRODUCTION READINESS", "",
        "Infrastructure",
        f"  Database            {db}",
        f"  Application         {app}",
        f"  Reverse Proxy #1    {proxy1}",
        f"  Reverse Proxy #2    {proxy2}", "",
        "Database Core",
        f"  PostgreSQL          {'PASS' if checks.get('auth') == 'PASS' and checks.get('rest') == 'PASS' else 'FAIL'}",
        f"  Auth                {checks.get('auth', 'FAIL')}",
        f"  REST                {checks.get('rest', 'FAIL')}",
        f"  Realtime            {checks.get('realtime', 'FAIL')}",
        f"  Storage             {checks.get('storage', 'FAIL')}",
        f"  Gateway             {'PASS' if checks.get('realtime') == 'PASS' else 'FAIL'}", "",
        "Application",
        f"  Frontend            {checks.get('frontend', 'FAIL')}",
        f"  Edge Functions      {checks.get('edge_functions', 'FAIL')}",
        f"  LiveKit             {checks.get('livekit', 'FAIL')}",
        f"  Coturn              {checks.get('turn_tcp', 'FAIL')}", "",
        "Network",
        f"  Central Validation  {'PASS' if network_ok else 'FAIL'}", "",
        "Public",
        f"  HTTPS               {checks.get('public_entrypoint', 'WAITING_FOR_OPERATOR')}", "",
        f"RESULT                {'READY' if ready else 'NOT_READY'}",
    ]
    checks["result"] = "READY" if ready else "NOT_READY"
    return checks, tuple(lines)
