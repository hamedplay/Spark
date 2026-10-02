from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from adapters.command import CommandResult
from roles.application.build.builder import StaticApplicationBuilder
from roles.application.build.manifest import load_build_manifest
from roles.application.deployment.activator import StaticApplicationActivator
from roles.application.deployment.lock import DeploymentLock


MANIFEST = '''schema_version: 1
application:
  type: static
runtime:
  node:
    requirement: ""
    package_manager: npm
install:
  command: [npm, ci]
build:
  command: [npm, run, build]
  environment:
    allow: []
artifacts:
  root: dist
  required: [dist/index.html, dist/assets]
deployment:
  type: nginx_static
  document_root: dist
  current_link: CURRENT
health:
  type: http
  host: 127.0.0.1
  path: /
  port: 80
  timeout_seconds: 1
  interval_seconds: 1
  marker: Spark
'''


class FakeBuildRunner:
    def __init__(self, node="v23.7.4", fail_build=False):
        self.node = node
        self.fail_build = fail_build
        self.calls = []

    def run(self, args, **kwargs):
        args = tuple(args); self.calls.append((args, kwargs))
        if args == ("node", "--version"):
            return CommandResult(0, self.node + "\n", "")
        if args == ("npm", "ci"):
            return CommandResult(0, "", "")
        if args == ("npm", "run", "build"):
            if self.fail_build:
                return CommandResult(1, "", "failed")
            root = Path(kwargs["cwd"])
            (root / "dist/assets").mkdir(parents=True, exist_ok=True)
            (root / "dist/assets/app.js").write_text("console.log('Spark')")
            (root / "dist/index.html").write_text('<html><body>Spark<script src="/assets/app.js"></script></body></html>')
            return CommandResult(0, "", "")
        return CommandResult(1, "", "unexpected")


class FakeHealth:
    def __init__(self, sequence): self.sequence = list(sequence)
    def wait_healthy(self, manifest): return self.sequence.pop(0) if self.sequence else False


class FakeNginx:
    def config_valid(self): return True
    def reload(self): pass


