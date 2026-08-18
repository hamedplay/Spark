import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const src = readFileSync(join(process.cwd(), 'src', 'auth-login-unified-tabs.ts'), 'utf8');

test('unified password identifier does not inherit native email validation', () => {
  assert.ok(
    src.includes('form.noValidate = true'),
    'unified login form must disable native constraint validation before method inference',
  );
  assert.ok(
    src.includes("if (input.type !== 'text') input.type = 'text'"),
    'unified identifier must be presented as text so username/mobile are not rejected as email',
  );
  assert.ok(
    src.includes('const target = targetCredentialButton(panel, input.value)'),
    'credential method must still be inferred from the submitted identifier',
  );
});
