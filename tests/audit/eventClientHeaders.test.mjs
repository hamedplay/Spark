import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const config = `server {
    listen 443 ssl;
    server_name spark.test;
    ssl_certificate /existing/cert;
    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Spark-Client-IP $http_x_spark_client_ip;
    }
    location /livekit/ {
        proxy_pass http://127.0.0.1:7880;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location / { try_files $uri /index.html; }
}
`;
const patcher = 'deploy/spark-cli/lib/event-client-headers.py';
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'spark-client-headers-'));
  const file = join(dir, 'nginx.conf'); writeFileSync(file, config);
  try { run({ dir, file }); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('header check is read-only; apply overwrites spoofable headers and is idempotent without changing TLS/routing/other upstreams', () => fixture(({ file }) => {
  assert.equal(spawnSync('python3', [patcher, '--check', file]).status, 1);
  assert.equal(readFileSync(file, 'utf8'), config);
  assert.equal(spawnSync('python3', [patcher, '--apply', file]).status, 0);
  const updated = readFileSync(file, 'utf8');
  assert.ok(updated.includes('proxy_set_header X-Spark-Client-IP $remote_addr;'));
  assert.ok(updated.includes('proxy_set_header X-Forwarded-For $remote_addr;'));
  assert.equal(updated.match(/X-Spark-Client-IP /g).length, 1);
  assert.ok(updated.includes('proxy_set_header X-Spark-Client-IP-Source nginx-v2;'));
  assert.ok(updated.includes('ssl_certificate /existing/cert;'));
  assert.ok(updated.includes('proxy_set_header Host $host;'));
  assert.ok(updated.includes('proxy_pass http://127.0.0.1:7880;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'));
  assert.equal(spawnSync('python3', [patcher, '--check', file]).status, 0);
  assert.equal(spawnSync('python3', [patcher, '--apply', file]).status, 0);
  assert.equal(readFileSync(file, 'utf8'), updated);
}));
test('explicit trusted proxy CIDR passes and is preserved on subsequent normal updates', () => fixture(({ file }) => {
  assert.equal(spawnSync('python3', [patcher, '--apply', file, '--trusted-proxy', 'bad-cidr']).status, 1);
  assert.equal(readFileSync(file, 'utf8'), config);
  assert.equal(spawnSync('python3', [patcher, '--apply', file, '--trusted-proxy', '172.18.0.7/32']).status, 0);
  const updated = readFileSync(file, 'utf8');
  assert.ok(updated.includes('set_real_ip_from 172.18.0.7/32;'));
  assert.ok(updated.includes('real_ip_recursive on;'));
  assert.ok(updated.includes('real_ip_header X-Forwarded-For;'));
  assert.ok(updated.includes('proxy_set_header X-Spark-Client-IP $remote_addr;'));
  assert.equal(spawnSync('python3', [patcher, '--check', file, '--trusted-proxy', '172.18.0.7/32']).status, 0);
  assert.equal(spawnSync('python3', [patcher, '--apply', file]).status, 0);
  assert.equal(readFileSync(file, 'utf8'), updated);
}));
test('unsupported inline Supabase locations fail without a partial write', () => fixture(({ file }) => {
  const unsupported = `${config}\nserver {\n    location / { proxy_pass http://127.0.0.1:8000; }\n}\n`;
  writeFileSync(file, unsupported);
  assert.equal(spawnSync('python3', [patcher, '--apply', file]).status, 1);
  assert.equal(readFileSync(file, 'utf8'), unsupported);
}));
test('failed Nginx validation restores the exact prior config and reports failure', () => fixture(({ dir, file }) => {
  for (const [name, body] of [['nginx', '#!/bin/sh\nexit 1\n'], ['systemctl', '#!/bin/sh\nexit 0\n']]) {
    writeFileSync(join(dir, name), body); chmodSync(join(dir, name), 0o700);
  }
  const result = spawnSync('bash', ['deploy/spark-cli/apply-event-client-headers.sh', '--apply', file], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1); assert.equal(readFileSync(file, 'utf8'), config);
  assert.match(result.stderr, /previous Nginx config restored/);
  assert.doesNotMatch(result.stdout, /forwarding enabled/);
}));
