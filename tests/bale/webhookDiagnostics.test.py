import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[2] / "deploy/spark-cli/diagnose-bale-webhook.py"
spec = importlib.util.spec_from_file_location("bale_diagnostics", path)
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


class DiagnosticsTests(unittest.TestCase):
    def run_diagnostic(self, edge_token=""):
        database = {"config": {"active": True, "username": "spark_bot", "token": "private-db-token",
                               "webhook_url": "https://api.shahrmeeting.ir/functions/v1/bale-webhook"},
                    "nonces_30m": {"created": 3, "used": 0, "unused_live": 3}}
        environment = ["BALE_BOT_TOKEN=" + edge_token, "SUPABASE_SERVICE_ROLE_KEY=private-service-key"]
        calls = []

        def request(url, payload=None):
            calls.append((url, payload))
            if url.endswith("getMe"):
                return 200, {"ok": True, "result": {"username": "spark_bot"}}
            if url.endswith("getWebhookInfo"):
                return 200, {"ok": True, "result": {"url": database["config"]["webhook_url"],
                    "pending_update_count": 3, "last_error_message": "401 private-upstream-detail"}}
            return 401, {}

        output = io.StringIO()
        with patch.object(sys, "argv", [str(path)]), contextlib.redirect_stdout(output), \
                patch.object(diagnostics, "command", side_effect=[json.dumps(database), json.dumps(environment)]), \
                patch.object(diagnostics, "request", side_effect=request), \
                patch.object(diagnostics.subprocess, "run", return_value=types.SimpleNamespace(
                    returncode=0, stdout="[bale-webhook] BALE_BOT_TOKEN not configured\n", stderr="")):
            diagnostics.main()
        text = output.getvalue()
        for secret in ["private-db-token", "private-service-key", "private-upstream-detail", edge_token or "NEVER"]:
            self.assertNotIn(secret, text)
        self.assertTrue(all(url.endswith(("getMe", "getWebhookInfo")) or payload == b"{}"
                            for url, payload in calls))
        return json.loads(text), calls

    def test_missing_edge_secret_and_gateway_rejection_are_distinguishable(self):
        report, _ = self.run_diagnostic()
        self.assertFalse(report["container_bale_token_present"])
        self.assertEqual(report["empty_webhook_probe_http"], 401)
        self.assertEqual(report["database_bot"]["last_error_kind"], "HTTP_401")
        self.assertEqual(report["webhook_log_counts_30m"]["BALE_BOT_TOKEN not configured"], 1)

    def test_mismatched_bot_is_checked_without_changing_webhook_or_consuming_updates(self):
        report, calls = self.run_diagnostic("private-other-token")
        self.assertFalse(report["db_and_container_tokens_equal"])
        self.assertIn("container_bot", report)
        self.assertEqual(len(calls), 5)

    def test_matching_token_is_not_requested_twice(self):
        report, calls = self.run_diagnostic("private-db-token")
        self.assertTrue(report["db_and_container_tokens_equal"])
        self.assertNotIn("container_bot", report)
        self.assertEqual(len(calls), 3)

    def test_network_error_cannot_echo_credential_url(self):
        with patch.object(diagnostics.urllib.request, "urlopen", side_effect=ValueError("private-url")):
            self.assertEqual(diagnostics.request("https://tapi.bale.ai/botprivate-token/getMe"),
                             ("NETWORK_OR_RESPONSE_ERROR", {}))


if __name__ == "__main__":
    unittest.main()
