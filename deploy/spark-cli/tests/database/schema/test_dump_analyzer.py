from __future__ import annotations

import io
import json
import tempfile
import tracemalloc
import unittest
from pathlib import Path

from roles.database.schema import AnalysisResult, LegacyDumpAnalyzer, Ownership, OwnershipRules, StatementCategory
from roles.database.schema.dump_analyzer import analyze_statement
from roles.database.schema.parser import iter_statements

FIXTURES = Path(__file__).with_name("fixtures")


class M36AParserTests(unittest.TestCase):
    def test_dollar_quoted_function_is_one_statement(self):
        with (FIXTURES / "dollar_quoted_function.sql").open() as handle:
            items = list(iter_statements(handle))
        self.assertEqual(len(items), 1)
        self.assertIn("PERFORM 1;", items[0].text)
        self.assertIn("PERFORM 2;", items[0].text)

    def test_copy_payload_is_skipped_and_not_exposed(self):
        with (FIXTURES / "copy_large.sql").open() as handle:
            items = list(iter_statements(handle))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].kind, "copy")
        self.assertEqual(items[0].copy_rows_skipped, 3)
        self.assertNotIn("alpha", items[0].text)
        self.assertNotIn("gamma", items[0].text)

    def test_comments_and_quoted_semicolons_do_not_split(self):
        with (FIXTURES / "comments.sql").open() as handle:
            items = list(iter_statements(handle))
        self.assertEqual(len(items), 1)
        self.assertIn("semi;colon", items[0].text)

    def test_psql_meta_commands_are_independent(self):
        with (FIXTURES / "psql_meta_commands.sql").open() as handle:
            items = list(iter_statements(handle))
        self.assertEqual([item.kind for item in items], ["meta", "meta", "sql"])

    def test_streaming_copy_memory_is_bounded(self):
        class GeneratedCopy(io.TextIOBase):
            def __init__(self, rows: int):
                self.rows = rows
                self.index = -1
            def __iter__(self):
                return self
            def __next__(self):
                self.index += 1
                if self.index == 0:
                    return "COPY public.events (id, payload) FROM stdin;\n"
                if 1 <= self.index <= self.rows:
                    return f"{self.index}\tpayload-{self.index}\n"
                if self.index == self.rows + 1:
                    return "\\.\n"
                raise StopIteration
        tracemalloc.start()
        items = list(iter_statements(GeneratedCopy(200_000)))
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        self.assertEqual(items[0].copy_rows_skipped, 200_000)
        self.assertLess(peak, 8 * 1024 * 1024)


class M36AAnalyzerTests(unittest.TestCase):
    def rules(self):
        return OwnershipRules(owned_schemas=frozenset({"public"}))

    def test_public_is_unclassified_without_explicit_rule(self):
        parsed = next(iter_statements(io.StringIO("CREATE TABLE public.x(id int);\n")))
        analysis = analyze_statement(parsed, OwnershipRules())
        self.assertEqual(analysis.ownership, Ownership.UNCLASSIFIED)
        self.assertEqual(analysis.category, StatementCategory.UNKNOWN)

    def test_platform_rule_precedes_spark_rule(self):
        parsed = next(iter_statements(io.StringIO("CREATE TABLE auth.x(id int);\n")))
        analysis = analyze_statement(parsed, OwnershipRules(owned_schemas=frozenset({"auth", "public"})))
        self.assertEqual(analysis.ownership, Ownership.PLATFORM_OWNED)
        self.assertEqual(analysis.category, StatementCategory.SUPABASE_INTERNAL)

    def test_mixed_dump_inventory(self):
        report = LegacyDumpAnalyzer(self.rules()).analyze(FIXTURES / "mixed_supabase_spark.sql")
        payload = report.to_dict()
        self.assertEqual(payload["categories"]["supabase_internal"], 1)
        self.assertGreaterEqual(payload["categories"]["spark_schema"], 4)
        extensions = {item["name"]: item["classification"] for item in payload["extensions"]}
        self.assertEqual(extensions["pgcrypto"], "REQUIRED_CANDIDATE")
        self.assertEqual(extensions["pg_net"], "SUPABASE_MANAGED")

    def test_sensitive_sql_never_appears_in_report(self):
        analyzer = LegacyDumpAnalyzer(self.rules())
        report = analyzer.analyze(FIXTURES / "security_sensitive.sql")
        rendered = analyzer.json_text(report)
        self.assertNotIn("never-echo-this", rendered)
        self.assertGreaterEqual(report.sensitive_count, 1)

    def test_unknown_is_review_not_silent_drop(self):
        report = LegacyDumpAnalyzer(self.rules()).analyze(FIXTURES / "unknown_statement.sql")
        self.assertEqual(report.result, AnalysisResult.ANALYZED_WITH_REVIEW)
        self.assertGreater(report.unknown_count, 0)

    def test_report_is_deterministic(self):
        analyzer = LegacyDumpAnalyzer(self.rules())
        first = analyzer.json_text(analyzer.analyze(FIXTURES / "mixed_supabase_spark.sql"))
        second = analyzer.json_text(analyzer.analyze(FIXTURES / "mixed_supabase_spark.sql"))
        self.assertEqual(first, second)
        parsed = json.loads(first)
        self.assertNotIn("timestamp", parsed)

    def test_quoted_identifiers_are_owned_by_explicit_public_rule(self):
        report = LegacyDumpAnalyzer(self.rules()).analyze(FIXTURES / "quoted_identifiers.sql")
        self.assertEqual(report.categories.get("spark_schema"), 1)

    def test_analyzer_never_creates_baseline_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "backup.sql"
            target.write_text("CREATE TABLE public.x(id int);\n")
            LegacyDumpAnalyzer(self.rules()).analyze(target)
            self.assertEqual(sorted(path.name for path in Path(temp).iterdir()), ["backup.sql"])


if __name__ == "__main__":
    unittest.main()
