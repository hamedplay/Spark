from __future__ import annotations

from config.models import ApplicationLiveKitConfig


def livekit_network_requirements(config: ApplicationLiveKitConfig) -> tuple[dict[str, object], ...]:
    return (
        {"protocol": "tcp", "port": config.api_port, "purpose": "LiveKit API/WebSocket via reverse proxy", "verification": "AUTO_VERIFY"},
        {"protocol": "tcp", "port": config.rtc_tcp_port, "purpose": "LiveKit RTC TCP direct client traffic", "verification": "GUIDED"},
        {"protocol": "udp", "range": f"{config.rtc_udp_start}-{config.rtc_udp_end}", "purpose": "LiveKit RTC UDP direct client traffic", "verification": "GUIDED"},
    )
