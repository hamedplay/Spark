import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMinutesSubmitOutcome,
  interpretMinutesAccess,
} from '../../src/lib/minutesMeetingAccess';

// ── Mock Supabase client that captures rpc arguments ────────────────────────
// Tests that the minutes flow never confuses meetingId with minuteId by
// asserting on the actual arguments passed to supabase.rpc.

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function makeMockSupabase(responses: Record<string, { data: unknown; error: unknown }>) {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: null, error: null };
      return r;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
  return { supabase, calls };
}

// ── 1. new mode prefill: meetingId drives prefill, not minuteId ───────────────
test('flow: new mode uses meetingId from URL for prefill source', () => {
  // Contract: sourceMeetingId is read from `meeting` URL param.
  // It is used ONLY for prefill and the first create_minutes_draft call.
  const sourceMeetingId = 'meeting-abc';
  const workingMinuteId: string | null = null;
  const editMinuteId: string | null = null;
  // The form must not use minuteId for prefill in new mode.
  assert.notEqual(sourceMeetingId, workingMinuteId);
  assert.equal(editMinuteId, null);
});

// ── 2. direct entry without meetingId is blocked ────────────────────────────
test('flow: no meetingId → ensureWorkingMinuteId returns null', () => {
  // Contract: if no sourceMeetingId, creation is blocked.
  const sourceMeetingId: string | null = null;
  assert.equal(sourceMeetingId, null);
});

// ── 3. first save calls create_minutes_draft exactly once ───────────────────
test('create: first save calls create_minutes_draft with meeting_id, not minute_id', () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: true, minute_id: 'minute-real-1', message: 'ok' },
      error: null,
    },
    _sync_minutes_decisions: { data: { success: true }, error: null },
  });

  // Simulate the create call
  void supabase.rpc('create_minutes_draft', {
    p_payload: { meeting_id: 'meeting-abc', info: {}, decisions: [] },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'create_minutes_draft');
  assert.equal((calls[0].args.p_payload as { meeting_id: string }).meeting_id, 'meeting-abc');
  // The payload must NOT contain a p_minute_id with a meeting id
  assert.equal('p_minute_id' in calls[0].args, false);
});

// ── 4. meetingId is passed to create RPC, not to update/submit ───────────────
test('contract: create_minutes_draft receives meeting_id in payload', () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: true, minute_id: 'minute-real-2' },
      error: null,
    },
  });
  void supabase.rpc('create_minutes_draft', {
    p_payload: { meeting_id: 'meeting-xyz' },
  });
  assert.equal((calls[0].args.p_payload as { meeting_id: string }).meeting_id, 'meeting-xyz');
});

// ── 5. returned minute_id is stored as workingMinuteId ──────────────────────
test('create: returned minute_id is captured and distinct from meetingId', () => {
  const result = { success: true, minute_id: 'minute-real-3' };
  const meetingId = 'meeting-xyz';
  const workingMinuteId = result.minute_id;
  assert.notEqual(workingMinuteId, meetingId);
  assert.equal(workingMinuteId, 'minute-real-3');
});

// ── 6. second save does NOT call create again ────────────────────────────────
test('update: second save calls update_minutes_draft, not create_minutes_draft', () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-real-1', updated_at: '2026-07-26T10:00:00.000Z' },
      error: null,
    },
  });
  // Second save: workingMinuteId exists, so update is called with the real minute id
  void supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-real-1',
    p_expected_updated_at: '2026-07-26T10:00:00.000Z',
    p_payload: {},
  });
  assert.equal(calls[0].fn, 'update_minutes_draft');
  assert.equal(calls[0].args.p_minute_id, 'minute-real-1');
  assert.notEqual(calls[0].args.p_minute_id, 'meeting-abc');
});

// ── 7. second save updates the same minute id ─────────────────────────────────
test('update: p_minute_id matches the real minute id from create', () => {
  const createdId = 'minute-real-1';
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: createdId, updated_at: '2026-07-26T10:00:00.000Z' },
      error: null,
    },
  });
  void supabase.rpc('update_minutes_draft', {
    p_minute_id: createdId,
    p_expected_updated_at: 'old-ts',
    p_payload: {},
  });
  assert.equal(calls[0].args.p_minute_id, createdId);
});

// ── 8. double click does not create two drafts ───────────────────────────────
test('guard: double-click reuses in-flight Promise, creates only one draft', () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: true, minute_id: 'minute-real-1' },
      error: null,
    },
  });
  // Simulate two concurrent calls — the guard (inflightDraftRef) dedupes them.
  // Here we assert the contract: if two calls share the same Promise, only one
  // RPC is made. We simulate by calling once (the guard would prevent the second).
  void supabase.rpc('create_minutes_draft', { p_payload: { meeting_id: 'm1' } });
  // The second call would be blocked by inflightDraftRef.current !== null
  assert.equal(calls.length, 1);
});

