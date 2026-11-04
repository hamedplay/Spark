import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

// Execute the production event handlers with a controllable speech engine.
// State setters deliberately do not refresh the original render's transcript.
const source = readFileSync(new URL('../../src/components/NotesPage.tsx', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const handlers = stripTypeScriptTypes([
  between('  const getSpeechRecognitionAPI', '\n  useEffect('),
  between('  const toggleRecording', '\n  const handleCreateNote'),
].join('\n'));

function harness({ ios = true, mobile = true } = {}) {
  const engines = [];
  const saved = [];
  const errors = [];
  const state = { content: '', recording: false, formRecording: false, permissionRequests: 0 };
  class Recognition {
    start() {
      if (state.startError) throw new Error('Speech service unavailable');
      this.started = true;
    }
    stop() { this.stopped = true; }
    constructor() { engines.push(this); }
  }
  const ref = () => ({ current: '' });
  const context = {
    window: { webkitSpeechRecognition: Recognition },
    isIOS: ios, isMobile: mobile, userId: 'test-user', voiceTranscript: '',
    isRecording: false, isFormRecording: false,
    hasRecordingPermission: false,
    recognitionRef: { current: null }, formRecognitionRef: { current: null },
    lastResultRef: ref(), finalTranscriptRef: ref(),
    formLastResultRef: ref(), formFinalTranscriptRef: ref(),
    setIsRecording: value => { state.recording = value; },
    setIsFormRecording: value => { state.formRecording = value; },
    setVoiceTranscript() {}, setHasRecordingPermission() {}, setNotes() {},
    setNewNote: update => { state.content = update({ content: state.content }).content; },
    toast: { error: message => errors.push(message), success() {} },
    requestRecordingPermission: async () => { state.permissionRequests++; return true; },
    supabase: { from: () => ({ insert: rows => {
      saved.push(...rows);
      return { select: () => ({ single: async () => ({ data: rows[0], error: null }) }) };
    } }) },
  };
  const run = new Function(...Object.keys(context), `${handlers}\nreturn { toggleRecording };`);
  return { ...run(...Object.values(context)), engines, saved, errors, state };
}

function result(engine, transcript, final = true) {
  const entry = [{ transcript }];
  entry.isFinal = final;
  engine.onresult({ resultIndex: 0, results: [entry] });
}

test('iPhone starts in the click call stack without opening another audio stream', () => {
  const h = harness();
  h.toggleRecording(true);
  assert.equal(h.engines.length, 1);
  assert.equal(h.engines[0].started, true);
  assert.equal(h.engines[0].continuous, false);
  assert.equal(h.engines[0].lang, 'fa-IR');
  assert.equal(h.state.permissionRequests, 0);
});

test('iPhone form receives the recognized final text', async () => {
  const h = harness();
  await h.toggleRecording(true);
  const engine = h.engines[0];
  engine.onstart();
  result(engine, 'متن یادداشت');
  engine.onend();
  assert.equal(h.state.content, 'متن یادداشت');
  assert.equal(h.state.formRecording, false);
  assert.equal(h.saved.length, 0);
});

test('mobile auto-save uses the final result despite stale render state', async () => {
  const h = harness();
  await h.toggleRecording();
  const engine = h.engines[0];
  engine.onstart();
  result(engine, 'یادداشت جدید من');
  engine.onend();
  engine.onend();
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].content, 'یادداشت جدید من');
});

test('manual stop waits for the final result and saves once on desktop too', async () => {
  const h = harness({ ios: false, mobile: false });
  await h.toggleRecording();
  const engine = h.engines[0];
  engine.onstart();
  result(engine, 'متن موقت', false);
  await h.toggleRecording();
  assert.equal(engine.stopped, true);
  assert.equal(h.saved.length, 0);
  result(engine, 'متن نهایی');
  engine.onend();
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].content, 'متن نهایی');
  assert.equal(h.state.permissionRequests, 1);
});

for (const error of ['language-not-supported', 'service-not-allowed', 'not-allowed', 'no-speech']) {
  test(`iPhone ${error} is visible and does not create an empty note`, async () => {
    const h = harness();
    await h.toggleRecording();
    const engine = h.engines[0];
    engine.onstart();
    engine.onerror({ error });
    engine.onend();
    assert.equal(h.errors.length, 1);
    assert.equal(h.state.recording, false);
    assert.equal(h.saved.length, 0);
  });
}
test('a synchronous startup failure allows retrying with a new session', async () => {
  const h = harness();
  h.state.startError = true;
  await h.toggleRecording(true);
  assert.equal(h.errors.length, 1);
  h.state.startError = false;
  await h.toggleRecording(true);
  assert.equal(h.engines.length, 2);
  assert.equal(h.engines[1].started, true);
});
