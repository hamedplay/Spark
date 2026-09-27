from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from adapters.command import CommandResult
from roles.application.build.builder import StaticApplicationBuilder
from roles.application.build.identity import build_identity
from roles.application.build.manifest import load_build_manifest
from roles.application.deployment.activator import StaticApplicationActivator


MANIFEST = '''schema_version: 1
application:
  type: static
runtime:
  node:
    requirement: ">=24.18.1 <25"
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
    def __init__(self, node="v24.18.1", fail_build=False):
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
        manifest = release / "deploy/spark-build.yaml"; manifest.parent.mkdir()
        manifest.write_text(MANIFEST.replace("CURRENT", str(root / "current")))
        return release, manifest

    def test_manifest_requires_npm_ci(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "m.yaml"; p.write_text(MANIFEST.replace("CURRENT", "/tmp/current").replace("[npm, ci]", "[npm, install]"))
            with self.assertRaisesRegex(ValueError, "npm ci"):
                load_build_manifest(p)

    def test_node_gate_and_secret_boundary(self):
        with tempfile.TemporaryDirectory() as td:
            release, manifest = self.make_release(Path(td))
            with self.assertRaisesRegex(RuntimeError, "NODE_VERSION_MISMATCH"):
                StaticApplicationBuilder(FakeBuildRunner("v22.0.0")).build(release, release.name, manifest, dry_run=True)
            with self.assertRaisesRegex(RuntimeError, "sensitive variable"):
                StaticApplicationBuilder(FakeBuildRunner()).build(release, release.name, manifest, build_env={"SUPABASE_SERVICE_ROLE_KEY":"x"}, dry_run=True)

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

    def test_atomic_deploy_and_rollback(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root); previous=root/"previous"; (previous/"dist").mkdir(parents=True); (previous/"dist/index.html").write_text("Spark")
            current=root/"current"; current.symlink_to(previous)
            (candidate/"dist/assets").mkdir(parents=True); (candidate/"dist/index.html").write_text("Spark/assets/"); (candidate/"dist/assets/a").write_text("x")
            (candidate/".spark").mkdir(); (candidate/".spark/build-metadata.json").write_text(json.dumps({"status":"VERIFIED"}))
            manifest=load_build_manifest(manifest_path)
            state=root/"state.json"; lock=root/"lock"
            activator=StaticApplicationActivator(health=FakeHealth([False, True]), nginx=FakeNginx(), state_path=state, lock_path=lock)
            result=activator.deploy(candidate, manifest)
            self.assertEqual(result.status, "DEPLOYMENT_FAILED")
            self.assertTrue(result.production_restored)
            self.assertEqual(current.resolve(), previous.resolve())

    def test_first_deploy_failure_removes_current_only(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); candidate, manifest_path=self.make_release(root)
            (candidate/"dist/assets").mkdir(parents=True); (candidate/"dist/index.html").write_text("Spark/assets/"); (candidate/"dist/assets/a").write_text("x")
            (candidate/".spark").mkdir(); (candidate/".spark/build-metadata.json").write_text(json.dumps({"status":"VERIFIED"}))
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
