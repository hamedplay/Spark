from __future__ import annotations

import argparse
import os
from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.state import StateStore
from roles.database.lifecycle import DatabaseImageManager, PostgresLifecycleManager, SupabaseLifecycleManager
from roles.database.workflow import (
    build_database_core_install_workflow,
    build_database_images_workflow,
    build_database_postgres_workflow,
    build_database_supabase_workflow,
)

DEFAULT_PROFILE = Path("/etc/spark-manager/environments/production.yaml")


def profile_path() -> Path:
    return Path(os.environ.get("SPARK_ENV_PROFILE", str(DEFAULT_PROFILE)))


def context(args) -> ExecutionContext:
    path = profile_path()
    profile = load_environment(path)
    return ExecutionContext(
        environment=profile.name,
        mode=profile.mode,
        dry_run=bool(getattr(args, "dry_run", False)),
        resume=bool(getattr(args, "resume", False)),
        variables={"environment_profile": str(path)},
        state=StateStore(),
    )


def print_workflow(result) -> int:
    for task_id, task in result.results.items():
        print(f"{task_id:<24} {task.status.value.upper():<8} {task.message}")
    return 0 if result.ok else 1


def cmd_images(_args) -> int:
    profile = load_environment(profile_path())
    inventory = DatabaseImageManager().inventory(profile)
    for item in inventory:
        print(f"{item.service:<18} {'PRESENT' if item.present else 'MISSING':<8} {item.reference}")
    return 0 if inventory and all(item.present for item in inventory) else 1


def cmd_postgres_status(_args) -> int:
    profile = load_environment(profile_path())
    state = PostgresLifecycleManager().detect(profile, with_probes=True)
    print(f"PostgreSQL       {state.state.value}")
    print(f"Data             {'PRESENT' if state.data_present else 'EMPTY'}")
    print(f"Data version     {state.data_version or 'N/A'}")
    print(f"Docker health    {state.docker_health or 'N/A'}")
    print(f"pg_isready       {state.pg_isready if state.pg_isready is not None else 'NOT_TESTED'}")
    print(f"SQL probe        {state.sql_probe if state.sql_probe is not None else 'NOT_TESTED'}")
    return 0 if state.state.value == "HEALTHY" else 1


def cmd_supabase_status(_args) -> int:
    profile = load_environment(profile_path())
    aggregate, states = SupabaseLifecycleManager().detect(profile)
    print(f"Supabase         {aggregate.value}")
    for state in states:
        print(f"{state.capability.value:<18} {state.state.value:<10} {state.service_name}")
    return 0 if aggregate.value == "HEALTHY" else 1


def workflow_command(builder, args) -> int:
    return print_workflow(builder().execute(context(args)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="spark-database")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("images")
    sub.add_parser("postgres-status")
    sub.add_parser("supabase-status")
    for name in ("start-postgres", "start-supabase", "install"):
        child = sub.add_parser(name)
        child.add_argument("--dry-run", action="store_true")
        child.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    handlers = {
        "images": cmd_images,
        "postgres-status": cmd_postgres_status,
        "supabase-status": cmd_supabase_status,
        "start-postgres": lambda value: workflow_command(build_database_postgres_workflow, value),
        "start-supabase": lambda value: workflow_command(build_database_supabase_workflow, value),
        "install": lambda value: workflow_command(build_database_core_install_workflow, value),
    }
    try:
        return handlers[args.command](args)
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
