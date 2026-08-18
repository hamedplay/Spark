import assert from 'node:assert/strict';
import test from 'node:test';

import { isKnownSparkPath } from '../../src/app/navigation/rootPath';

test('accepts the application root and existing admin route', () => {
  assert.equal(isKnownSparkPath('/'), true);
  assert.equal(isKnownSparkPath('/admin'), true);
  assert.equal(isKnownSparkPath('/admin/'), true);
  assert.equal(isKnownSparkPath('/admin/settings'), true);
});

test('rejects unknown application pathnames', () => {
  assert.equal(isKnownSparkPath('/404-test'), false);
  assert.equal(isKnownSparkPath('/meetings'), false);
  assert.equal(isKnownSparkPath('/anything/admin'), false);
});

test('normalizes empty and trailing-slash root values safely', () => {
  assert.equal(isKnownSparkPath(''), true);
  assert.equal(isKnownSparkPath('///'), true);
});
