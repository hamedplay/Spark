from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CLI))

from core.context import ExecutionContext
from core.errors import DependencyCycleError, DuplicateOperationError, UnknownDependencyError
from core.operation import OperationTask
from core.planner import Planner
from core.registry import OperationRegistry
from core.result import TaskResult, TaskStatus
from core.retry import RetryPolicy
from core.state import StateStore
from core.workflow import Workflow


class FakeTask(OperationTask):
    id = "fake"

    def __init__(self, task_id="fake", dependencies=(), failures=0, retry=1, reverify=False, verify_failures=0):
        self.id = task_id
        self.dependencies = tuple(dependencies)
        self.failures = failures
        self.verify_failures = verify_failures
        self.calls = []
        self.retry_policy = RetryPolicy(attempts=retry)
        self.reverify_on_resume = reverify

    def detect(self, ctx):
        self.calls.append("detect")
        return TaskResult.success("detected")

    def plan(self, ctx):
        self.calls.append("plan")
        return TaskResult.success("planned", target=self.id)

    def apply(self, ctx):
        self.calls.append("apply")
        if self.failures:
            self.failures -= 1
            return TaskResult.failed("transient failure")
        return TaskResult.success("applied", changed=True)

    def verify(self, ctx):
        self.calls.append("verify")
        if self.verify_failures:
            self.verify_failures -= 1
            return TaskResult.failed("verification failed")
        return TaskResult.success("verified")


class WorkflowCoreTests(unittest.TestCase):
    def registry(self, *tasks):
        registry = OperationRegistry()
        registry.extend(tasks)
        return registry

    def test_dependency_order(self):
        a = FakeTask("database.runtime")
        b = FakeTask("database.postgres", dependencies=("database.runtime",))
        plan = Planner(self.registry(b, a)).build(["database.postgres"])
        self.assertEqual(plan.ids, ("database.runtime", "database.postgres"))

    def test_duplicate_unknown_and_cycle_detection(self):
        registry = self.registry(FakeTask("a"))
        with self.assertRaises(DuplicateOperationError):
            registry.register(FakeTask("a"))
        with self.assertRaises(UnknownDependencyError):
            Planner(self.registry(FakeTask("a", dependencies=("missing",)))).build(["a"])
        cyclic = self.registry(FakeTask("a", dependencies=("b",)), FakeTask("b", dependencies=("a",)))
        with self.assertRaises(DependencyCycleError):
            Planner(cyclic).build(["a"])

    def test_dry_run_never_applies(self):
        task = FakeTask("database.postgres")
        result = Workflow("dry", self.registry(task)).execute(ExecutionContext(dry_run=True))
        self.assertTrue(result.ok)
        self.assertEqual(task.calls, ["detect", "plan"])

    def test_retry_and_verify(self):
        task = FakeTask("database.postgres", failures=1, retry=2)
        result = Workflow("retry", self.registry(task)).execute(ExecutionContext())
        self.assertTrue(result.ok)
        self.assertEqual(task.calls.count("apply"), 2)
        self.assertIn("verify", task.calls)

    def test_failure_propagates_to_dependents(self):
        first = FakeTask("database.runtime", failures=1)
        second = FakeTask("database.postgres", dependencies=("database.runtime",))
        result = Workflow("failure", self.registry(first, second)).execute(ExecutionContext())
        self.assertEqual(result.status, TaskStatus.FAILED)
        self.assertEqual(result.results["database.postgres"].status, TaskStatus.SKIPPED)
        self.assertNotIn("apply", second.calls)

    def test_resume_skips_verified_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = StateStore(tmp)
            state.record_task("resume", "database.runtime", "success", verified=True)
            first = FakeTask("database.runtime")
            second = FakeTask("database.postgres", dependencies=("database.runtime",))
            result = Workflow("resume", self.registry(first, second)).execute(ExecutionContext(resume=True, state=state))
            self.assertTrue(result.ok)
            self.assertEqual(first.calls, [])
            self.assertIn("verify", second.calls)

    def test_resume_reverifies_lifecycle_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = StateStore(tmp)
            state.record_task("resume-live", "database.postgres", "success", verified=True)
            task = FakeTask("database.postgres", reverify=True)
            result = Workflow("resume-live", self.registry(task)).execute(ExecutionContext(resume=True, state=state))
            self.assertTrue(result.ok)
            self.assertEqual(task.calls, ["verify"])
            self.assertTrue(result.results["database.postgres"].details["reverified"])

    def test_resume_repair_runs_when_reverification_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = StateStore(tmp)
            state.record_task("resume-repair", "database.postgres", "success", verified=True)
            task = FakeTask("database.postgres", reverify=True, verify_failures=1)
            result = Workflow("resume-repair", self.registry(task)).execute(ExecutionContext(resume=True, state=state))
            self.assertTrue(result.ok)
            self.assertEqual(task.calls[:4], ["verify", "detect", "plan", "apply"])
            self.assertEqual(task.calls[-1], "verify")

    def test_state_store_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = StateStore(tmp)
            store.record_task("database-install", "database.postgres", "success", verified=True)
            payload = store.load("database-install")
            self.assertTrue(payload["tasks"]["database.postgres"]["verified"])


if __name__ == "__main__":
    unittest.main()
