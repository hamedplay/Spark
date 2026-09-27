from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.state import StateStore
from roles.database.lifecycle import DatabaseImageManager, PostgresLifecycleManager, SupabaseLifecycleManager
from roles.database.schema import (
    LegacyDumpAnalyzer,
    LiveSchemaInventoryBuilder,
    OwnershipRules,
    ReadOnlyCatalog,
)
from roles.database.workflow import (
    build_database_core_install_workflow,
    build_database_images_workflow,
    build_database_postgres_workflow,
    build_database_supabase_workflow,
)

DEFAULT_PROFILE = Path("/etc/spark-manager/environments/production.yaml")
BUNDLED_PROFILE = Path(__file__).resolve().parent / "config/environments/example.production.yaml"


def profile_path(override: str | None = None) -> Path:
    if override:
        return Path(override)
    explicit = os.environ.get("SPARK_ENV_PROFILE")
    if explicit:
        return Path(explicit)
    if DEFAULT_PROFILE.is_file():
        return DEFAULT_PROFILE
    return BUNDLED_PROFILE


def context(args) -> ExecutionContext:
    path = profile_path(getattr(args, "profile", None))
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


def cmd_baseline_analyze(args) -> int:
    profile = load_environment(profile_path(args.profile))
    rules = OwnershipRules(
        owned_schemas=frozenset(profile.database.schema.owned_schemas),
        shared_schemas=frozenset(getattr(profile.database.schema, "shared_schemas", ())),
    )
    analyzer = LegacyDumpAnalyzer(rules)
    report = analyzer.analyze(args.backup)
    payload = report.to_dict()
    json_text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(json_text, encoding="utf-8")
    if args.json:
        print(json_text, end="")
    else:
        print("Spark Legacy Backup Analysis")
        print(f"Input SHA-256     {payload['source']['sha256']}")
        print(f"Input size        {payload['source']['size_bytes']} bytes")
        print(f"Statements        {payload['summary']['statements']}")
        print(f"COPY blocks       {payload['summary']['copy_blocks']}")
        print(f"COPY rows skipped {payload['summary']['copy_rows_skipped']}")
        for key, value in payload["categories"].items():
            print(f"{key:<20} {value}")
        print(f"Sensitive         {payload['security']['count']}")
        print(f"Unknown           {payload['review']['unknown_count']}")
        print(f"Unclassified      {payload['review']['unclassified_count']}")
        print(f"Result             {payload['result']}")
        print("Summary            BASELINE_EXTRACTION_REQUIRED")
    return 0 if payload["result"] in {"ANALYZED", "ANALYZED_WITH_REVIEW"} else 2


def cmd_schema_inventory(args) -> int:
    profile = load_environment(profile_path(args.profile))
    rules = OwnershipRules(
        owned_schemas=frozenset(profile.database.schema.owned_schemas),
        shared_schemas=frozenset(getattr(profile.database.schema, "shared_schemas", ())),
    )
    payload = LiveSchemaInventoryBuilder(ReadOnlyCatalog(), rules).build(profile)
    json_text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(json_text, encoding="utf-8")
    if args.json:
        print(json_text, end="")
    else:
        counts = {
            "schemas": len(payload["schemas"]),
            "tables": len(payload["tables"]),
            "columns": len(payload["columns"]),
            "constraints": len(payload["constraints"]),
            "indexes": len(payload["indexes"]),
            "functions": len(payload["functions"]),
            "triggers": len(payload["triggers"]),
            "policies": len(payload["policies"]),
            "grants": len(payload["grants"]),
            "types": len(payload["types"]),
            "sequences": len(payload["sequences"]),
            "views": len(payload["views"]),
            "extensions": len(payload["extensions"]),
            "dependencies": len(payload["dependencies"]),
            "migrations": len(payload["migration_history"]["entries"]),
        }
        print("Spark Live Canonical Schema Inventory")
        for key, value in counts.items():
            print(f"{key:<16} {value}")
        print(f"Canonical SHA-256 {payload['fingerprint']['canonical_sha256']}")
        print("Row values        NOT INCLUDED")
        print("Database writes   FORBIDDEN / READ ONLY")
    return 0


def workflow_command(builder, args) -> int:
    return print_workflow(builder().execute(context(args)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="spark-database")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("images")
    sub.add_parser("postgres-status")
    sub.add_parser("supabase-status")
    analyze = sub.add_parser("baseline-analyze")
    analyze.add_argument("backup")
    analyze.add_argument("--json", action="store_true")
    analyze.add_argument("--output")
    analyze.add_argument("--profile")
    inventory = sub.add_parser("schema-inventory")
    inventory.add_argument("--json", action="store_true")
    inventory.add_argument("--output")
    inventory.add_argument("--profile")
    for name in ("start-postgres", "start-supabase", "install"):
        child = sub.add_parser(name)
        child.add_argument("--dry-run", action="store_true")
        child.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    handlers = {
        "images": cmd_images,
        "postgres-status": cmd_postgres_status,
        "supabase-status": cmd_supabase_status,
        "baseline-analyze": cmd_baseline_analyze,
        "schema-inventory": cmd_schema_inventory,
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
