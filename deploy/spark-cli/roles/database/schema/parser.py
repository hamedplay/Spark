from __future__ import annotations

import re
from collections.abc import Iterator
from typing import TextIO

from .models import ParsedStatement

COPY_FROM_STDIN_RE = re.compile(r"^\s*COPY\b[\s\S]*\bFROM\s+stdin\s*;\s*$", re.IGNORECASE)
DOLLAR_TAG_RE = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$")


class SQLParseError(ValueError):
    pass


def iter_statements(stream: TextIO) -> Iterator[ParsedStatement]:
    buffer: list[str] = []
    start_line: int | None = None
    line_no = 0
    in_single = False
    in_double = False
    in_block_comment = False
    dollar_tag: str | None = None
    copy_mode = False
    copy_header: tuple[str, int, int] | None = None
    copy_rows = 0

    for raw_line in stream:
        line_no += 1
        if copy_mode:
            if raw_line.rstrip("\r\n") == r"\." :
                assert copy_header is not None
                text, begin, header_end = copy_header
                yield ParsedStatement(text=text, line_start=begin, line_end=line_no, kind="copy", copy_rows_skipped=copy_rows)
                copy_mode = False
                copy_header = None
                copy_rows = 0
            else:
                copy_rows += 1
            continue

        if not buffer and not in_block_comment and dollar_tag is None:
            stripped = raw_line.lstrip()
            if stripped.startswith("\\"):
                yield ParsedStatement(text=stripped.rstrip("\r\n"), line_start=line_no, line_end=line_no, kind="meta")
                continue

        if start_line is None and raw_line.strip():
            start_line = line_no

        i = 0
        while i < len(raw_line):
            char = raw_line[i]
            nxt = raw_line[i + 1] if i + 1 < len(raw_line) else ""

            if in_block_comment:
                buffer.append(char)
                if char == "*" and nxt == "/":
                    buffer.append(nxt)
                    i += 2
                    in_block_comment = False
                else:
                    i += 1
                continue

            if dollar_tag is not None:
                if raw_line.startswith(dollar_tag, i):
                    buffer.append(dollar_tag)
                    i += len(dollar_tag)
                    dollar_tag = None
                else:
                    buffer.append(char)
                    i += 1
                continue

            if in_single:
                buffer.append(char)
                if char == "'":
                    if nxt == "'":
                        buffer.append(nxt)
                        i += 2
                    else:
                        in_single = False
                        i += 1
                else:
                    i += 1
                continue

            if in_double:
                buffer.append(char)
                if char == '"':
                    if nxt == '"':
                        buffer.append(nxt)
                        i += 2
                    else:
                        in_double = False
                        i += 1
                else:
                    i += 1
                continue

            if char == "-" and nxt == "-":
                buffer.append(raw_line[i:])
                i = len(raw_line)
                continue
            if char == "/" and nxt == "*":
                buffer.extend((char, nxt))
                in_block_comment = True
                i += 2
                continue
            if char == "'":
                buffer.append(char)
                in_single = True
                i += 1
                continue
            if char == '"':
                buffer.append(char)
                in_double = True
                i += 1
                continue
            if char == "$":
                match = DOLLAR_TAG_RE.match(raw_line, i)
                if match:
                    dollar_tag = match.group(0)
                    buffer.append(dollar_tag)
                    i = match.end()
                    continue

            buffer.append(char)
            i += 1
            if char == ";":
                text = "".join(buffer).strip()
                begin = start_line or line_no
                buffer = []
                start_line = None
                if text:
                    if COPY_FROM_STDIN_RE.match(text):
                        copy_mode = True
                        copy_header = (text, begin, line_no)
                        copy_rows = 0
                    else:
                        yield ParsedStatement(text=text, line_start=begin, line_end=line_no)

    if copy_mode:
        raise SQLParseError(f"unterminated COPY payload starting at line {copy_header[1] if copy_header else '?'}")
    if in_single or in_double or in_block_comment or dollar_tag is not None:
        raise SQLParseError("unterminated quoted or comment construct at end of input")
    trailing = "".join(buffer).strip()
    if trailing:
        yield ParsedStatement(text=trailing, line_start=start_line or line_no, line_end=line_no)
