from __future__ import annotations

from config.models import EnvironmentConfig
from roles.environment.health import inspect_environment
from .models import RemoteOperation, RemoteResult


def _status(results: tuple[RemoteResult, ...], role: str, index: int = 1) -> str:
    node_ids: list[str] = []
    for item in results:
        if item.node.role == role and item.node.id not in node_ids:
            node_ids.append(item.node.id)
    if len(node_ids) < index:
        return "NOT_RUN"
    target = node_ids[index - 1]
    matched = [item for item in results if item.node.id == target and item.operation not in {RemoteOperation.REVISION, RemoteOperation.NETWORK}]
    if not matched:
        return "NOT_RUN"
    latest = matched[-1]
    return "PASS" if latest.ok else latest.status.value


def build_readiness(environment: EnvironmentConfig, results: tuple[RemoteResult, ...], network_ok: bool) -> tuple[dict[str, str], tuple[str, ...]]:
    health = inspect_environment(environment)
    checks = dict(health.checks)
    db = _status(results, "database")
    app = _status(results, "application")
    proxy1 = _status(results, "reverse_proxy", 1)
    proxy2 = _status(results, "reverse_proxy", 2)
    public_keys = ("public_entrypoint", "public_auth", "public_rest", "public_realtime", "public_storage", "public_edge")
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
        f"  PostgreSQL          {checks.get('postgresql', 'FAIL')}",
        f"  Auth                {checks.get('auth', 'FAIL')}",
        f"  REST                {checks.get('rest', 'FAIL')}",
        f"  Realtime            {checks.get('realtime', 'FAIL')}",
        f"  Storage             {checks.get('storage', 'FAIL')}",
        f"  Gateway             {checks.get('gateway', 'FAIL')}", "",
        "Application",
        f"  Frontend            {checks.get('frontend', 'FAIL')}",
        f"  Edge Functions      {checks.get('edge_functions', 'FAIL')}",
        f"  LiveKit             {checks.get('livekit', 'FAIL')}",
        f"  Coturn              {checks.get('turn_tcp', 'FAIL')}", "",
        "Network",
        f"  Proxy/App/DB Paths  {'PASS' if network_ok else 'FAIL'}", "",
        "Public",
        f"  HTTPS               {checks.get('public_entrypoint', 'WAITING_FOR_OPERATOR')}",
        f"  Auth Route          {checks.get('public_auth', 'WAITING_FOR_OPERATOR')}",
        f"  REST Route          {checks.get('public_rest', 'WAITING_FOR_OPERATOR')}",
        f"  Realtime Route      {checks.get('public_realtime', 'WAITING_FOR_OPERATOR')}",
        f"  Storage Route       {checks.get('public_storage', 'WAITING_FOR_OPERATOR')}",
        f"  Edge Functions      {checks.get('public_edge', 'WAITING_FOR_OPERATOR')}", "",
        f"RESULT                {'READY' if ready else 'NOT_READY'}",
    ]
    checks["result"] = "READY" if ready else "NOT_READY"
    return checks, tuple(lines)