class M43Tests(unittest.TestCase):
    def make_release(self, root: Path):
        release = root / ("a" * 40); release.mkdir()
        (release / "package-lock.json").write_text('{"lockfileVersion":3}')
        manifest = release / "deploy/spark-cli/spark-build.yaml"; manifest.parent.mkdir(parents=True)
        manifest.write_text(MANIFEST.replace("CURRENT", str(root / "current")))
        return release, manifest

    @staticmethod
    def mark_verified(candidate: Path):
        (candidate / "dist/assets").mkdir(parents=True)
        (candidate / "dist/index.html").write_text("Spark/assets/")
        (candidate / "dist/assets/a").write_text("x")
        (candidate / ".spark").mkdir()
        (candidate / ".spark/build-metadata.json").write_text(json.dumps({"status":"VERIFIED"}))

    def test_manifest_requires_npm_ci(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "m.yaml"; p.write_text(MANIFEST.replace("CURRENT", "/tmp/current").replace("[npm, ci]", "[npm, install]"))
            with self.assertRaisesRegex(ValueError, "npm ci"):
                load_build_manifest(p)

    def test_node_version_is_not_pinned_and_secret_boundary_remains(self):
        with tempfile.TemporaryDirectory() as td:
            release, manifest = self.make_release(Path(td))
            for node_version in ("v18.20.8", "v22.19.0", "v24.21.0", "v26.0.0"):
                result = StaticApplicationBuilder(FakeBuildRunner(node_version)).build(
                    release, release.name, manifest, dry_run=True
                )
                self.assertEqual(result["status"], "PLANNED")
            with self.assertRaisesRegex(RuntimeError, "NODE_VERSION_MISMATCH"):
                StaticApplicationBuilder(FakeBuildRunner("not-a-version")).build(
                    release, release.name, manifest, dry_run=True
                )
            with self.assertRaisesRegex(RuntimeError, "sensitive variable"):
                StaticApplicationBuilder(FakeBuildRunner()).build(
                    release, release.name, manifest,
                    build_env={"SUPABASE_SERVICE_ROLE_KEY":"x"}, dry_run=True
                )

    def test_build_identity_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            release, manifest = self.make_release(Path(td)); runner = FakeBuildRunner(); builder = StaticApplicationBuilder(runner)
            first = builder.build(release, release.name, manifest)
            second = builder.build(release, release.name, manifest)
            self.assertTrue(first["changed"]); self.assertFalse(second["changed"])
            self.assertEqual(first["build_identity"], second["build_identity"])
            self.assertEqual(sum(1 for c, _ in runner.calls if c == ("npm", "ci")), 1)

    def test_build_failure_never_touches_current(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); release, manifest = self.make_release(root); previous=root/"previous"; previous.mkdir(); current=root/"current"; current.symlink_to(previous)
            with self.assertRaisesRegex(RuntimeError, "build command failed"):
                StaticApplicationBuilder(FakeBuildRunner(fail_build=True)).build(release, release.name, manifest)
            self.assertEqual(current.resolve(), previous.resolve())

    def test_dry_run_performs_zero_activation_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); self.mark_verified(candidate)
            state=root/"state"; current=root/"current"
            result=StaticApplicationActivator(health=FakeHealth([]), nginx=FakeNginx(), state_path=state, lock_path=root/"lock").deploy(candidate, load_build_manifest(manifest_path), dry_run=True)
            self.assertEqual(result.status, "PLANNED")
            self.assertFalse(current.exists()); self.assertFalse(current.is_symlink()); self.assertFalse(state.exists())

    def test_deploy_lock_rejects_concurrent_holder(self):
        with tempfile.TemporaryDirectory() as td:
            lock=Path(td)/"deploy.lock"
            with DeploymentLock(lock):
                with self.assertRaisesRegex(RuntimeError, "DEPLOYMENT_IN_PROGRESS"):
                    with DeploymentLock(lock):
                        pass

    def test_atomic_deploy_and_rollback(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); previous=root/"previous"; (previous/"dist").mkdir(parents=True); (previous/"dist/index.html").write_text("Spark")
            current=root/"current"; current.symlink_to(previous); self.mark_verified(candidate)
            manifest=load_build_manifest(manifest_path)
            activator=StaticApplicationActivator(health=FakeHealth([False, True]), nginx=FakeNginx(), state_path=root/"state.json", lock_path=root/"lock")
            result=activator.deploy(candidate, manifest)
            self.assertEqual(result.status, "DEPLOYMENT_FAILED")
            self.assertTrue(result.production_restored)
            self.assertEqual(current.resolve(), previous.resolve())

    def test_rollback_failure_is_critical(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); previous=root/"previous"; (previous/"dist").mkdir(parents=True); (previous/"dist/index.html").write_text("Spark")
            current=root/"current"; current.symlink_to(previous); self.mark_verified(candidate)
            result=StaticApplicationActivator(health=FakeHealth([False, False]), nginx=FakeNginx(), state_path=root/"state.json", lock_path=root/"lock").deploy(candidate, load_build_manifest(manifest_path))
            self.assertEqual(result.status, "CRITICAL_DEPLOYMENT_FAILURE")
            self.assertEqual(result.rollback_status, "FAILED")
            self.assertFalse(result.production_restored)
            self.assertEqual(current.resolve(), previous.resolve())

    def test_first_deploy_failure_removes_current_only(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); self.mark_verified(candidate)
            result=StaticApplicationActivator(health=FakeHealth([False]), nginx=FakeNginx(), state_path=root/"state", lock_path=root/"lock").deploy(candidate, load_build_manifest(manifest_path))
            self.assertEqual(result.status, "FIRST_DEPLOYMENT_FAILED")
            self.assertFalse((root/"current").exists()); self.assertTrue(candidate.exists())

    def test_resume_candidate_healthy(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); current=root/"current"; current.symlink_to(candidate)
            state=root/"state.json"; state.write_text(json.dumps({"candidate":str(candidate.resolve()),"previous":None,"activation_started":True}))
            result=StaticApplicationActivator(health=FakeHealth([True]), nginx=FakeNginx(), state_path=state, lock_path=root/"lock").resume(load_build_manifest(manifest_path))
            self.assertEqual(result.status, "DEPLOYED"); self.assertFalse(state.exists())

if __name__ == "__main__": unittest.main()
