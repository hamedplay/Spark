from __future__ import annotations

import unittest

from config.models import DockerRuntimeConfig
from roles.database.runtime.installer import DockerRuntimeManager
from roles.database.runtime.models import DockerRuntimeState, RuntimeStatus


def state(status: RuntimeStatus, *, engine=False, compose=False, active=False, healthy=False, conflicts=(), source=None):
    return DockerRuntimeState(
        status=status,
        os_id="ubuntu",
        os_version="24.04",
        os_codename="noble",
        architecture="amd64",
        engine_installed=engine,
        engine_version="29.0.0" if engine else None,
        daemon_active=active,
        daemon_healthy=healthy,
        compose_installed=compose,
        compose_version="2.40.0" if compose else None,
        source=source,
        conflicting_packages=tuple(conflicts),
        socket_path="/var/run/docker.sock" if healthy else None,
        firewall_warnings=(),
    )


class FakeDetector:
    def __init__(self, value):
        self.value = value
    def detect(self):
        return self.value


class RuntimePlanTests(unittest.TestCase):
    def test_conflicts_are_blocked_by_default(self):
        manager = DockerRuntimeManager(detector=FakeDetector(state(RuntimeStatus.CONFLICT, engine=True, conflicts=("docker.io",), source="other")))
        plan = manager.plan(DockerRuntimeConfig())
        self.assertTrue(plan["blocked"])
        self.assertIn("docker.io", plan["conflicting_packages"])

    def test_conflicts_require_explicit_policy_to_replace(self):
        manager = DockerRuntimeManager(detector=FakeDetector(state(RuntimeStatus.CONFLICT, engine=True, conflicts=("docker.io",), source="other")))
        plan = manager.plan(DockerRuntimeConfig(replace_conflicting_packages=True))
        self.assertFalse(plan["blocked"])
        self.assertIn("replace conflicting distro/container runtime packages", plan["actions"])

    def test_missing_runtime_plan_uses_official_repo(self):
        manager = DockerRuntimeManager(detector=FakeDetector(state(RuntimeStatus.ABSENT)))
        plan = manager.plan(DockerRuntimeConfig())
        self.assertIn("configure Docker official apt repository", plan["actions"])
        self.assertIn("install Docker Engine", plan["actions"])
        self.assertIn("install Docker Compose plugin", plan["actions"])

    def test_manual_policy_blocks_missing_runtime(self):
        manager = DockerRuntimeManager(detector=FakeDetector(state(RuntimeStatus.ABSENT)))
        plan = manager.plan(DockerRuntimeConfig(install_policy="manual"))
        self.assertTrue(plan["blocked"])

    def test_healthy_runtime_is_idempotent(self):
        healthy_state = state(RuntimeStatus.HEALTHY, engine=True, compose=True, active=True, healthy=True, source="docker-official-apt")
        manager = DockerRuntimeManager(detector=FakeDetector(healthy_state))
        self.assertFalse(manager.apply(DockerRuntimeConfig()))


if __name__ == "__main__":
    unittest.main()