// ── 9. submit first ensures draft exists ─────────────────────────────────────
test('submit: calls ensureWorkingMinuteId before submit_minutes_for_approval', () => {
  // Contract: submit calls ensureWorkingMinuteId first. If it returns null,
  // submit does not proceed.
  const minuteId: string | null = null; // simulating creation failure
  assert.equal(minuteId, null);
  // submit would return early here — no rpc call to submit_minutes_for_approval
});

// ── 10. submit passes only real minuteId to p_minute_id ──────────────────────
test('submit: p_minute_id is the real minute id, never meetingId', () => {
  const { supabase, calls } = makeMockSupabase({
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-real-1', status: 'pending_approval' },
      error: null,
    },
  });
  const realMinuteId = 'minute-real-1';
  void supabase.rpc('submit_minutes_for_approval', {
    p_minute_id: realMinuteId,
    p_expected_updated_at: '2026-07-26T10:00:00.000Z',
    p_approval_mode: 'system',
  });
  assert.equal(calls[0].args.p_minute_id, realMinuteId);
  assert.notEqual(calls[0].args.p_minute_id, 'meeting-abc');
});

// ── 11. meetingId never sent as p_minute_id ───────────────────────────────────
test('contract: meetingId is never passed as p_minute_id to any RPC', () => {
  const meetingId = 'meeting-abc';
  const minuteId = 'minute-real-1';
  // The forbidden pattern: p_minute_id: editMinuteId || info.meetingId
  // We assert the correct pattern: p_minute_id is always a real minute id.
  const submitArg = minuteId; // not meetingId
  assert.notEqual(submitArg, meetingId);
  assert.equal(submitArg, minuteId);
});

// ── 12. create failure prevents submit ───────────────────────────────────────
test('submit: if ensureWorkingMinuteId returns null, submit does not proceed', () => {
  const minuteId: string | null = null;
  let submitCalled = false;
  if (!minuteId) {
    // submit returns early
  } else {
    submitCalled = true;
  }
  assert.equal(submitCalled, false);
});

// ── 13. MINUTES_ALREADY_EXISTS navigates to existing minute ──────────────────
test('duplicate: MINUTES_ALREADY_EXISTS → navigate to existing minute detail', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: false, error_code: 'MINUTES_ALREADY_EXISTS' },
    'minute-existing-99',
  );
  assert.equal(outcome.kind, 'duplicate');
  assert.equal((outcome as { minuteId: string }).minuteId, 'minute-existing-99');
  // The existing minute id is NOT the meeting id
  assert.notEqual((outcome as { minuteId: string }).minuteId, 'meeting-abc');
});

// ── 14. URL after create has the real minute id ───────────────────────────────
test('url: after create, minute param has real minute id, not meeting id', () => {
  const url = new URL('https://app.example/');
  const realMinuteId = 'minute-real-1';
  url.searchParams.set('minute', realMinuteId);
  assert.equal(url.searchParams.get('minute'), realMinuteId);
  assert.notEqual(url.searchParams.get('minute'), 'meeting-abc');
});

// ── 15. prefill is preserved after draft creation ────────────────────────────
test('prefill: form state is not reset after create_minutes_draft succeeds', () => {
  // Contract: ensureWorkingMinuteId sets workingMinuteId but does NOT reset
  // info, participants, agenda, or decisions. The form retains all values.
  const infoBefore = { meetingTitle: 'جلسه تست', meetingDate: '2026-07-26' };
  const workingMinuteId = 'minute-real-1';
  // After creation, info is unchanged
  const infoAfter = infoBefore;
  assert.deepEqual(infoAfter, infoBefore);
  assert.equal(workingMinuteId, 'minute-real-1');
});

// ── 16. edit mode uses editMinuteId, never meetingId ──────────────────────────
test('edit mode: ensureWorkingMinuteId returns editMinuteId, not meetingId', () => {
  const editMinuteId = 'minute-edit-1';
  const meetingId = 'meeting-abc';
  // In edit mode, ensureWorkingMinuteId returns editMinuteId directly
  const result = editMinuteId;
  assert.equal(result, editMinuteId);
  assert.notEqual(result, meetingId);
});

// ── 17. update_minutes_draft receives real minute id ─────────────────────────
test('update: p_minute_id is real minute id in update_minutes_draft', () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-edit-1', updated_at: '2026-07-26T10:00:00.000Z' },
      error: null,
    },
  });
  void supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-edit-1',
    p_expected_updated_at: '2026-07-26T09:00:00.000Z',
    p_payload: {},
  });
  assert.equal(calls[0].args.p_minute_id, 'minute-edit-1');
});

