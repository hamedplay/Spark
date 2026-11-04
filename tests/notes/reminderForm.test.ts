import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { liveReaderHarness } from '../realtime/liveReaderHarness';

async function render(reminderAt: string | null) {
  const harness = await liveReaderHarness([]);
  try {
  const { CreateNoteForm } = await harness.load('/src/components/Notes/CreateNoteForm.tsx');
  return renderToStaticMarkup(createElement(CreateNoteForm, {
    newNote: { title: 'یادداشت من', content: 'پیگیری کار' },
    setNewNote() {}, onSubmit() {}, isFormRecording: false, onToggleRecording() {},
    reminderAt, onReminderChange() {},
  }));
  } finally { await harness.close(); }
}

test('reminder is optional when creating a note', async () => {
  const html = await render(null);
  assert.ok(html.includes('یادآوری'));
  assert.ok(!html.includes('تاریخ یادآوری'));
  assert.ok(html.includes('ذخیره یادداشت'));
});

test('enabled reminder exposes Jalali date, time and two-day shortcut', async () => {
  const html = await render('2099-11-06T12:00:00Z');
  assert.ok(html.includes('تاریخ یادآوری'));
  assert.ok(html.includes('ساعت یادآوری'));
  assert.ok(html.includes('دو روز بعد'));
  assert.ok(html.includes('type="time"'));
});
