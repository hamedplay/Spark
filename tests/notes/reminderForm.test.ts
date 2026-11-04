import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { liveReaderHarness } from '../realtime/liveReaderHarness';

async function render(reminderAt: string | null, recipientIds: string[] = []) {
  const harness = await liveReaderHarness([]);
  try {
  const { CreateNoteForm } = await harness.load('/src/components/Notes/CreateNoteForm.tsx');
  return renderToStaticMarkup(createElement(CreateNoteForm, {
    newNote: { title: 'یادداشت من', content: 'پیگیری کار' },
    setNewNote() {}, onSubmit() {}, isFormRecording: false, onToggleRecording() {},
    reminderAt, onReminderChange() {},
    reminderUserIds: recipientIds, onReminderUsersChange() {},
    reminderUsers: [{ user_id: 'selected', full_name: 'کاربر منتخب' }, { user_id: 'available', full_name: 'کاربر دیگر' }],
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

test('reminder shows selected recipients and offers only remaining users', async () => {
  const html = await render('2099-11-06T12:00:00Z', ['selected']);
  assert.ok(html.includes('کاربر منتخب'));
  assert.ok(html.includes('value="available"'));
  assert.ok(!html.includes('option value="selected"'));
  assert.ok(html.includes('عنوان و متن یادداشت'));
});
