#!/usr/bin/env python3
"""Overwrite client-controlled IP headers on Spark Supabase ingress locations.

A real client address behind a preceding proxy requires an explicitly approved
CIDR. Do not trust arbitrary forwarded headers or whole Docker subnets.
"""
import ipaddress
import re
import sys
from pathlib import Path

if len(sys.argv) < 3:
    raise SystemExit('Usage: event-client-headers.py --check|--apply CONFIG [--trusted-proxy CIDR]...')
mode, filename, *args = sys.argv[1:]
if mode not in ('--check', '--apply'):
    raise SystemExit('Expected --check or --apply')
trusted = []
while args:
    if len(args) < 2 or args[0] != '--trusted-proxy':
        raise SystemExit('Expected --trusted-proxy CIDR')
    try:
        network = str(ipaddress.ip_network(args[1], strict=False))
    except ValueError as exc:
        raise SystemExit('Invalid trusted proxy CIDR') from exc
    if network not in trusted:
        trusted.append(network)
    args = args[2:]
if len(trusted) > 16:
    raise SystemExit('Too many trusted proxies; review topology')
path = Path(filename)
original = path.read_text(encoding='utf-8')
locations = re.compile(r'(?m)^([ \t]*)location[^\n]*\{[ \t]*\n(.*?)^\1\}', re.S)
upstream = re.compile(r'(?m)^([ \t]*)proxy_pass\s+http://127\.0\.0\.1:8000\s*;[ \t]*$')
tagged_realip = re.compile(r'(?ms)^[ \t]*# SPARK_TRUSTED_REAL_IP_BEGIN\n.*?^[ \t]*# SPARK_TRUSTED_REAL_IP_END\n')
count = 0

def patch(match):
    global count
    body = match.group(2)
    if not upstream.search(body):
        return match.group(0)
    count += 1
    # Preserve the last explicit admin-specified trusted CIDRs on updates where
    # no --trusted-proxy flags are supplied (including normal app deployments).
    effective_trusted = list(trusted)
    old_block = tagged_realip.search(body)
    if old_block and not effective_trusted:
        for cidr in re.findall(r'(?m)^\s*set_real_ip_from\s+([^;]+);$', old_block.group(0)):
            network = str(ipaddress.ip_network(cidr.strip(), strict=False))
            if network not in effective_trusted:
                effective_trusted.append(network)
    body = tagged_realip.sub('', body)
    body = re.sub(r'(?mi)^[ \t]*(?:# SPARK_EVENT_CLIENT_IP|proxy_set_header\s+(?:X-Spark-Client-IP(?:-Source)?|X-Real-IP|X-Forwarded-For)\s+[^;]+;)[ \t]*\n', '', body)

    def headers(upstream_match):
        indent = upstream_match.group(1)
        lines = []
        if effective_trusted:
            lines.append('# SPARK_TRUSTED_REAL_IP_BEGIN')
            lines.extend(f'set_real_ip_from {cidr};' for cidr in effective_trusted)
            lines.extend(['real_ip_header X-Forwarded-For;', 'real_ip_recursive on;', '# SPARK_TRUSTED_REAL_IP_END'])
        lines.extend([
            '# SPARK_EVENT_CLIENT_IP',
            'proxy_set_header X-Spark-Client-IP $remote_addr;',
            'proxy_set_header X-Spark-Client-IP-Source nginx-v2;',
            'proxy_set_header X-Real-IP $remote_addr;',
            'proxy_set_header X-Forwarded-For $remote_addr;',
        ])
        return upstream_match.group(0) + '\n' + '\n'.join(indent + line for line in lines)

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
