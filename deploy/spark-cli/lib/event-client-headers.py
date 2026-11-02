#!/usr/bin/env python3
"""Overwrite client-controlled IP headers only in Spark's local Supabase locations."""
import re
import sys
from pathlib import Path

mode, filename = sys.argv[1:]
if mode not in ('--check', '--apply'):
    raise SystemExit('Expected --check or --apply')
path = Path(filename)
original = path.read_text(encoding='utf-8')
locations = re.compile(r'(?m)^([ \t]*)location[^\n]*\{[ \t]*\n(.*?)^\1\}', re.S)
count = 0


def patch(match):
    global count
    body = match.group(2)
    upstream = re.compile(r'(?m)^([ \t]*)proxy_pass\s+http://127\.0\.0\.1:8000\s*;[ \t]*$')
    if not upstream.search(body):
        return match.group(0)
    count += 1
    body = re.sub(r'(?mi)^[ \t]*(?:# SPARK_EVENT_CLIENT_IP|proxy_set_header\s+(?:X-Spark-Client-IP|X-Real-IP|X-Forwarded-For)\s+[^;]+;)[ \t]*\n', '', body)

    def headers(upstream_match):
        indent = upstream_match.group(1)
        return upstream_match.group(0) + '\n' + '\n'.join(indent + line for line in (
            '# SPARK_EVENT_CLIENT_IP',
            'proxy_set_header X-Spark-Client-IP $remote_addr;',
            'proxy_set_header X-Real-IP $remote_addr;',
            'proxy_set_header X-Forwarded-For $remote_addr;',
        ))

    return match.group(0).replace(match.group(2), upstream.sub(headers, body), 1)


updated = locations.sub(patch, original)
if not count:
    raise SystemExit('No Spark Supabase locations found; no changes made.')
expected = len(re.findall(r'(?m)^[^#\n]*\bproxy_pass\s+http://127\.0\.0\.1:8000\s*;', original))
if count != expected:
    raise SystemExit('Unrecognized Supabase location layout; no changes made. Review the Nginx config.')
if mode == '--check':
    print(f'Supabase locations: {count}; client IP headers ready: {updated == original}')
    raise SystemExit(0 if updated == original else 1)
if updated != original:
    path.write_text(updated, encoding='utf-8')
print(f'Client IP headers verified for {count} Supabase locations.')
