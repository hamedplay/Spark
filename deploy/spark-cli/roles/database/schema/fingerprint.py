from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SchemaFingerprint:
    version: int
    digest: str


def build_fingerprint(*_args, **_kwargs) -> SchemaFingerprint:
    raise NotImplementedError("schema fingerprinting is implemented in M3.6-C")
