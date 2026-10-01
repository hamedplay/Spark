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
SPARK_UI_VERSION = "3.1.0+20260910.1"
# Compatibility markers required by the stable bootstrap contract. The actual
# PTY backend and differential curses refresh are implemented by the UI base/core.
# pty.openpty()
# curses.doupdate()


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
if base.SPARK_UI_VERSION != SPARK_UI_VERSION:
    raise RuntimeError(
        f"Spark UI version mismatch: wrapper={SPARK_UI_VERSION} base={base.SPARK_UI_VERSION}"
    )

MANAGER_OFFLINE_ACTIONS = [
    core.Action(
        "manager-airgap-build",
        "Build Manager Offline Update",
        "Build an offline Spark + Manager update bundle from the latest fetched main source.",
        "controlled",
    ),
    core.Action(
        "manager-airgap-install-environment",
        "Update Manager — Offline",
        "Install or update Spark and Spark Manager from one offline bundle across the configured environment.",
        "confirm",
    ),
]

FINAL_MAIN_CATEGORIES = [
    "Installation Internet",
    "Installation Air-Gap",
    "Diagnostics",
    "Security",
    "Backups",
    "Cleanup / Remove",
    "Application",
    "Database",
    "Linux System",
    "Manager",
]

DATABASE_ACTION_IDS = {
    "security-db-info",
    "security-db-test",
    "security-db-open",
    "security-db-close",
    "security-studio-info",
    "security-studio-open",
    "security-studio-close",
}


def _manager_actions(actions):
    rebuilt = []
    for action in actions:
        if action.action_id.startswith("manager-airgap-"):
            continue
        if action.action_id == "manager-update":
            rebuilt.append(core.Action(
                action.action_id,
                "Update Manager — Internet",
                action.description,
                action.risk,
                action.special,
            ))
        elif action.action_id == "@recent-logs":
            rebuilt.append(core.Action(
                action.action_id,
                "Recent Manager Logs",
                action.description,
                action.risk,
                action.special,
            ))
        else:
            rebuilt.append(action)
    return [*MANAGER_OFFLINE_ACTIONS, *rebuilt]


def _fix_cleanup_actions(actions):
    fixed = []
    for action in actions:
        if action.action_id == "backup-restore-plain" and action.label == "cleanup-backups":
            fixed.append(core.Action(
                "cleanup-backups",
                "Backup cleanup / free space",
                "Safely prune old Spark backups with a configurable retention period, or explicitly delete all retained backups.",
                "confirm",
            ))
        else:
            fixed.append(action)
    return fixed


def _extend_categories() -> None:
    # Normalize the stable/base registry first. Only the ten approved top-level
    # categories are exposed by the final Manager UI. Removed categories keep
    # their backend actions for compatibility, but they are no longer reachable
    # from the main menu.
    by_name = {}
    for category, actions in core.CATEGORIES:
        normalized = category
        if category == "Installation":
            normalized = "Installation Internet"
        elif category in ("Installation Air-Gapped", "Installation Air-Gap"):
            normalized = "Installation Air-Gap"
        elif category == "System":
            normalized = "Linux System"
        by_name[normalized] = list(actions)

    installation = by_name.get("Installation Internet", [])
    airgap = [
        action for action in by_name.get("Installation Air-Gap", [])
        if not action.action_id.startswith("manager-airgap-")
    ]
    diagnostics = by_name.get("Diagnostics", [])
    backups = by_name.get("Backups", [])
    cleanup = _fix_cleanup_actions(by_name.get("Cleanup / Remove", []))
    application = by_name.get("Application", [])
    linux_system = by_name.get("Linux System", [])
    manager = _manager_actions(by_name.get("Manager", []))

    original_security = by_name.get("Security", [])
    database = [action for action in original_security if action.action_id in DATABASE_ACTION_IDS]
    security = [action for action in original_security if action.action_id not in DATABASE_ACTION_IDS]

    core.CATEGORIES[:] = [
        ("Installation Internet", installation),
        ("Installation Air-Gap", airgap),
        ("Diagnostics", diagnostics),
        ("Security", security),
        ("Backups", backups),
        ("Cleanup / Remove", cleanup),
        ("Application", application),
        ("Database", database),
        ("Linux System", linux_system),
        ("Manager", manager),
    ]


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

    categories = [category for category, _ in core.CATEGORIES]
    if categories != FINAL_MAIN_CATEGORIES:
        raise RuntimeError(
            "Spark Manager main menu mismatch: "
            f"expected={FINAL_MAIN_CATEGORIES!r} actual={categories!r}"
        )
    if len(categories) != len(set(categories)):
        raise RuntimeError("Spark Manager main menu contains duplicate categories")

    manager_actions = [a for category, actions in core.CATEGORIES if category == "Manager" for a in actions]
    manager_labels = {a.action_id: a.label for a in manager_actions}
    expected_manager_labels = {
        "manager-airgap-build": "Build Manager Offline Update",
        "manager-airgap-install-environment": "Update Manager — Offline",
        "manager-update": "Update Manager — Internet",
        "@recent-logs": "Recent Manager Logs",
    }
    for action_id, label in expected_manager_labels.items():
        if manager_labels.get(action_id) != label:
            raise RuntimeError(f"Manager UI action mismatch for {action_id}: {manager_labels.get(action_id)!r}")

    airgap_ids = {
        a.action_id
        for category, actions in core.CATEGORIES
        if category == "Installation Air-Gap"
        for a in actions
    }
    if any(action_id.startswith("manager-airgap-") for action_id in airgap_ids):
        raise RuntimeError("Manager offline actions leaked into Installation Air-Gap")

    security_ids = {
        a.action_id
        for category, actions in core.CATEGORIES
        if category == "Security"
        for a in actions
    }
    database_ids = {
        a.action_id
        for category, actions in core.CATEGORIES
        if category == "Database"
        for a in actions
    }
    if security_ids & DATABASE_ACTION_IDS:
        raise RuntimeError("Database actions leaked into Security")
    missing_database = DATABASE_ACTION_IDS - database_ids
    if missing_database:
        raise RuntimeError("Database category is incomplete: " + ", ".join(sorted(missing_database)))

    cleanup_actions = [a for category, actions in core.CATEGORIES if category == "Cleanup / Remove" for a in actions]
    if any(a.action_id == "backup-restore-plain" for a in cleanup_actions):
        raise RuntimeError("database restore action leaked into Cleanup / Remove")
    if len([a for a in cleanup_actions if a.action_id == "cleanup-backups"]) != 1:
        raise RuntimeError("Cleanup / Remove must contain exactly one cleanup-backups action")

    forbidden = {"Overview", "Architecture & Provisioning", "Services", "Certificates", "Node / npm"}
    leaked = forbidden & set(categories)
    if leaked:
        raise RuntimeError("Removed main-menu categories still visible: " + ", ".join(sorted(leaked)))

    spark_entry = HERE / "spark"
    if spark_entry.is_file() and "install-22)" not in spark_entry.read_text(encoding="utf-8"):
        raise RuntimeError("Spark backend does not expose install-22")
    return result


_extend_categories()
core.TaskProcess.__init__ = manager_routed_task_init
core.self_test = provisioning_self_test


def main(argv: list[str]) -> int:
    return base.main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
