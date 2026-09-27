from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from config.models import EnvironmentConfig
from .inventory import build_inventory, by_role
from .models import ProductionRunResult, RemoteOperation, RemoteResult, RemoteStatus
from .readiness import build_readiness
from .ssh import OpenSSHClient, SSHConfig
from .state import ProductionStateStore
from .transfer import ProfileTransfer


class CentralizedExecutor:
    def __init__(self, environment: EnvironmentConfig, *, profile_path: str | Path, desired_revision: str):
        self.environment = environment
        self.profile_path = Path(profile_path)
        self.desired_revision = desired_revision.strip()
        if not self.desired_revision:
            raise ValueError("desired Spark Manager revision is required")
        jump = environment.jump_server
        self.ssh_config = SSHConfig(
            known_hosts_file=jump.known_hosts_file,
            connect_timeout_seconds=jump.connect_timeout_seconds,
            command_timeout_seconds=jump.command_timeout_seconds,
            remote_profile_path=jump.remote_profile_path,
        )
        self.client = OpenSSHClient(self.ssh_config)
        self.transfer = ProfileTransfer(self.ssh_config)
        self.inventory = build_inventory(environment)
        self.state = ProductionStateStore(jump.state_file)

    def _revision_gate(self) -> tuple[RemoteResult, ...]:
        results: list[RemoteResult] = []
        for node in self.inventory:
            result = self.client.run(node, RemoteOperation.REVISION)
            if result.ok and result.revision != self.desired_revision:
                result = replace(result, status=RemoteStatus.VERSION_MISMATCH)
            results.append(result)
        return tuple(results)

    def plan(self) -> ProductionRunResult:
        results = self._revision_gate()
        lines = ["SPARK PRODUCTION PLAN", ""]
        labels = {"database": "Database", "application": "Application", "reverse_proxy": "Reverse Proxy"}
        proxy_index = 0
        for result in results:
            label = labels[result.node.role]
            if result.node.role == "reverse_proxy":
                proxy_index += 1
                label += f" #{proxy_index}"
            ssh = "READY" if result.ok else result.status.value
            action = {
                "database": "Provision Database Core",
                "application": "Provision Application",
                "reverse_proxy": "Provision Reverse Proxy",
            }[result.node.role]
            lines.extend([label, f"  {result.node.host}", f"  SSH        {ssh}", f"  Action     {action}", ""])
        lines.append("Mutations: NONE (DRY RUN)")
        ok = all(item.ok for item in results)
        return ProductionRunResult("READY" if ok else "FAILED", results, {}, tuple(lines))

    def _prepare(self, node) -> RemoteResult | None:
        ok, message = self.transfer.copy(node, self.profile_path)
        if ok:
            return None
        return RemoteResult(node, RemoteOperation.PROFILE, RemoteStatus.FAILED, 1, "", message)

    def _execute_nodes(self, nodes, operation: RemoteOperation) -> tuple[RemoteResult, ...]:
        results: list[RemoteResult] = []
        for node in nodes:
            failure = self._prepare(node)
            if failure:
                results.append(failure)
                break
            result = self.client.run(node, operation)
            results.append(result)
            if not result.ok:
                break
        return tuple(results)

    def install(self, *, resume: bool = False) -> ProductionRunResult:
        preflight = self._revision_gate()
        if not all(item.ok for item in preflight):
            return ProductionRunResult("FAILED", preflight, {}, ("VERSION/SSH PREFLIGHT FAILED",))

        all_results: list[RemoteResult] = list(preflight)
        stored = self.state.load().get("steps", {}) if resume else {}

        database = by_role(self.inventory, "database")
        application = by_role(self.inventory, "application")
        proxies = by_role(self.inventory, "reverse_proxy")

        def stage(name: str, nodes, operation: RemoteOperation = RemoteOperation.INSTALL, verify: bool = True) -> bool:
            if resume and stored.get(name) in {"COMPLETED", "PASS"} and verify:
                verification = self._execute_nodes(nodes, RemoteOperation.ROLE_HEALTH)
                all_results.extend(verification)
                if verification and all(item.ok for item in verification):
                    self.state.set_step(name, "PASS")
                    return True
            results = self._execute_nodes(nodes, operation)
            all_results.extend(results)
            ok = bool(results) and all(item.ok for item in results)
            self.state.set_step(name, "COMPLETED" if ok else "FAILED")
            return ok

        if not stage("database", database):
            return ProductionRunResult("FAILED", tuple(all_results), {}, ("Database provisioning failed; downstream stages were not started.",))
        if not stage("database_health", database, RemoteOperation.ROLE_HEALTH, verify=False):
            return ProductionRunResult("FAILED", tuple(all_results), {}, ("Database health gate failed; downstream stages were not started.",))
        if not stage("application", application):
            return ProductionRunResult("FAILED", tuple(all_results), {}, ("Application provisioning failed; proxies were not started.",))
        if not stage("application_health", application, RemoteOperation.ROLE_HEALTH, verify=False):
            return ProductionRunResult("FAILED", tuple(all_results), {}, ("Application health gate failed; proxies were not started.",))

        for index, node in enumerate(proxies, start=1):
            name = f"proxy_{index}"
            result = self._execute_nodes((node,), RemoteOperation.INSTALL)
            all_results.extend(result)
            if not result or not all(item.ok for item in result):
                self.state.set_step(name, "FAILED")
                return ProductionRunResult("PARTIAL", tuple(all_results), {}, (f"Reverse Proxy #{index} failed; healthy upstream services were preserved.",))
            self.state.set_step(name, "COMPLETED")

        network_results = self._execute_nodes(self.inventory, RemoteOperation.NETWORK)
        all_results.extend(network_results)
        network_ok = all(item.ok for item in network_results)
        self.state.set_step("network", "PASS" if network_ok else "FAILED")
        checks, lines = build_readiness(self.environment, tuple(all_results), network_ok)
        ready = checks.get("result") == "READY"
        self.state.set_step("readiness", "READY" if ready else "FAILED")
        return ProductionRunResult("READY" if ready else "FAILED", tuple(all_results), checks, lines)

    def repair(self) -> ProductionRunResult:
        preflight = self._revision_gate()
        if not all(item.ok for item in preflight):
            return ProductionRunResult("FAILED", preflight, {}, ("VERSION/SSH PREFLIGHT FAILED",))
        results: list[RemoteResult] = list(preflight)
        for node in self.inventory:
            failure = self._prepare(node)
            if failure:
                results.append(failure)
                return ProductionRunResult("FAILED", tuple(results), {}, (f"Profile transfer failed for {node.id}",))
            health = self.client.run(node, RemoteOperation.ROLE_HEALTH)
            results.append(health)
            if health.ok:
                continue
            repaired = self.client.run(node, RemoteOperation.REPAIR)
            results.append(repaired)
            if not repaired.ok:
                return ProductionRunResult("PARTIAL", tuple(results), {}, (f"Repair failed on {node.id}",))
        network_results = tuple(self.client.run(node, RemoteOperation.NETWORK) for node in self.inventory)
        results.extend(network_results)
        checks, lines = build_readiness(self.environment, tuple(results), all(item.ok for item in network_results))
        return ProductionRunResult("READY" if checks.get("result") == "READY" else "FAILED", tuple(results), checks, lines)
