from __future__ import annotations


class SecretRedactor:
    def __init__(self) -> None:
        self._values: set[str] = set()

    def register(self, value: str) -> None:
        if value:
            self._values.add(value)

    def register_many(self, values) -> None:
        for value in values:
            self.register(value)

    def redact(self, text: str) -> str:
        result = str(text)
        for value in sorted(self._values, key=len, reverse=True):
            result = result.replace(value, "***")
        return result
