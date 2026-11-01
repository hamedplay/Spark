import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateScheduleTimes } from '../../src/components/CalendarMeetingForm/validateScheduleTimes';
import { renderSystemSmsTemplate } from '../../supabase/functions/send-sms/templateRenderer';
import { DateTimeSection } from '../../src/components/CalendarMeetingForm/DateTimeSection';

test('reject missing start/end without deriving a fictitious duration', () => {
  assert.match(validateScheduleTimes('09:30', '')!, /پایان/);
  assert.match(validateScheduleTimes('', '10:30')!, /شروع/);
  assert.match(validateScheduleTimes('09:30', '   ')!, /پایان/);
  assert.equal(validateScheduleTimes('25:00', '10:00'), 'ساعت شروع و پایان جلسه معتبر نیست.');
});
test('accept explicit browser and persisted times, preserving midnight/overnight support', () => {
  for (const [start, end] of [['09:30', '10:30'], ['09:30:00', '10:30:00.000000'], ['23:30', '00:30'], ['00:00', '01:00']]) {
    assert.equal(validateScheduleTimes(start, end), null);
  }
});
test('actual submit handler stops incomplete schedules before starting persistence/notification flow', async () => {
  const source = readFileSync('src/components/CalendarMeetingForm.tsx', 'utf8');
  const signature = 'const handleSubmit = async (e: FormEvent) => {';
  const start = source.indexOf(signature);
  const end = source.indexOf('    setLoading(true);', start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transform(`async function submit(e: any) {${source.slice(start + signature.length, end)} return 'ready-to-persist'; }`, { loader: 'ts' });
  for (const endTime of ['', '10:30']) {
    const errors: string[] = [];
    let editorOpened = false;
    const sandbox: any = {
      validateScheduleTimes, creationRecoveryErrorRef: { current: null }, userId: 'user',
      subject: 'Test', scheduleDate: { jy: 1405, jm: 8, jd: 10 }, orgUsersLoading: false,
      orgAllUsers: [{ user_id: 'user', full_name: 'Test user' }], startTime: '09:30', endTime,
      toast: { error: (error: string) => errors.push(error) },
      setShowManualDateTime: (value: boolean) => { editorOpened = value; },
    };
    vm.runInNewContext(code, sandbox);
    const result = await sandbox.submit({ preventDefault() {} });
    assert.equal(result, endTime ? 'ready-to-persist' : undefined);
    assert.equal(editorOpened, !endTime);
    assert.equal(errors.length, endTime ? 0 : 1);
  }
});
test('incomplete existing schedule exposes required time inputs and retains its known start', () => {
  const props = {
    scheduleDate: { jy: 1405, jm: 8, jd: 10 }, showManualDateTime: false,
    manualDateStr: '', manualStartTime: '', manualEndTime: '', startTime: '09:30', endTime: '',
    setShowManualDateTime() {}, setManualDateStr() {}, setManualStartTime() {}, setManualEndTime() {},
    setStartTime() {}, setEndTime() {}, setScheduleDate() {},
  };
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = React;
  try {
  const markup = renderToStaticMarkup(createElement(DateTimeSection, props));
  const timeInputs = [...markup.matchAll(/<input[^>]*type="time"[^>]*>/g)].map(match => match[0]);
  assert.equal(timeInputs.length, 2);
  assert.ok(timeInputs.every(input => input.includes('required=""')));
  assert.ok(timeInputs[0].includes('value="09:30"'));
  assert.ok(timeInputs[1].includes('value=""'));
  assert.match(markup, /value="1405\/08\/10"/);
  const complete = renderToStaticMarkup(createElement(DateTimeSection, { ...props, endTime: '10:30' }));
  assert.doesNotMatch(complete, /type="time"/);
  } finally {
    if (previousReact === undefined) delete (globalThis as any).React;
    else (globalThis as any).React = previousReact;
  }
});

test('SMS renderer preserves strict missing-time checks and uses the recorded end after correction', async () => {
  for (const endTime of ['', '10:30']) {
    const supabase = { from(table: string) {
      const query: any = { select() { return query; }, eq() { return query; },
        maybeSingle: async () => ({ data: table === 'sms_templates'
          ? { id: 'template', body: '{{start_time}} تا {{end_time}}' }
          : { start_time: '09:30', end_time: endTime } }),
      };
      return query;
    } };
    const result = await renderSystemSmsTemplate({ supabase, category: 'meeting', eventType: 'invite', audience: 'participants', meetingId: 'meeting' });
    if (!endTime) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual(result.missing, ['end_time']);
    } else {
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.text, '09:30 تا 10:30');
    }
  }
});