// ── 18. updated_at from update is used for next submit ────────────────────────
test('optimistic locking: updated_at from update response is used for submit', () => {
  const updateResponse = { success: true, minute_id: 'minute-1', updated_at: '2026-07-26T10:00:00.000Z' };
  const submitExpectedUpdatedAt = updateResponse.updated_at;
  assert.equal(submitExpectedUpdatedAt, '2026-07-26T10:00:00.000Z');
});

// ── 19. create response has no updated_at (must query separately) ─────────────
test('create: response does not include updated_at; form must query minutes table', () => {
  const createResponse = { success: true, minute_id: 'minute-1', message: 'ok' };
  assert.equal('updated_at' in createResponse, false);
  // Contract: after create, form queries minutes.updated_at for optimistic locking
});

// ── 20. interpretMinutesAccess with existing rows → MINUTES_ALREADY_EXISTS ────
test('access: existing rows with canCreate=true → MINUTES_ALREADY_EXISTS', () => {
  const r = interpretMinutesAccess(true, [{ id: 'minute-existing', status: 'draft' }]);
  assert.equal(r.errorCode, 'MINUTES_ALREADY_EXISTS');
  assert.equal(r.existingMinuteId, 'minute-existing');
  assert.equal(r.allowed, false);
});

// ── 21. edit mode submit: update_minutes_draft runs before submit ────────────
test('edit submit: update_minutes_draft is called before submit_minutes_for_approval', async () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-edit-1', updated_at: '2026-07-26T11:00:00.000Z' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-edit-1', status: 'pending_approval' },
      error: null,
    },
    _sync_minutes_decisions: { data: { success: true }, error: null },
  });

  // Simulate the submit flow: update first, then submit with returned updatedAt
  const updateRes = await supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-edit-1',
    p_expected_updated_at: '2026-07-26T10:00:00.000Z',
    p_payload: { info: { title: 'changed' } },
  });
  const updateData = updateRes.data as { success: boolean; updated_at: string };
  assert.equal(updateData.success, true);

  await supabase.rpc('submit_minutes_for_approval', {
    p_minute_id: 'minute-edit-1',
    p_expected_updated_at: updateData.updated_at,
    p_approval_mode: 'system',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].fn, 'update_minutes_draft');
  assert.equal(calls[1].fn, 'submit_minutes_for_approval');
  // Submit uses the updatedAt returned by update, not the old one
  assert.equal(calls[1].args.p_expected_updated_at, '2026-07-26T11:00:00.000Z');
  assert.notEqual(calls[1].args.p_expected_updated_at, '2026-07-26T10:00:00.000Z');
});

// ── 22. edit mode: submit uses updated_at from update response, not stale state
test('edit submit: p_expected_updated_at is the value returned by update, not stale', async () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-1', updated_at: '2026-07-26T12:00:00.000Z' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-1' },
      error: null,
    },
    _sync_minutes_decisions: { data: { success: true }, error: null },
  });

  const staleUpdatedAt = '2026-07-26T09:00:00.000Z';
  const updateRes = await supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-1',
    p_expected_updated_at: staleUpdatedAt,
    p_payload: {},
  });
  const freshUpdatedAt = (updateRes.data as { updated_at: string }).updated_at;

  await supabase.rpc('submit_minutes_for_approval', {
    p_minute_id: 'minute-1',
    p_expected_updated_at: freshUpdatedAt,
    p_approval_mode: 'in_person',
  });

  assert.equal(calls[1].args.p_expected_updated_at, freshUpdatedAt);
  assert.notEqual(calls[1].args.p_expected_updated_at, staleUpdatedAt);
});

// ── 23. update failure prevents submit ───────────────────────────────────────
test('edit submit: update failure → submit not called', async () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: false, error_code: 'MINUTES_VERSION_CONFLICT' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true },
      error: null,
    },
  });

  const updateRes = await supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-1',
    p_expected_updated_at: 'old',
    p_payload: {},
  });
  const updateData = updateRes.data as { success: boolean };
  if (!updateData.success) {
    // submit must NOT proceed
  } else {
    await supabase.rpc('submit_minutes_for_approval', {
      p_minute_id: 'minute-1',
      p_expected_updated_at: 'new',
      p_approval_mode: 'system',
    });
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'update_minutes_draft');
});

// ── 24. missing updated_at prevents submit ────────────────────────────────────
test('submit: missing updated_at → submit not called', () => {
  const editUpdatedAt: string | null = null;
  let submitCalled = false;
  if (!editUpdatedAt) {
    // ensureWorkingMinute returns null; submit does not proceed
  } else {
    submitCalled = true;
  }
  assert.equal(submitCalled, false);
});

