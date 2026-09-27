from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from config.models import EnvironmentConfig
from .catalog import ReadOnlyCatalog
from .models import Ownership
from .ownership import resolve_schema_ownership
from .rules import OwnershipRules


SENSITIVE_CONFIGURATION_TABLES = frozenset({
    "public.hr_sso_config",
    "public.rahyab_settings",
    "public.sms_providers",
    "public.social_channel_configs",
    "public.spark_ai_settings",
})


QUERIES: dict[str, str] = {
    "schemas": """
        SELECT n.nspname AS schema_name
        FROM pg_namespace n
        WHERE n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp_%'
        ORDER BY n.nspname
    """,
    "tables": """
        SELECT n.nspname AS schema_name, c.relname AS table_name,
               c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
               c.relpersistence AS persistence
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY n.nspname,c.relname
    """,
    "columns": """
        SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
               a.attnum AS ordinal_position, pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
               NOT a.attnotnull AS nullable,
               pg_get_expr(ad.adbin,ad.adrelid) AS default_expression,
               a.attidentity AS identity_kind, a.attgenerated AS generated_kind
        FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY n.nspname,c.relname,a.attnum
    """,
    "constraints": """
        SELECT ns.nspname AS schema_name, cls.relname AS table_name, con.conname AS constraint_name,
               con.contype AS constraint_type, pg_get_constraintdef(con.oid,true) AS definition,
               fns.nspname AS referenced_schema, fcls.relname AS referenced_table
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid=con.conrelid
        JOIN pg_namespace ns ON ns.oid=cls.relnamespace
        LEFT JOIN pg_class fcls ON fcls.oid=con.confrelid
        LEFT JOIN pg_namespace fns ON fns.oid=fcls.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog','information_schema')
          AND ns.nspname NOT LIKE 'pg_toast%'
        ORDER BY ns.nspname,cls.relname,con.conname
    """,
    "indexes": """
        SELECT ns.nspname AS schema_name, tbl.relname AS table_name, idx.relname AS index_name,
               i.indisunique AS is_unique, i.indisprimary AS is_primary,
               pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class tbl ON tbl.oid=i.indrelid
        JOIN pg_class idx ON idx.oid=i.indexrelid
        JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog','information_schema')
          AND ns.nspname NOT LIKE 'pg_toast%'
        ORDER BY ns.nspname,tbl.relname,idx.relname
    """,
    "functions": """
        SELECT n.nspname AS schema_name, p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               pg_get_function_result(p.oid) AS return_type,
               l.lanname AS language,
               CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END AS volatility,
               CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
               r.rolname AS owner,
               COALESCE((SELECT substring(x FROM 13) FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) x WHERE x LIKE 'search_path=%' LIMIT 1),'') AS search_path,
               encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS definition_sha256
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_language l ON l.oid=p.prolang
        JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)
    """,
    "function_dependencies": """
        SELECT DISTINCT pn.nspname AS source_schema, p.proname AS source_name,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               rn.nspname AS referenced_schema, rc.relname AS referenced_object,
               'catalog'::text AS evidence
        FROM pg_proc p
        JOIN pg_namespace pn ON pn.oid=p.pronamespace
        JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid
        JOIN pg_class rc ON rc.oid=d.refobjid
        JOIN pg_namespace rn ON rn.oid=rc.relnamespace
        WHERE pn.nspname NOT IN ('pg_catalog','information_schema')
          AND rn.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY pn.nspname,p.proname,identity_arguments,rn.nspname,rc.relname
    """,
    "function_qualified_refs": """
        SELECT DISTINCT n.nspname AS source_schema, p.proname AS source_name,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               (m)[1] AS referenced_schema, (m)[2] AS referenced_object,
               'definition_qualified_reference'::text AS evidence
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid),
          '\\m(auth|storage|realtime|public|private)\\.([A-Za-z_][A-Za-z0-9_]*)', 'g') AS m
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY source_schema,source_name,identity_arguments,referenced_schema,referenced_object
    """,
    "triggers": """
        SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
               pn.nspname AS function_schema, p.proname AS function_name,
               pg_get_triggerdef(t.oid,true) AS definition
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid
        JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY n.nspname,c.relname,t.tgname
    """,
    "policies": """
        SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
               permissive, roles, cmd AS command, qual AS using_expression, with_check AS with_check_expression
        FROM pg_policies
        WHERE schemaname NOT IN ('pg_catalog','information_schema')
        ORDER BY schemaname,tablename,policyname
    """,
    "grants": """
        SELECT table_schema AS schema_name, table_name AS object_name, 'table'::text AS object_type,
               grantee, privilege_type AS privilege, grantor, is_grantable
        FROM information_schema.role_table_grants
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        UNION ALL
        SELECT routine_schema, routine_name, 'function', grantee, privilege_type, grantor, is_grantable
        FROM information_schema.role_routine_grants
        WHERE routine_schema NOT IN ('pg_catalog','information_schema')
        UNION ALL
        SELECT object_schema, object_name, 'sequence', grantee, privilege_type, grantor, is_grantable
        FROM information_schema.role_usage_grants
        WHERE object_type='SEQUENCE' AND object_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY 1,2,3,4,5
    """,
    "types": """
        SELECT n.nspname AS schema_name, t.typname AS type_name,
               CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' WHEN 'c' THEN 'composite' ELSE t.typtype::text END AS type_kind,
               CASE WHEN t.typtype='e' THEN (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid) ELSE NULL END AS enum_values,
               CASE WHEN t.typtype='d' THEN pg_catalog.format_type(t.typbasetype,t.typtypmod) ELSE NULL END AS base_type
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE t.typtype IN ('e','d','c')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype=t.oid AND c.relkind IN ('r','p','v','m','S'))
        ORDER BY n.nspname,t.typname
    """,
    "sequences": """
        SELECT n.nspname AS schema_name, c.relname AS sequence_name,
               tn.nspname AS owned_by_schema, tc.relname AS owned_by_table, a.attname AS owned_by_column
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')
        LEFT JOIN pg_class tc ON tc.oid=d.refobjid
        LEFT JOIN pg_namespace tn ON tn.oid=tc.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=d.refobjsubid
        WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY n.nspname,c.relname
    """,
    "views": """
        SELECT n.nspname AS schema_name, c.relname AS view_name,
               CASE c.relkind WHEN 'm' THEN 'materialized' ELSE 'view' END AS view_type,
               encode(sha256(convert_to(pg_get_viewdef(c.oid,true),'UTF8')),'hex') AS definition_sha256
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('v','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY n.nspname,c.relname
    """,
    "view_dependencies": """
        SELECT DISTINCT vn.nspname AS source_schema, v.relname AS source_name,
               rn.nspname AS referenced_schema, r.relname AS referenced_object,
               'catalog'::text AS evidence
        FROM pg_class v
        JOIN pg_namespace vn ON vn.oid=v.relnamespace
        JOIN pg_rewrite rw ON rw.ev_class=v.oid
        JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
        JOIN pg_class r ON r.oid=d.refobjid
        JOIN pg_namespace rn ON rn.oid=r.relnamespace
        WHERE v.relkind IN ('v','m') AND r.oid<>v.oid
          AND vn.nspname NOT IN ('pg_catalog','information_schema')
          AND rn.nspname NOT IN ('pg_catalog','information_schema')
        ORDER BY source_schema,source_name,referenced_schema,referenced_object
    """,
    "extensions": """
        SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema_name
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
        ORDER BY e.extname
    """,
    "migration_history": """
        SELECT version, name, created_by,
               COALESCE(cardinality(statements),0) AS statement_count,
               CASE WHEN statements IS NULL THEN NULL ELSE encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex') END AS statements_sha256,
               COALESCE(cardinality(rollback),0) AS rollback_statement_count,
               idempotency_key IS NOT NULL AS has_idempotency_key
        FROM supabase_migrations.schema_migrations
        ORDER BY version
    """,
    "data_inventory": """
        SELECT n.nspname AS schema_name, c.relname AS table_name,
               GREATEST(c.reltuples::bigint,0) AS row_count_estimate,
               c.reltuples>0 AS contains_data_estimate
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY n.nspname,c.relname
    """,
}


