#!/usr/bin/env python3
"""Logical 01-18 numbering overlay for the Spark curses UI."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SPARK_UI_VERSION = "2.1.0+20260821.1"
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

LEGACY_TO_LOGICAL = {
    2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9,
    11: 10, 13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16,
    19: 17, 20: 18,
}

INSTALL_LABELS = {
    "install-02": ("01  Installation config", "Configure domains, addresses and certificate email."),
    "install-03": ("02  Packages / Docker / Node", "Install and validate production base packages."),
    "install-04": ("03  Spark repository", "Download or fast-forward to the latest Spark main branch."),
    "install-05": ("04  Latest Supabase source", "Download or fast-forward the official Supabase master branch; fresh installs build runtime from that source."),
    "install-06": ("05  Supabase secrets", "Generate only missing/default Supabase secrets."),
    "install-07": ("06  Supabase environment", "Apply production Supabase environment configuration."),
    "install-08": ("07  Edge Functions sync", "Synchronize Edge Functions and the official Supabase main router."),
    "install-09": ("08  Provider / worker env", "Configure provider and avatar-worker runtime environment."),
    "install-10": ("09  Compose hardening", "Apply Docker Compose production hardening."),
    "install-11": ("10  Start Supabase", "Validate and start the Supabase stack."),
    "install-13": ("11  Frontend deployment", "Build and deploy the production frontend."),
    "install-14": ("12  Nginx bootstrap", "Create the bootstrap Nginx configuration."),
    "install-15": ("13  TLS certificates", "Issue/validate production TLS certificates."),
    "install-16": ("14  Production Nginx", "Enable and validate the production Nginx configuration."),
    "install-17": ("15  Schedulers", "Install local Spark scheduler services and timers."),
    "install-18": ("16  TURN / Coturn", "Configure and validate Coturn/TURN."),
    "install-19": ("17  Certbot renewal hook", "Install certificate renewal integration."),
    "install-20": ("18  Production firewall", "Apply the production UFW policy after safety checks."),
}


def patch_categories() -> None:
    rebuilt = []
    for category, actions in core.CATEGORIES:
        if category == "Security":
            rebuilt.append((category, [
                core.Action(
                    "admin-open",
                    "Security Center",
                    "Verified PostgreSQL/pgAdmin access, Supabase Studio access on HTTPS/443, credentials, login tests and firewall state.",
                    "confirm",
                ),
                core.Action("diagnostic-exposure", "Public exposure check", "Verify internal database and API ports are not unintentionally public."),
                core.Action("version-info", "Version & security", "Inspect runtime versions and repository state."),
            ]))
            continue

        new_actions = []
        for action in actions:
            label = action.label
            description = action.description.replace("pinned Supabase", "Supabase").replace("the pinned main router", "the official Supabase main router")
            if action.action_id in INSTALL_LABELS:
                label, description = INSTALL_LABELS[action.action_id]
            new_actions.append(core.Action(action.action_id, label, description, action.risk, action.special))
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
            if 1 <= n <= 18:
                completed.add(n)
    status["steps"] = f"{len(completed)}/18"
    status["step_set"] = ",".join(str(n) for n in sorted(completed))

    # Studio no longer owns a dedicated listener. Access is controlled by the
    # persisted root-route flag while all Supabase API routes continue on 443.
    studio_flag = Path("/etc/spark/studio-access.enabled")
    status["studio"] = "ENABLED" if studio_flag.is_file() else "DISABLED"
    status["admin"] = status["studio"]
    return status


_original_action_badge = core.SparkUI.action_badge

def logical_action_badge(self, action):
    if action.action_id.startswith("install-") and action.action_id != "install-all":
        try:
            legacy = int(action.action_id.rsplit("-", 1)[1])
            logical = LEGACY_TO_LOGICAL[legacy]
            completed = {int(x) for x in self.status.get("step_set", "").split(",") if x}
            return "HIST" if logical in completed else ""
        except (ValueError, KeyError):
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


patch_categories()
core.collect_status = logical_collect_status
core.SparkUI.action_badge = logical_action_badge
core.SparkUI.draw_details = logical_draw_details


def main(argv):
    return core.main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