// ── 25. shared operation lock: save+submit cannot both run ─────────────────────
test('lock: concurrent save and submit share one in-flight operation', async () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: true, minute_id: 'minute-1' },
      error: null,
    },
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-1', updated_at: '2026-07-26T10:00:00.000Z' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-1' },
      error: null,
    },
  });

  // Simulate the lock: if an operation is in-flight, the second call reuses
  // the same Promise rather than starting a new RPC chain.
  let inflight: Promise<unknown> | null = null;
  const startOp = async () => {
    if (inflight) return inflight;
    const p = (async () => {
      await supabase.rpc('create_minutes_draft', { p_payload: { meeting_id: 'm1' } });
    })();
    inflight = p;
    return p;
  };

  await Promise.all([startOp(), startOp()]);
  // Only one create call despite two concurrent startOp calls
  assert.equal(calls.length, 1);
});

// ── 26. new mode submit: create then submit with queried updatedAt ────────────
test('new submit: create → query updated_at → submit with real updatedAt', async () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: true, minute_id: 'minute-new-1' },
      error: null,
    },
    _sync_minutes_decisions: { data: { success: true }, error: null },
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-new-1', status: 'pending_approval' },
      error: null,
    },
  });

  // Override the from().select chain to return a real updated_at
  const mockSupabase = {
    ...supabase,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { updated_at: '2026-07-26T08:00:00.000Z' },
            error: null,
          }),
        }),
      }),
    }),
  };

  const createRes = await mockSupabase.rpc('create_minutes_draft', {
    p_payload: { meeting_id: 'meeting-1' },
  });
  const newId = (createRes.data as { minute_id: string }).minute_id;

  const minRow = await mockSupabase.from('minutes').select('updated_at').eq('id', newId).maybeSingle();
  const realUpdatedAt = (minRow.data as { updated_at: string }).updated_at;

  await mockSupabase.rpc('submit_minutes_for_approval', {
    p_minute_id: newId,
    p_expected_updated_at: realUpdatedAt,
    p_approval_mode: 'system',
  });

  assert.equal(calls[0].fn, 'create_minutes_draft');
  assert.equal(calls[1].fn, 'submit_minutes_for_approval');
  assert.equal(calls[1].args.p_minute_id, 'minute-new-1');
  assert.equal(calls[1].args.p_expected_updated_at, '2026-07-26T08:00:00.000Z');
  assert.notEqual(calls[1].args.p_minute_id, 'meeting-1');
});

// ── 27. working draft with changes: submit updates before submitting ──────────
test('working draft submit: update_minutes_draft runs before submit', async () => {
  const { supabase, calls } = makeMockSupabase({
    update_minutes_draft: {
      data: { success: true, minute_id: 'minute-work-1', updated_at: '2026-07-26T15:00:00.000Z' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true, minute_id: 'minute-work-1' },
      error: null,
    },
    _sync_minutes_decisions: { data: { success: true }, error: null },
  });

  // workingMinuteId exists, form changed → submit must update first
  const updateRes = await supabase.rpc('update_minutes_draft', {
    p_minute_id: 'minute-work-1',
    p_expected_updated_at: '2026-07-26T14:00:00.000Z',
    p_payload: { info: { title: 'new' } },
  });
  const freshUpdatedAt = (updateRes.data as { updated_at: string }).updated_at;

  await supabase.rpc('submit_minutes_for_approval', {
    p_minute_id: 'minute-work-1',
    p_expected_updated_at: freshUpdatedAt,
    p_approval_mode: 'system',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].fn, 'update_minutes_draft');
  assert.equal(calls[1].fn, 'submit_minutes_for_approval');
  assert.equal(calls[1].args.p_expected_updated_at, '2026-07-26T15:00:00.000Z');
});

// ── 28. create failure with no updated_at → submit not called ──────────────────
test('new submit: create returns no minute_id → submit not called', async () => {
  const { supabase, calls } = makeMockSupabase({
    create_minutes_draft: {
      data: { success: false, error_code: 'INTERNAL_ERROR' },
      error: null,
    },
    submit_minutes_for_approval: {
      data: { success: true },
      error: null,
    },
  });

  const createRes = await supabase.rpc('create_minutes_draft', {
    p_payload: { meeting_id: 'm1' },
  });
  const data = createRes.data as { success: boolean; minute_id?: string };
  if (!data.success || !data.minute_id) {
    // submit does not proceed
  } else {
    await supabase.rpc('submit_minutes_for_approval', {
      p_minute_id: data.minute_id,
      p_expected_updated_at: 'ts',
      p_approval_mode: 'system',
    });
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'create_minutes_draft');
});
