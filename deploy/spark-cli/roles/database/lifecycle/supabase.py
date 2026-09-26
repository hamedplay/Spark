from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path

from adapters import DockerAdapter
from config.models import EnvironmentConfig
from secrets.file_provider import FileSecretProvider
from .models import AggregateState, Capability, ComponentState, ServiceRuntimeState


CAPABILITY_SERVICES = {
    Capability.AUTH: ("auth",),
    Capability.REST: ("rest",),
    Capability.REALTIME: ("realtime",),
    Capability.STORAGE: ("storage",),
    Capability.GATEWAY: ("api-gw", "kong"),
    Capability.STUDIO: ("studio",),
    Capability.POOLER: ("supavisor", "pooler"),
    Capability.META: ("meta",),
    Capability.IMGPROXY: ("imgproxy",),
}

START_GROUPS = (
    (Capability.META, Capability.POOLER),
    (Capability.AUTH, Capability.REST, Capability.REALTIME, Capability.IMGPROXY, Capability.STORAGE),
    (Capability.STUDIO, Capability.GATEWAY),
)


class SupabaseLifecycleManager:
    def __init__(self, docker: DockerAdapter | None = None, *, poll_interval_seconds: float = 2.0) -> None:
        self.docker = docker or DockerAdapter()
        self.poll_interval_seconds = poll_interval_seconds

    @staticmethod
    def _required(profile: EnvironmentConfig, capability: Capability) -> bool:
        cfg = profile.database.supabase.capabilities
        mapping = {
            Capability.AUTH: cfg.auth,
            Capability.REST: cfg.rest,
            Capability.REALTIME: cfg.realtime,
            Capability.STORAGE: cfg.storage,
            Capability.GATEWAY: cfg.gateway,
            Capability.STUDIO: cfg.studio,
            Capability.POOLER: cfg.pooler,
            Capability.META: cfg.meta,
            Capability.IMGPROXY: cfg.imgproxy,
        }
        return bool(mapping[capability])

    def resolve(self, profile: EnvironmentConfig) -> dict[Capability, str]:
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        project = profile.database.compose.project_name
        services = set(self.docker.compose_services(root, env_file, project))
        if "functions" in services:
            raise RuntimeError("Edge Functions service is forbidden on database role")
        images = self.docker.compose_service_images(root, env_file, project)
        if any("edge-runtime" in image.lower() for image in images.values()):
            raise RuntimeError("Edge Runtime image is forbidden on database role")
        resolved: dict[Capability, str] = {}
        for capability, options in CAPABILITY_SERVICES.items():
            service = next((name for name in options if name in services), None)
            if service:
                resolved[capability] = service
            elif self._required(profile, capability):
                raise RuntimeError(f"required Supabase capability is missing: {capability.value}")
        return resolved

    def _service_state(self, profile: EnvironmentConfig, capability: Capability, service: str) -> ServiceRuntimeState:
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        project = profile.database.compose.project_name
        container_id = self.docker.service_container_id(root, env_file, service, project)
        if not container_id:
            return ServiceRuntimeState(capability, service, None, ComponentState.ABSENT, None, False, self._required(profile, capability))
        container_state, health = self.docker.container_state(container_id)
        if container_state == "running" and health in {"healthy", None}:
            state = ComponentState.HEALTHY
        elif container_state == "running" and health == "starting":
            state = ComponentState.STARTING
        elif container_state == "running":
            state = ComponentState.UNHEALTHY
        elif container_state in {"created", "restarting"}:
            state = ComponentState.CREATED
        elif container_state in {"exited", "dead"}:
            state = ComponentState.STOPPED
        else:
            state = ComponentState.UNKNOWN
        endpoint_ready = state == ComponentState.HEALTHY
        return ServiceRuntimeState(capability, service, container_id, state, health, endpoint_ready, self._required(profile, capability))

    def detect(self, profile: EnvironmentConfig) -> tuple[AggregateState, tuple[ServiceRuntimeState, ...]]:
        resolved = self.resolve(profile)
        states = tuple(self._service_state(profile, capability, service) for capability, service in resolved.items())
        required = [state for state in states if state.required]
        if required and all(state.state == ComponentState.HEALTHY for state in required):
            aggregate = AggregateState.HEALTHY
        elif any(state.state == ComponentState.UNHEALTHY for state in required):
            aggregate = AggregateState.UNHEALTHY
        elif any(state.state == ComponentState.HEALTHY for state in required):
            aggregate = AggregateState.DEGRADED
        elif required and all(state.state in {ComponentState.STOPPED, ComponentState.ABSENT} for state in required):
            aggregate = AggregateState.STOPPED
        else:
            aggregate = AggregateState.PARTIAL
        return aggregate, states

    @staticmethod
    def _http_ready(url: str, headers: dict[str, str] | None = None, timeout: float = 3.0) -> bool:
        request = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status < 500
        except urllib.error.HTTPError as exc:
            return exc.code < 500
        except (urllib.error.URLError, TimeoutError, OSError):
            return False

    def _gateway_probes(self, profile: EnvironmentConfig, secrets: FileSecretProvider) -> dict[str, bool]:
        database_host = next(node.host for node in profile.nodes.values() if node.role == "database")
        base = f"http://{database_host}:8000"
        anon = secrets.get("ANON_KEY")
        headers = {"apikey": anon, "Authorization": f"Bearer {anon}"}
        return {
            "gateway": self._http_ready(base + "/auth/v1/health"),
            "auth": self._http_ready(base + "/auth/v1/health", headers),
            "rest": self._http_ready(base + "/rest/v1/", headers),
            "storage": self._http_ready(base + "/storage/v1/status", headers),
        }

    def verify(self, profile: EnvironmentConfig, secrets: FileSecretProvider) -> dict[str, object]:
        aggregate, states = self.detect(profile)
        failed = [state.capability.value for state in states if state.required and state.state != ComponentState.HEALTHY]
        if failed:
            raise RuntimeError(f"Supabase required capabilities are not healthy: {', '.join(failed)}")
        probes = self._gateway_probes(profile, secrets)
        failed_probes = [name for name, ok in probes.items() if not ok]
        if failed_probes:
            raise RuntimeError(f"Supabase functional probes failed: {', '.join(failed_probes)}")
        return {
            "aggregate": aggregate.value,
            "services": tuple(asdict(state) for state in states),
            "functional_probes": probes,
        }

    def start(self, profile: EnvironmentConfig, secrets: FileSecretProvider) -> bool:
        resolved = self.resolve(profile)
        aggregate, _ = self.detect(profile)
        if aggregate == AggregateState.HEALTHY:
            self.verify(profile, secrets)
            return False
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        project = profile.database.compose.project_name
        changed = False
        for group in START_GROUPS:
            services = tuple(resolved[capability] for capability in group if capability in resolved)
            if not services:
                continue
            pending = []
            for capability in group:
                service = resolved.get(capability)
                if not service:
                    continue
                state = self._service_state(profile, capability, service)
                if state.state != ComponentState.HEALTHY:
                    pending.append(service)
            if not pending:
                continue
            result = self.docker.compose_up(
                root,
                env_file,
                tuple(pending),
                project_name=project,
                wait=False,
                timeout=min(profile.database.startup.supabase_timeout_seconds, 120),
            )
            if result.returncode != 0:
                raise RuntimeError("Supabase service group startup failed")
            changed = True
            deadline = time.monotonic() + profile.database.startup.supabase_timeout_seconds
            while time.monotonic() < deadline:
                group_states = [
                    self._service_state(profile, capability, resolved[capability])
                    for capability in group if capability in resolved and self._required(profile, capability)
                ]
                if group_states and all(state.state == ComponentState.HEALTHY for state in group_states):
                    break
                if not group_states:
                    break
                time.sleep(self.poll_interval_seconds)
            else:
                raise RuntimeError("Supabase service health gate timed out")
        self.verify(profile, secrets)
        return changed
