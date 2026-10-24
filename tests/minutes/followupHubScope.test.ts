import assert from 'node:assert/strict';
import test from 'node:test';
import { getInitialFollowupFilter } from '../../src/components/Minutes/followupHubScope';

test('hub attention link opens exactly active decisions marked for follow-up', () => {
  assert.deepEqual(getInitialFollowupFilter('?page=minutes-followup&followup_scope=required'), { statusFilter: 'active', followupOnly: true });
});

test('normal follow-up navigation keeps the existing default filters', () => {
  assert.deepEqual(getInitialFollowupFilter(''), {});
  assert.deepEqual(getInitialFollowupFilter('?followup_scope=unknown'), {});
});

test('unrelated hub scope does not change follow-up selection', () => {
  assert.deepEqual(getInitialFollowupFilter('?minutes_scope=open'), {});
});
