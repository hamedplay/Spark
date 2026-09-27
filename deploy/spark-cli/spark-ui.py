#!/usr/bin/env python3
"""Spark UI provisioning extension layered over the stable UI adapter."""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE_PATH = HERE / "spark-ui-base.py"


def _resolve_base() -> Path:
    if BASE_PATH.is_file():
        return BASE_PATH
    revision = os.environ.get("SPARK_MANAGER_REVISION", "main").strip() or "main"
    url = f"https://raw.githubusercontent.com/hamedplay/Spark/{revision}/deploy/spark-cli/spark-ui-base.py"
    request = urllib.request.Request(url, headers={"User-Agent": "spark-manager-ui"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
    handle = tempfile.NamedTemporaryFile(prefix="spark-ui-base-", suffix=".py", delete=False)
    try:
        handle.write(payload)
        handle.flush()
    finally:
        handle.close()
    return Path(handle.name)


base_path = _resolve_base()
spec = importlib.util.spec_from_file_location("spark_ui_base", base_path)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load Spark UI base: {base_path}")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)
core = base.core
SPARK_UI_VERSION = base.SPARK_UI_VERSION

PROVISIONING_ACTIONS = [
    core.Action("architecture-overview", "Architecture Overview", "Render the active Spark environment topology from its profile."),
    core.Action("architecture-profile", "Environment Profile", "Show active profile metadata and configuration readiness."),
    core.Action("architecture-validate", "Validate Architecture", "Run static schema, role and network-policy validation."),
    core.Action("architecture-network", "Network Connectivity", "Test only connections that are valid to measure from the current host role."),
    core.Action("architecture-status", "Deployment Status", "Show configuration readiness and full-environment health state."),
    core.Action("architecture-install-database", "Install Database Core", "Provision PostgreSQL and Supabase Core only on the database-role host.", "confirm"),
    core.Action("architecture-install-application", "Install Application Server", "Provision frontend, Edge Runtime/Functions, LiveKit and Coturn on the application-role host.", "confirm"),
    core.Action("architecture-install-proxy", "Install Reverse Proxy", "Provision the reverse-proxy role for public routing and provided TLS.", "confirm"),
    core.Action("architecture-install-full", "Install Full Environment", "Run the local role workflow and report guided actions required on remaining hosts.", "confirm"),
    core.Action("architecture-resume", "Resume Full Environment", "Reverify completed tasks and resume the local full-environment workflow.", "controlled"),
    core.Action("architecture-validate-environment", "Validate Full Environment", "Inspect component health and declarative network checkpoints without provisioning."),
    core.Action("architecture-repair", "Repair Local Role", "Repair only the current detected role when health checks require remediation.", "controlled"),
    core.Action("architecture-central-plan", "Production Dry Run", "From the Jump node, verify SSH/host keys/sudo and identical Manager revision on all production nodes. No remote mutation."),
    core.Action("architecture-central-install", "Production Install", "Run the gated Database → Application → Proxy #1 → Proxy #2 production workflow from the Jump node.", "confirm"),
    core.Action("architecture-central-resume", "Resume Production Install", "Reverify previously completed nodes, then continue from the first unhealthy or incomplete production stage.", "controlled"),
    core.Action("architecture-central-status", "Production Readiness", "Run non-mutating per-node health, network and end-to-end readiness checks from the Jump node."),
    core.Action("architecture-central-repair", "Centralized Repair", "Repair only unhealthy roles while preserving healthy nodes and upstream services.", "controlled"),
]

MANAGER_AIRGAP_ACTIONS = [
    core.Action("manager-airgap-build", "Build Manager Air-Gap Bundle", "Build a checksum-verified Manager-only bundle pinned to one exact Spark commit.", "controlled"),
    core.Action("manager-airgap-install-environment", "Install / Update Manager on Environment", "Distribute one verified Manager bundle to Database, Application and both Proxy nodes through strict SSH and the restricted bootstrap launcher.", "confirm"),
    core.Action("manager-airgap-verify-revisions", "Verify Manager Revisions", "Compare the Jump Manager revision with all configured environment nodes and refuse mismatches."),
    core.Action("manager-airgap-status", "Manager Deployment Status", "Show per-node Manager revision readiness without provisioning."),
]


def _extend_categories() -> None:
    rebuilt = []
    architecture_found = False
    airgap_found = False
    for category, actions in core.CATEGORIES:
        if category == "Architecture & Provisioning":
            rebuilt.append((category, list(PROVISIONING_ACTIONS)))
            architecture_found = True
        elif category == "Installation Air-Gapped":
            existing = [action for action in actions if not action.action_id.startswith("manager-airgap-")]
            rebuilt.append((category, [*MANAGER_AIRGAP_ACTIONS, *existing]))
            airgap_found = True
        else:
            rebuilt.append((category, actions))
    if not architecture_found:
        rebuilt.append(("Architecture & Provisioning", list(PROVISIONING_ACTIONS)))
    if not airgap_found:
        rebuilt.append(("Installation Air-Gapped", list(MANAGER_AIRGAP_ACTIONS)))
    core.CATEGORIES[:] = rebuilt


_original_self_test = core.self_test
_original_task_init = core.TaskProcess.__init__


def manager_routed_task_init(self, spark_path, action_id, args, rows, cols):
    if action_id.startswith("manager-airgap-"):
        candidates = [
            Path("/usr/local/bin/spark-manager-airgap"),
            HERE / "lib/spark-manager-airgap",
            core.SPARK_ROOT / "deploy/spark-cli/lib/spark-manager-airgap",
        ]
        manager_path = next((path for path in candidates if path.is_file() and os.access(path, os.X_OK)), None)
        if manager_path is None:
            raise FileNotFoundError("spark-manager-airgap is not installed; update Spark Manager first")
        spark_path = str(manager_path)
    return _original_task_init(self, spark_path, action_id, args, rows, cols)


def provisioning_self_test() -> int:
    result = _original_self_test()
    ids = {a.action_id for _, actions in core.CATEGORIES for a in actions if not a.special}
    required = {action.action_id for action in PROVISIONING_ACTIONS} | {action.action_id for action in MANAGER_AIRGAP_ACTIONS}
    missing = sorted(required - ids)
    if missing:
        raise RuntimeError("provisioning UI registry is incomplete: " + ", ".join(missing))
    if len([category for category, _ in core.CATEGORIES if category == "Architecture & Provisioning"]) != 1:
        raise RuntimeError("Architecture & Provisioning category is missing or duplicated")
    if len([category for category, _ in core.CATEGORIES if category == "Installation Air-Gapped"]) != 1:
        raise RuntimeError("Installation Air-Gapped category is missing or duplicated")
    return result


_extend_categories()
core.TaskProcess.__init__ = manager_routed_task_init
core.self_test = provisioning_self_test


def main(argv: list[str]) -> int:
    return base.main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
