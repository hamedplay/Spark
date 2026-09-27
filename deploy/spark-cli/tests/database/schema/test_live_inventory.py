from __future__ import annotations

import json
import unittest

from config.models import EnvironmentConfig
from roles.database.schema.catalog import assert_read_only_query
from roles.database.schema.live_inventory import LiveSchemaInventoryBuilder, QUERIES, canonical_fingerprint
from roles.database.schema.models import Ownership
from roles.database.schema.ownership import resolve_schema_ownership
from roles.database.schema.rules import OwnershipRules


class FakeCatalog:
    def __init__(self, responses: dict[str, list[dict]]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def query(self, _profile, sql: str, *, timeout: int = 120) -> list[dict]:
        del timeout
        name = next(key for key, value in QUERIES.items() if value == sql)
        self.calls.append(name)
        return list(self.responses.get(name, []))


class LiveInventoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = EnvironmentConfig(name="test")
        self.rules = OwnershipRules(
            owned_schemas=frozenset({"public"}),
            shared_schemas=frozenset({"application"}),
        )

    def test_read_only_guard_rejects_mutation(self) -> None:
        assert_read_only_query("SELECT * FROM pg_class")
        assert_read_only_query("WITH x AS (SELECT 1) SELECT * FROM x")
        for sql in (
            "CREATE TABLE x(id int)",
            "SELECT 1; DROP TABLE x",
            "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
            "SELECT 1; GRANT SELECT ON t TO anon",
        ):
            with self.assertRaises(ValueError):
                assert_read_only_query(sql)

    def test_ownership_precedence_supports_shared(self) -> None:
        overlapping = OwnershipRules(
            owned_schemas=frozenset({"public", "auth"}),
            shared_schemas=frozenset({"application", "auth"}),
        )
        self.assertEqual(resolve_schema_ownership("auth", overlapping), Ownership.PLATFORM_OWNED)
        self.assertEqual(resolve_schema_ownership("application", overlapping), Ownership.SHARED)
        self.assertEqual(resolve_schema_ownership("public", overlapping), Ownership.SPARK_OWNED)
        self.assertEqual(resolve_schema_ownership("private", overlapping), Ownership.UNCLASSIFIED)

    def test_inventory_has_no_row_values_and_is_deterministic(self) -> None:
        responses = {
            "schemas": [
                {"schema_name": "public"}, {"schema_name": "auth"},
                {"schema_name": "private"}, {"schema_name": "application"},
            ],
            "tables": [
                {"schema_name": "public", "table_name": "profiles", "rls_enabled": True, "rls_forced": False, "persistence": "p"},
                {"schema_name": "public", "table_name": "sms_providers", "rls_enabled": True, "rls_forced": False, "persistence": "p"},
            ],
            "columns": [
                {"schema_name": "public", "table_name": "profiles", "column_name": "user_id", "ordinal_position": 1, "data_type": "uuid", "nullable": False, "default_expression": None, "identity_kind": "", "generated_kind": ""},
            ],
            "constraints": [
                {"schema_name": "public", "table_name": "profiles", "constraint_name": "profiles_user_id_fkey", "constraint_type": "f", "definition": "FOREIGN KEY (user_id) REFERENCES auth.users(id)", "referenced_schema": "auth", "referenced_table": "users"},
            ],
            "indexes": [],
            "functions": [
                {"schema_name": "public", "function_name": "whoami", "identity_arguments": "", "return_type": "uuid", "language": "sql", "volatility": "STABLE", "security": "DEFINER", "owner": "postgres", "search_path": "public, pg_temp", "definition_sha256": "abc"},
            ],
            "function_dependencies": [],
            "function_qualified_refs": [
                {"source_schema": "public", "source_name": "whoami", "identity_arguments": "", "referenced_schema": "auth", "referenced_object": "uid", "evidence": "definition_qualified_reference"},
            ],
            "triggers": [],
            "policies": [
                {"schema_name": "public", "table_name": "profiles", "policy_name": "self", "permissive": "PERMISSIVE", "roles": ["authenticated"], "command": "SELECT", "using_expression": "(auth.uid() = user_id)", "with_check_expression": None},
            ],
            "grants": [
                {"schema_name": "public", "object_name": "profiles", "object_type": "table", "grantee": "authenticated", "privilege": "SELECT", "grantor": "postgres", "is_grantable": "NO"},
            ],
            "types": [], "sequences": [],
            "views": [], "view_dependencies": [],
            "extensions": [{"name": "pgcrypto", "version": "1.3", "schema_name": "extensions"}],
            "migration_history": [
                {"version": "1", "name": "initial", "created_by": None, "statement_count": 2, "statements_sha256": "deadbeef", "rollback_statement_count": 0, "has_idempotency_key": False},
            ],
            "data_inventory": [
                {"schema_name": "public", "table_name": "sms_providers", "row_count_estimate": 4, "contains_data_estimate": True},
            ],
        }
        catalog = FakeCatalog(responses)
        payload = LiveSchemaInventoryBuilder(catalog, self.rules).build(self.profile)
        self.assertEqual(payload["schemas"]["auth"]["ownership"], "platform_owned")
        self.assertEqual(payload["schemas"]["application"]["ownership"], "shared")
        self.assertEqual(payload["schemas"]["private"]["ownership"], "unclassified")
        self.assertEqual(payload["tables"]["public.profiles"]["ownership"], "spark_owned")
        self.assertEqual(payload["functions"]["public.whoami()"]["security"], "DEFINER")
        self.assertEqual(payload["functions"]["public.whoami()"]["search_path"], "public, pg_temp")
        self.assertEqual(payload["data_inventory"]["public.sms_providers"]["classification"], "sensitive_configuration")
        self.assertFalse(payload["data_inventory"]["public.sms_providers"]["values_included"])
        text = json.dumps(payload, sort_keys=True)
        self.assertNotIn("password-value", text)
        self.assertIn("auth.users", {d["target"] for d in payload["dependencies"]})
        self.assertEqual(payload["migration_history"]["source"], "supabase_migrations.schema_migrations")
        self.assertFalse(payload["migration_history"]["imported_into_spark_manager"])
        self.assertEqual(payload["fingerprint"]["canonical_sha256"], canonical_fingerprint(payload))

    def test_fingerprint_excludes_data_history_grantor_and_function_owner(self) -> None:
        empty = {name: [] for name in QUERIES}
        first = LiveSchemaInventoryBuilder(FakeCatalog(empty), self.rules).build(self.profile)
        second = json.loads(json.dumps(first))
        second["data_inventory"]["x"] = {"row_count_estimate": 999, "contains_data_estimate": True, "values_included": False}
        second["migration_history"]["entries"].append({"version": "future"})
        self.assertEqual(canonical_fingerprint(first), canonical_fingerprint(second))

        with_owner = json.loads(json.dumps(first))
        with_owner["functions"] = {
            "public.f()": {"owner": "old_postgres", "security": "INVOKER", "definition_sha256": "abc"}
        }
        other_owner = json.loads(json.dumps(with_owner))
        other_owner["functions"]["public.f()"]["owner"] = "new_postgres"
        self.assertEqual(canonical_fingerprint(with_owner), canonical_fingerprint(other_owner))


if __name__ == "__main__":
    unittest.main()
