from __future__ import annotations

import re
from typing import Any


class YamlProfileError(ValueError):
    pass


def _scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value == "{}":
        return {}
    if value == "[]":
        return []
    lower = value.lower()
    if lower in {"true", "false"}:
        return lower == "true"
    if lower in {"null", "none", "~"}:
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [] if not inner else [_scalar(part.strip()) for part in inner.split(",")]
    return value


def _tokens(text: str) -> list[tuple[int, str]]:
    tokens: list[tuple[int, str]] = []
    for line_no, raw in enumerate(text.splitlines(), start=1):
        if "\t" in raw:
            raise YamlProfileError(f"tabs are not allowed in YAML profiles (line {line_no})")
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        content = raw.lstrip(" ")
        indent = len(raw) - len(content)
        if indent % 2:
            raise YamlProfileError(f"indentation must use multiples of two spaces (line {line_no})")
        tokens.append((indent, content))
    return tokens


def _split_mapping(text: str) -> tuple[str, str]:
    if ":" not in text:
        raise YamlProfileError(f"expected mapping entry, got: {text!r}")
    key, value = text.split(":", 1)
    key = key.strip()
    if not key:
        raise YamlProfileError("empty mapping key is not allowed")
    return key, value.strip()


def _parse_block(tokens: list[tuple[int, str]], index: int, indent: int) -> tuple[Any, int]:
    if index >= len(tokens):
        return {}, index
    is_list = tokens[index][1].startswith("- ") or tokens[index][1] == "-"
    container: Any = [] if is_list else {}

    while index < len(tokens):
        current_indent, text = tokens[index]
        if current_indent < indent:
            break
        if current_indent > indent:
            raise YamlProfileError(f"unexpected indentation near {text!r}")

        if is_list:
            if not text.startswith("-"):
                break
            item_text = text[1:].strip()
            if not item_text:
                if index + 1 >= len(tokens) or tokens[index + 1][0] <= indent:
                    container.append(None)
                    index += 1
                    continue
                value, index = _parse_block(tokens, index + 1, tokens[index + 1][0])
                container.append(value)
                continue
            if ":" in item_text:
                key, raw_value = _split_mapping(item_text)
                item: dict[str, Any] = {}
                if raw_value:
                    item[key] = _scalar(raw_value)
                    index += 1
                else:
                    if index + 1 < len(tokens) and tokens[index + 1][0] > indent:
                        value, index = _parse_block(tokens, index + 1, tokens[index + 1][0])
                        item[key] = value
                    else:
                        item[key] = {}
                        index += 1
                while index < len(tokens) and tokens[index][0] > indent:
                    child_indent = tokens[index][0]
                    child, index = _parse_block(tokens, index, child_indent)
                    if not isinstance(child, dict):
                        raise YamlProfileError("list mapping continuation must be a mapping")
                    item.update(child)
                container.append(item)
                continue
            container.append(_scalar(item_text))
            index += 1
            continue

        if text.startswith("-"):
            break
        key, raw_value = _split_mapping(text)
        if key in container:
            raise YamlProfileError(f"duplicate key: {key}")
        if raw_value:
            container[key] = _scalar(raw_value)
            index += 1
            continue
        if index + 1 < len(tokens) and tokens[index + 1][0] > indent:
            value, index = _parse_block(tokens, index + 1, tokens[index + 1][0])
            container[key] = value
        else:
            container[key] = {}
            index += 1
    return container, index


def safe_load_profile(text: str) -> dict[str, Any]:
    tokens = _tokens(text)
    if not tokens:
        return {}
    if tokens[0][0] != 0:
        raise YamlProfileError("top-level YAML content must start at indentation 0")
    result, index = _parse_block(tokens, 0, 0)
    if index != len(tokens) or not isinstance(result, dict):
        raise YamlProfileError("profile root must be a mapping")
    return result
