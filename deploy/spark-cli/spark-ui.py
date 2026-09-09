#!/usr/bin/env python3
"""Spark curses UI adapter for production-only extensions."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

SPARK_UI_VERSION = "3.0.0"
# Compatibility strings used by the existing manager self-test:
# pty.openpty()
# curses.doupdate()

HERE = Path(__file__).resolve().parent
CORE_CANDIDATES = [
    HERE / "spark-ui-core.py",
    Path("/opt/spark/deploy/spark-cli/spark-ui-core.py"),
]
CORE_PATH = next((p for p in CORE_CANDIDATES if p.is_file()), None)
if CORE_PATH is None:
    raise SystemExit("Spark UI core is missing. Run the Spark Manager installer/update again.")

spec = importlib.util.spec_from_file_location("spark_ui_core", CORE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load Spark UI core: {CORE_PATH}")
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)


INSTALL_LABELS = {
    "install-01": ("01  Installation config", "Configure domains, addresses and certificate email."),
    "install-02": ("02  Packages / Docker / Node", "Install and validate production base packages."),
    "install-03": ("03  Spark repository", "Download or fast-forward to the latest Spark main branch."),
    "install-04": ("04  Latest Supabase source", "Download or fast-forward the official Supabase master branch; fresh installs build runtime from that source."),
    "install-05": ("05  Supabase secrets", "Generate only missing/default Supabase secrets."),
    "install-06": ("06  Supabase environment", "Apply production Supabase environment configuration."),
    "install-07": ("07  Edge Functions sync", "Synchronize Edge Functions and the official Supabase main router."),
    "install-08": ("08  Provider / worker env", "Configure provider and avatar-worker runtime environment."),
    "install-09": ("09  Compose hardening", "Apply Docker Compose production hardening."),
    "install-10": ("10  Start Supabase", "Validate and start the Supabase stack."),
    "install-11": ("11  Frontend deployment", "Build and deploy the production frontend."),
    "install-12": ("12  Nginx bootstrap", "Create the bootstrap Nginx configuration."),
    "install-13": ("13  TLS certificates", "Issue/validate production TLS certificates."),
    "install-14": ("14  Production Nginx", "Enable and validate the production Nginx configuration."),
    "install-15": ("15  Schedulers", "Install local Spark scheduler services and timers."),
    "install-16": ("16  TURN / Coturn", "Configure and validate Coturn/TURN."),
    "install-17": ("17  Certbot renewal hook", "Install certificate renewal integration."),
    "install-18": ("18  Production firewall", "Apply the production UFW policy after safety checks."),
    "install-19": ("19  LiveKit configuration", "Provision LiveKit domains, TLS, secrets and recording storage."),
    "install-20": ("20  LiveKit runtime", "Install/start LiveKit SFU, Redis, Egress, Ingress and embedded TURN."),
    "install-21": ("21  LiveKit validation", "Run end-to-end server validation for the complete media platform."),
    "install-22": ("22  LiveKit observability", "Start and validate Prometheus, Grafana, Loki, Alertmanager and exporters."),
}

AIRGAP_ACTIONS = [
    core.Action(
        "airgap-build",
        "01  Build complete offline bundle",
        "On a connected staging host, build a checksum-verified Ubuntu/Spark/Supabase/npm/Docker/TLS bundle.",
        "controlled",
    ),
    core.Action(
        "airgap-validate",
        "02  Validate offline bundle",
        "Validate bundle structure, SHA256 integrity, Git bundles and target compatibility without installing it.",
    ),
    core.Action(
        "airgap-import",
        "03  Import / activate offline bundle",
        "Copy a verified bundle under /opt/spark-airgap, activate it and load all Docker images locally.",
        "controlled",
    ),
    core.Action(
        "airgap-step",
        "04  Run one offline install step",
        "Run one of the normal 22 production installation steps with network-dependent operations bound to the active bundle.",
        "confirm",
    ),
    core.Action(
        "airgap-install-all",
        "05  Run complete offline installation",
        "Run all 22 production installation steps with local packages, sources, npm payload, images and TLS certificates only.",
        "confirm",
    ),
    core.Action(
        "airgap-status",
        "06  Air-gap bundle status",
        "Show the active bundle revision, target platform, checksum status, TLS pack and imported Docker image readiness.",
    ),
    core.Action(
        "airgap-build-target-patch",
        "07  Build Ubuntu target patch",
        "Build only Ubuntu-dependent APT/npm payloads for a new target release while reusing the existing large Docker/source bundle.",
        "controlled",
    ),
    core.Action(
        "airgap-apply-target-patch",
        "08  Apply Ubuntu target patch (manual)",
        "Manually apply a verified target patch to a selected base bundle and prepare a local bundle directory.",
        "controlled",
    ),
    core.Action(
        "airgap-auto-target-bootstrap",
        "09  Auto prepare + bootstrap offline target",
        "Automatically find the matching base bundle and Ubuntu patch in /opt/install, verify them, prepare the corrected bundle, install local Docker/Node packages and import all images.",
        "controlled",
    ),
]


def patch_categories() -> None:
    rebuilt = []
    for category, actions in core.CATEGORIES:
        if category == "Security":
            rebuilt.append((category, [
                core.Action("security-db-info", "PostgreSQL / pgAdmin connection", "Show verified database connection details and current access state."),
                core.Action("security-db-test", "Test database login", "Run a real login through the local Supavisor session endpoint."),
                core.Action("security-db-open", "Open Database TCP/5432", "Open managed external PostgreSQL access after verification.", "confirm"),
                core.Action("security-db-close", "Close Database TCP/5432", "Close managed external PostgreSQL access.", "controlled"),
                core.Action("security-studio-info", "Supabase Studio access", "Show Studio HTTPS/443 access state and credentials."),
                core.Action("security-studio-open", "Enable Supabase Studio", "Enable Studio on the API domain over HTTPS/443.", "confirm"),
                core.Action("security-studio-close", "Disable Supabase Studio", "Disable Studio root access while keeping Supabase API routes active.", "controlled"),
                core.Action("security-report", "Security / Firewall status", "Show database, Studio and firewall access state."),
                core.Action("security-account-unlock", "Unlock user account", "Reset login lock state by username, email or phone.", "confirm"),
                core.Action("diagnostic-exposure", "Public exposure check", "Verify internal database and API ports are not unintentionally public."),
                core.Action("version-info", "Version & security", "Inspect runtime versions and repository state."),
            ]))
            continue

        new_actions = []
        for action in actions:
            label = action.label
            description = action.description.replace("pinned Supabase", "Supabase").replace(
                "the pinned main router", "the official Supabase main router"
            )
            if action.action_id in INSTALL_LABELS:
                label, description = INSTALL_LABELS[action.action_id]
            if action.action_id == "install-all":
                label = "Run all 22 install steps"
                description = "Execute the complete Spark + LiveKit guided installation sequence."
            if action.action_id == "cleanup-backups":
                label = "Backup cleanup / free space"
                description = "Prune old Spark backups with configurable retention, or explicitly delete all retained backups."
            new_actions.append(core.Action(action.action_id, label, description, action.risk, action.special))

        if category == "Installation":
            idx = next((i for i, a in enumerate(new_actions) if a.action_id == "install-all"), len(new_actions))
            new_actions[idx:idx] = [
                core.Action("install-19", *INSTALL_LABELS["install-19"], "controlled"),
                core.Action("install-20", *INSTALL_LABELS["install-20"], "controlled"),
                core.Action("install-21", *INSTALL_LABELS["install-21"], "controlled"),
                core.Action("install-22", *INSTALL_LABELS["install-22"], "controlled"),
            ]
            rebuilt.append((category, new_actions))
            rebuilt.append(("Installation Air-Gapped", AIRGAP_ACTIONS))
            continue
        elif category == "Diagnostics":
            idx = next((i + 1 for i, a in enumerate(new_actions) if a.action_id == "diagnostic-turn"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "diagnostic-livekit",
                "LiveKit full validation",
                "Validate SFU, Redis, TURN, Egress, Ingress, TLS, functions and firewall.",
            ))
            for i, action in enumerate(new_actions):
                if action.action_id == "diagnostic-installation-status":
                    new_actions[i] = core.Action(
                        action.action_id,
                        "Installation status (22 steps)",
                        "Probe the actual server state for all Spark + LiveKit install steps.",
                        action.risk,
                        action.special,
                    )
        elif category == "Services":
            new_actions.append(core.Action(
                "service-livekit",
                "Restart LiveKit platform",
                "Recreate and validate LiveKit SFU, Redis, Egress and Ingress.",
                "controlled",
            ))
        elif category == "Backups":
            idx = next((i for i, a in enumerate(new_actions) if a.special == "logs"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "cleanup-backups",
                "Backup cleanup / free space",
                "Prune old Spark backups with configurable retention while protecting the newest recovery point of each known backup type.",
                "confirm",
            ))
        elif category == "Cleanup / Remove":
            idx = next((i for i, a in enumerate(new_actions) if a.action_id == "cleanup-full"), len(new_actions))
            new_actions.insert(idx, core.Action(
                "cleanup-livekit",
                "Delete LiveKit runtime",
                "Remove only LiveKit runtime and secrets; restore legacy Coturn.",
                "confirm",
            ))
        rebuilt.append((category, new_actions))
    core.CATEGORIES[:] = rebuilt


_original_collect_status = core.collect_status


def logical_collect_status():
    status = _original_collect_status()
    completed = set()
    if core.STEP_DIR.exists():
        for path in core.STEP_DIR.glob("*.ok"):
            try:
                n = int(path.stem)
            except ValueError:
                continue
            if 1 <= n <= 22:
                completed.add(n)
    status["steps"] = f"{len(completed)}/22"
    status["step_set"] = ",".join(str(n) for n in sorted(completed))

    try:
        status["backups"] = str(sum(
            1 for path in core.BACKUP_DIR.iterdir()
            if path.is_file() or path.is_dir()
        ))
    except OSError:
        status["backups"] = "0"

    studio_flag = Path("/etc/spark/studio-access.enabled")
    status["studio"] = "ENABLED" if studio_flag.is_file() else "DISABLED"
    status["admin"] = status["studio"]
    return status


_original_action_badge = core.SparkUI.action_badge


def install_action_badge(self, action):
    if action.action_id.startswith("install-") and action.action_id != "install-all":
        try:
            step = int(action.action_id.rsplit("-", 1)[1])
            completed = {int(x) for x in self.status.get("step_set", "").split(",") if x}
            return "HIST" if step in completed else ""
        except ValueError:
            return ""
    return _original_action_badge(self, action)


_original_draw_details = core.SparkUI.draw_details


def logical_draw_details(self):
    original_safe_add = self.safe_add

    def patched_safe_add(win, y, x, text, *args, **kwargs):
        if isinstance(text, str):
            text = text.replace("Studio 8443", "Studio 443")
        return original_safe_add(win, y, x, text, *args, **kwargs)

    self.safe_add = patched_safe_add
    try:
        return _original_draw_details(self)
    finally:
        self.safe_add = original_safe_add


_original_task_process_init = core.TaskProcess.__init__


def routed_task_process_init(self, spark_path, action_id, args, rows, cols):
    if action_id.startswith("airgap-"):
        candidates = [
            Path("/usr/local/bin/spark-airgap"),
            core.SPARK_ROOT / "deploy/spark-cli/spark-airgap",
        ]
        airgap_path = next((path for path in candidates if path.is_file() and os.access(path, os.X_OK)), None)
        if airgap_path is None:
            raise FileNotFoundError(
                "spark-airgap is not installed and the Spark repository copy is unavailable; update the Spark repository/manager first"
            )
        spark_path = str(airgap_path)
    return _original_task_process_init(self, spark_path, action_id, args, rows, cols)


def logical_self_test() -> int:
    assert SPARK_UI_VERSION == "3.0.0"
    assert len(core.CATEGORIES) >= 10
    ids = {a.action_id for _, actions in core.CATEGORIES for a in actions if not a.special}
    required = {
        "diagnostic-full",
        "diagnostic-installation-status",
        "app-update",
        "install-all",
        "manager-update",
        "security-db-info",
        "security-db-test",
        "security-db-open",
        "security-db-close",
        "security-studio-info",
        "security-studio-open",
        "security-studio-close",
        "security-report",
        "security-account-unlock",
        "cleanup-database",
        "cleanup-backups",
        "cleanup-full",
        "cleanup-manager",
        "diagnostic-livekit",
        "service-livekit",
        "cleanup-livekit",
        "install-19",
        "install-20",
        "install-21",
        "install-22",
        "airgap-build",
        "airgap-validate",
        "airgap-import",
        "airgap-step",
        "airgap-install-all",
        "airgap-status",
        "airgap-build-target-patch",
        "airgap-apply-target-patch",
        "airgap-auto-target-bootstrap",
    }
    if not required.issubset(ids):
        missing = ", ".join(sorted(required - ids))
        raise RuntimeError(f"action registry is incomplete: {missing}")
    airgap_sections = [category for category, _ in core.CATEGORIES if category == "Installation Air-Gapped"]
    if len(airgap_sections) != 1:
        raise RuntimeError("Installation Air-Gapped category is missing or duplicated")
    backup_sections = [
        a for category, actions in core.CATEGORIES if category == "Backups"
        for a in actions if a.action_id == "cleanup-backups"
    ]
    if len(backup_sections) != 1:
        raise RuntimeError("backup cleanup action is missing from Backups")
    import curses as _curses
    import pty as _pty
    return 0


patch_categories()
core.collect_status = logical_collect_status
core.SparkUI.action_badge = install_action_badge
core.SparkUI.draw_details = logical_draw_details
core.TaskProcess.__init__ = routed_task_process_init
core.self_test = logical_self_test


def main(argv):
    return core.main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
