from __future__ import annotations

import argparse
import os

from .controller import run_action

COMMANDS = {
    "revision": "architecture-revision",
    "show": "architecture-overview",
    "profile": "architecture-profile",
    "validate": "architecture-validate",
    "network-check": "architecture-network",
    "role-health": "architecture-role-health",
    "status": "architecture-status",
    "install-database": "architecture-install-database",
    "install-application": "architecture-install-application",
    "install-proxy": "architecture-install-proxy",
    "install-full": "architecture-install-full",
    "resume": "architecture-resume",
    "validate-environment": "architecture-validate-environment",
    "repair": "architecture-repair",
    "production-plan": "architecture-central-plan",
    "production-status": "architecture-central-status",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="spark-architecture")
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--profile", help="Environment profile path")
    parser.add_argument("--dry-run", action="store_true", help="Plan only; perform zero provisioning mutation")
    parser.add_argument("--resume", action="store_true", help="Resume and reverify previously completed lifecycle tasks")
    parser.add_argument("--centralized", action="store_true", help="Run production orchestration from the configured Jump/Management node")
    args = parser.parse_args(argv)
    if args.profile:
        os.environ["SPARK_ENV_PROFILE"] = args.profile
    result = run_action(
        COMMANDS[args.command],
        dry_run=args.dry_run,
        resume=args.resume,
        centralized=args.centralized,
    )
    print(result.title)
    print("=" * len(result.title))
    for line in result.lines:
        print(line)
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
