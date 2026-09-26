from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from adapters.command import CommandResult
from roles.database.runtime.detector import DockerRuntimeDetector
from roles.database.runtime.models import RuntimeStatus


class FakeRunner:
    def run(self, args, **kwargs):
        command = tuple(args)
        if command == ("dpkg", "--print-architecture"):
            return CommandResult(0, "amd64\n", "")
        return CommandResult(127, "", "")


class FakeApt:
    def __init__(self, *, conflicts=(), official=False):
        self.conflicts = tuple(conflicts)
        self.official = official
    def installed_conflicts(self, packages):
        return self.conflicts
    def is_installed(self, package):
        return package == "docker-ce" and self.official


class FakeSystemd:
    def __init__(self, active):
        self.active = active
    def is_active(self, unit):
        return self.active


class FakeDocker:
    def __init__(self, *, version="29.0.0", compose="2.40.0", healthy=True):
        self.version = version
        self.compose = compose
        self.healthy = healthy
    def engine_version(self):
        return self.version
    def compose_version(self):
        return self.compose
    def daemon_healthy(self):
        return self.healthy


def os_release(root: Path, version: str) -> Path:
    path = root / "os-release"
    path.write_text(f'ID=ubuntu\nVERSION_ID="{version}"\nVERSION_CODENAME=noble\n')
    return path


class RuntimeDetectionTests(unittest.TestCase):
    def build(self, version="24.04", *, conflicts=(), official=False, active=True, healthy=True):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        detector = DockerRuntimeDetector(
            runner=FakeRunner(),
            apt=FakeApt(conflicts=conflicts, official=official),
            systemd=FakeSystemd(active),
            docker=FakeDocker(healthy=healthy),
            os_release_path=os_release(Path(tmp.name), version),
        )
        return detector

    @patch("roles.database.runtime.detector.shutil.which", return_value="/usr/bin/docker")
    def test_healthy_official_runtime(self, _which):
        state = self.build(official=True).detect()
        self.assertEqual(state.status, RuntimeStatus.HEALTHY)
        self.assertTrue(state.compose_installed)

    @patch("roles.database.runtime.detector.shutil.which", return_value="/usr/bin/docker")
    def test_daemon_down_is_unhealthy(self, _which):
        state = self.build(official=True, active=False, healthy=False).detect()
        self.assertEqual(state.status, RuntimeStatus.UNHEALTHY)

    @patch("roles.database.runtime.detector.shutil.which", return_value="/usr/bin/docker")
    def test_conflicting_distro_runtime_is_conflict(self, _which):
        state = self.build(conflicts=("docker.io",), official=False).detect()
        self.assertEqual(state.status, RuntimeStatus.CONFLICT)

    @patch("roles.database.runtime.detector.shutil.which", return_value="/usr/bin/docker")
    def test_unknown_ubuntu_release_is_unsupported(self, _which):
        state = self.build(version="20.04", official=True).detect()
        self.assertEqual(state.status, RuntimeStatus.UNSUPPORTED)

    @patch("roles.database.runtime.detector.shutil.which", return_value=None)
    def test_absent_runtime_is_absent(self, _which):
        state = self.build(active=False, healthy=False).detect()
        self.assertEqual(state.status, RuntimeStatus.ABSENT)


if __name__ == "__main__":
    unittest.main()
