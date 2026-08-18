from __future__ import annotations

import pathlib
import subprocess

# One-time exhaustive scan of tracked, non-binary repository files.
THRESHOLD = 1000
NEAR_THRESHOLD = 800
REPORT = pathlib.Path("scripts/.large-files-scan.txt")
SKIP_PATHS = {
    "scripts/scan-large-files.py",
    "scripts/.large-files-scan.txt",
    ".github/workflows/scan-large-files.yml",
}

raw = subprocess.check_output(["git", "ls-files", "-z"])
paths = [p.decode("utf-8") for p in raw.split(b"\0") if p]

text_files: list[tuple[int, str]] = []
binary_files = 0
missing_files = 0

for rel in paths:
    if rel in SKIP_PATHS:
        continue
    path = pathlib.Path(rel)
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        missing_files += 1
        continue

    if b"\0" in data[:8192]:
        binary_files += 1
        continue

    lines = data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)
    text_files.append((lines, rel))

text_files.sort(key=lambda item: (-item[0], item[1]))
oversized = [(n, p) for n, p in text_files if n > THRESHOLD]
near = [(n, p) for n, p in text_files if NEAR_THRESHOLD <= n <= THRESHOLD]

lines_out = [
    f"threshold={THRESHOLD}",
    f"near_threshold={NEAR_THRESHOLD}",
    f"tracked_paths_considered={len(paths) - len(SKIP_PATHS & set(paths))}",
    f"text_files_scanned={len(text_files)}",
    f"binary_files_skipped={binary_files}",
    f"missing_files_skipped={missing_files}",
    f"oversized_files={len(oversized)}",
    f"near_threshold_files={len(near)}",
    "",
    "[oversized >1000 lines]",
]
lines_out.extend(f"{n}\t{p}" for n, p in oversized)
lines_out.extend(["", "[near threshold 800-1000 lines]"])
lines_out.extend(f"{n}\t{p}" for n, p in near)
lines_out.extend(["", "[top 30 text files]"])
lines_out.extend(f"{n}\t{p}" for n, p in text_files[:30])

REPORT.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
print(REPORT.read_text(encoding="utf-8"))