@dataclass
class LiveSchemaInventoryBuilder:
    catalog: ReadOnlyCatalog
    rules: OwnershipRules

    def _ownership(self, schema: str) -> str:
        return resolve_schema_ownership(schema, self.rules).value

    @staticmethod
    def _qualified(row: dict, name_key: str) -> str:
        return f"{row.get('schema_name')}.{row.get(name_key)}"

    def build(self, profile: EnvironmentConfig) -> dict:
        raw = {name: self.catalog.query(profile, query) for name, query in QUERIES.items()}
        schemas = {
            row["schema_name"]: {"ownership": self._ownership(row["schema_name"])}
            for row in raw["schemas"]
        }
        tables = {}
        for row in raw["tables"]:
            key = self._qualified(row, "table_name")
            tables[key] = {**row, "ownership": self._ownership(row["schema_name"])}
        functions = {}
        for row in raw["functions"]:
            key = f"{row['schema_name']}.{row['function_name']}({row['identity_arguments']})"
            functions[key] = {**row, "ownership": self._ownership(row["schema_name"])}
        views = {}
        for row in raw["views"]:
            key = self._qualified(row, "view_name")
            views[key] = {**row, "ownership": self._ownership(row["schema_name"])}
        dependencies = []
        for row in raw["constraints"]:
            if row.get("referenced_schema"):
                dependencies.append({
                    "source": f"{row['schema_name']}.{row['table_name']}",
                    "target": f"{row['referenced_schema']}.{row['referenced_table']}",
                    "kind": "foreign_key" if row.get("constraint_type") == "f" else "constraint_reference",
                    "evidence": row["constraint_name"],
                })
        for source in ("function_dependencies", "function_qualified_refs", "view_dependencies"):
            for row in raw[source]:
                identity = row.get("identity_arguments")
                src = f"{row['source_schema']}.{row['source_name']}" + (f"({identity})" if identity is not None else "")
                dependencies.append({
                    "source": src,
                    "target": f"{row['referenced_schema']}.{row['referenced_object']}",
                    "kind": "function_reference" if source.startswith("function") else "view_reference",
                    "evidence": row["evidence"],
                })
        dependencies = sorted(dependencies, key=lambda x: (x["source"], x["target"], x["kind"], x["evidence"]))
        data_inventory = {}
        for row in raw["data_inventory"]:
            key = self._qualified(row, "table_name")
            data_inventory[key] = {
                "row_count_estimate": row["row_count_estimate"],
                "contains_data_estimate": row["contains_data_estimate"],
                "classification": "sensitive_configuration" if key in SENSITIVE_CONFIGURATION_TABLES else "application_or_platform_data",
                "values_included": False,
            }
        payload = {
            "format_version": 1,
            "schemas": dict(sorted(schemas.items())),
            "tables": dict(sorted(tables.items())),
            "columns": sorted(raw["columns"], key=lambda x: (x["schema_name"], x["table_name"], x["ordinal_position"])),
            "constraints": sorted(raw["constraints"], key=lambda x: (x["schema_name"], x["table_name"], x["constraint_name"])),
            "indexes": sorted(raw["indexes"], key=lambda x: (x["schema_name"], x["table_name"], x["index_name"])),
            "functions": dict(sorted(functions.items())),
            "triggers": sorted(raw["triggers"], key=lambda x: (x["schema_name"], x["table_name"], x["trigger_name"])),
            "policies": sorted(raw["policies"], key=lambda x: (x["schema_name"], x["table_name"], x["policy_name"])),
            "grants": sorted(raw["grants"], key=lambda x: (x["schema_name"], x["object_name"], x["object_type"], x["grantee"], x["privilege"])),
            "types": sorted(raw["types"], key=lambda x: (x["schema_name"], x["type_name"])),
            "sequences": sorted(raw["sequences"], key=lambda x: (x["schema_name"], x["sequence_name"])),
            "views": dict(sorted(views.items())),
            "extensions": sorted(raw["extensions"], key=lambda x: x["name"]),
            "dependencies": dependencies,
            "migration_history": {
                "source": "supabase_migrations.schema_migrations",
                "entries": raw["migration_history"],
                "imported_into_spark_manager": False,
            },
            "data_inventory": dict(sorted(data_inventory.items())),
        }
        payload["fingerprint"] = {"canonical_sha256": canonical_fingerprint(payload)}
        return payload


def canonical_fingerprint(payload: dict) -> str:
    grants = [
        {k: v for k, v in item.items() if k != "grantor"}
        for item in payload["grants"]
    ]
    canonical = {
        key: payload[key]
        for key in (
            "schemas", "tables", "columns", "constraints", "indexes", "functions", "triggers",
            "policies", "types", "sequences", "views", "extensions", "dependencies",
        )
    }
    canonical["grants"] = grants
    encoded = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
