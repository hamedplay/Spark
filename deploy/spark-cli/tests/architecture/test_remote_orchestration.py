from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config.models import EnvironmentConfig, JumpServerConfig, NodeConfig
from roles.environment.remote.executor import CentralizedExecutor
from roles.environment.remote.inventory import build_inventory
from roles.environment.remote.models import RemoteNode, RemoteOperation, RemoteResult, RemoteStatus
from roles.environment.remote.ssh import OpenSSHClient, SSHConfig


class _Transfer:
    def __init__(self):
        self.calls = []

    def copy(self, node, profile):
        self.calls.append((node.id, str(profile)))
        return True, "ok"


class _Client:
    def __init__(self, revision: str, fail_install_role: str | None = None, fail_install_node_once: str | None = None):
        self.revision = revision
        self.fail_install_role = fail_install_role
        self.fail_install_node_once = fail_install_node_once
        self.failed_once = False
        self.calls = []

    def run(self, node, operation, **kwargs):
        self.calls.append((node.id, node.role, operation))
        if operation == RemoteOperation.REVISION:
            return RemoteResult(node, operation, RemoteStatus.PASS, 0, f"Revision: {self.revision}\n", "", self.revision)
        if operation == RemoteOperation.INSTALL and node.role == self.fail_install_role:
            return RemoteResult(node, operation, RemoteStatus.FAILED, 1, "", "failed")
        if operation == RemoteOperation.INSTALL and node.id == self.fail_install_node_once and not self.failed_once:
            self.failed_once = True
            return RemoteResult(node, operation, RemoteStatus.FAILED, 1, "", "deliberate failure")
        if operation == RemoteOperation.ROLE_HEALTH:
            key = {"database": "auth", "application": "frontend", "reverse_proxy": "reverse_proxy_1"}[node.role]
            return RemoteResult(node, operation, RemoteStatus.PASS, 0, f"{key} PASS\n", "")
        if operation == RemoteOperation.NETWORK:
            return RemoteResult(node, operation, RemoteStatus.PASS, 0, "PASS app-to-database-postgres\nPASS app-to-database-supabase\n", "")
        return RemoteResult(node, operation, RemoteStatus.COMPLETED, 0, "ok", "")


class RemoteOrchestrationTests(unittest.TestCase):
    def _environment(self):
        return EnvironmentConfig(
            name="production",
            nodes={
                "database": NodeConfig(role="database", host="10.0.0.10"),
                "application": NodeConfig(role="application", host="10.0.0.20"),
                "reverse_proxy": NodeConfig(role="reverse_proxy", host="10.0.0.30", secondary_hosts=("10.0.0.31",)),
            },
            jump_server=JumpServerConfig(enabled=True, ssh_user="operator"),
        )

    def _profile(self, root: Path) -> Path:
        known = root / "known_hosts"
        known.write_text("host key\n")
        profile = root / "production.yaml"
        profile.write_text(
            "jump_server:\n"
            "  remote:\n"
            f"    known_hosts_file: {known}\n"
            f"    state_file: {root / 'production.json'}\n"
            "    connect_timeout_seconds: 5\n"
            "    command_timeout_seconds: 60\n"
        )
        return profile

    def test_inventory_expands_secondary_proxy_and_uses_profile_user(self):
        inventory = build_inventory(self._environment())
        self.assertEqual([n.id for n in inventory], ["database-1", "application-1", "reverse_proxy-1", "reverse_proxy-2"])
        self.assertTrue(all(n.ssh_user == "operator" for n in inventory))

    def test_ssh_is_strict_batch_sudo_and_not_generic_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            known = Path(tmp) / "known_hosts"
            known.write_text("x")
            client = OpenSSHClient(SSHConfig(str(known)))
            node = RemoteNode("database-1", "database", "10.0.0.10", "operator")
            completed = subprocess.CompletedProcess([], 0, stdout="Revision: abc\n", stderr="")
            with patch("roles.environment.remote.ssh.subprocess.run", return_value=completed) as run:
                result = client.run(node, RemoteOperation.REVISION)
            command = run.call_args.args[0]
            self.assertIn("StrictHostKeyChecking=yes", command)
            self.assertIn("BatchMode=yes", command)
            self.assertIn("sudo", command)
            self.assertIn("/usr/local/bin/spark-architecture", command)
            self.assertNotIn("--", command)
            self.assertEqual(result.revision, "abc")

    def test_dry_run_does_not_transfer_profile_or_provision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            executor = CentralizedExecutor(self._environment(), profile_path=self._profile(root), desired_revision="abc")
            fake = _Client("abc")
            transfer = _Transfer()
            executor.client = fake
            executor.transfer = transfer
            result = executor.plan()
            self.assertEqual(result.status, "READY")
            self.assertEqual(transfer.calls, [])
            self.assertFalse(any(op == RemoteOperation.INSTALL for _, _, op in fake.calls))
            self.assertIn("Mutations: NONE (DRY RUN)", result.lines)

    def test_database_failure_stops_application_and_proxies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            executor = CentralizedExecutor(self._environment(), profile_path=self._profile(root), desired_revision="abc")
            fake = _Client("abc", fail_install_role="database")
            executor.client = fake
            executor.transfer = _Transfer()
            result = executor.install()
            self.assertEqual(result.status, "FAILED")
            installs = [(role, op) for _, role, op in fake.calls if op == RemoteOperation.INSTALL]
            self.assertEqual(installs, [("database", RemoteOperation.INSTALL)])

    def test_revision_mismatch_blocks_all_provisioning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            executor = CentralizedExecutor(self._environment(), profile_path=self._profile(root), desired_revision="wanted")
            fake = _Client("other")
            executor.client = fake
            executor.transfer = _Transfer()
            result = executor.install()
            self.assertEqual(result.status, "FAILED")
            self.assertFalse(any(op == RemoteOperation.INSTALL for _, _, op in fake.calls))
            self.assertTrue(any(item.status == RemoteStatus.VERSION_MISMATCH for item in result.results))

    def test_proxy2_failure_is_partial_and_resume_preserves_proxy1(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = self._profile(root)
            executor = CentralizedExecutor(self._environment(), profile_path=profile, desired_revision="abc")
            first = _Client("abc", fail_install_node_once="reverse_proxy-2")
            executor.client = first
            executor.transfer = _Transfer()
            result = executor.install()
            self.assertEqual(result.status, "PARTIAL")
            self.assertEqual(executor.state.load()["environment"], "PARTIAL")
            self.assertEqual(executor.state.load()["steps"]["proxy_1"], "COMPLETED")
            self.assertEqual(executor.state.load()["steps"]["proxy_2"], "FAILED")

            resumed = CentralizedExecutor(self._environment(), profile_path=profile, desired_revision="abc")
            second = _Client("abc")
            resumed.client = second
            resumed.transfer = _Transfer()
            with patch("roles.environment.remote.executor.build_readiness", return_value=({"result": "READY"}, ("RESULT                READY",))):
                recovered = resumed.install(resume=True)
            self.assertEqual(recovered.status, "READY")
            proxy1_installs = [call for call in second.calls if call[0] == "reverse_proxy-1" and call[2] == RemoteOperation.INSTALL]
            proxy2_installs = [call for call in second.calls if call[0] == "reverse_proxy-2" and call[2] == RemoteOperation.INSTALL]
            self.assertEqual(proxy1_installs, [])
            self.assertEqual(len(proxy2_installs), 1)


if __name__ == "__main__":
    unittest.main()
