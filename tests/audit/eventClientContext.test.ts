import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUserAgent, eventClientContext, ipSourceTitle } from '../../src/components/UserGroups/eventClientContext';
import { createSessionContextRecorder } from '../../src/features/auth/services/sessionEventContext';

const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.7827.26 Mobile/15E148 Safari/604.1';
test('reduced Android UA does not invent Android 10 or an Apple device from AppleWebKit', () => {
  const result = describeUserAgent(chrome);
  assert.equal(result.platform, 'اندروید'); assert.equal(result.device, 'تلفن همراه');
  assert.equal(result.browser, 'گوگل کروم 153.0.0.0'); assert.match(result.os, /نسخهٔ دقیق اعلام نشده/);
  assert.equal(result.notes.length, 1);
});
test('iPhone Chrome/Firefox and iPad Safari are distinguished before generic WebKit/Chrome', () => {
  const result = describeUserAgent(ios);
  assert.equal(result.os, 'iOS 26.4.2'); assert.equal(result.device, 'تلفن همراه (آیفون)');
  assert.equal(result.browser, 'گوگل کروم 149.0.7827.26');
  assert.equal(describeUserAgent(ios.replace('CriOS/149.0.7827.26', 'FxiOS/145.0')).browser, 'فایرفاکس 145.0');
  const ipad = describeUserAgent('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1');
  assert.equal(ipad.device, 'تبلت (آیپد)'); assert.equal(ipad.os, 'iPadOS 18.1'); assert.equal(ipad.browser, 'سافاری 18.1');
});
test('Edge, Opera, Samsung and Android webview are not incorrectly labelled Chrome', () => {
  for (const [token, name] of [['EdgA/150.1', 'مایکروسافت اج 150.1'], ['OPR/100.3', 'اپرا 100.3'], ['SamsungBrowser/27.0', 'سامسونگ اینترنت 27.0']]) {
    assert.equal(describeUserAgent(`${chrome} ${token}`).browser, name);
  }
  assert.match(describeUserAgent(chrome.replace('; K)', '; K; wv)')).browser, /نمای وب اندروید/);
  assert.equal(describeUserAgent('Mozilla/5.0 (Android 16; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0').os, 'اندروید 16');
});
test('desktop platforms preserve known ambiguities and unknown agents remain unknown', () => {
  const windows = describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36');
  assert.equal(windows.os, 'ویندوز ۱۰ یا ۱۱'); assert.equal(windows.device, 'رایانه');
  assert.match(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15').device, /مک یا آیپد/);
  assert.equal(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/145.0').os, 'لینوکس');
  for (const value of [null, '', 'unknown', {}, 'custom-scanner']) assert.equal(describeUserAgent(value).platform, 'ثبت نشده');
  assert.equal(describeUserAgent('a'.repeat(1000)).userAgent?.length, 512);
  assert.equal(ipSourceTitle('constructor'), 'ثبت نشده');
});
test('event and initial session context remain separate without replacing missing event IP', () => {
  const event = { source: 'security' as const, ip_address: null, metadata: { session_context: {
    ip_address: '2001:db8::7', ip_source: 'proxy_header', user_agent: ios, observed_at: '2026-11-02T12:00:00Z',
  } } };
  const before = JSON.stringify(event);
  const result = eventClientContext(event);
  assert.equal(result.current.ip, null); assert.equal(result.current.userAgent, null);
  assert.equal(result.session?.ip, null); assert.equal(result.session?.reportedIp, '2001:db8::7'); assert.equal(result.session?.platform, 'اپل');
  assert.equal(JSON.stringify(event), before);
  const registry = eventClientContext({ source: 'security', ip_address: null, metadata: { session_device: { user_agent: chrome } } });
  assert.equal(registry.session?.ip, null); assert.match(registry.session!.provenance, /هنگام ثبت نشست/);
});
test('application-supplied UA is labelled as a report; malformed metadata does not crash parsing', () => {
  assert.match(eventClientContext({ source: 'application', ip_address: '192.0.2.1', metadata: { user_agent: chrome } }).current.provenance, /گزارش فعالیت/);
  for (const session_context of [null, '', [], 1]) {
    assert.equal(eventClientContext({ source: 'security', ip_address: null, metadata: { session_context } }).session, null);
  }
});

const full = { access_level: 'FULL', session_id: 'session-a', user_id: 'user-a' };
test('recorder ignores limited sessions, refreshes and duplicate pending calls', async () => {
  let writes = 0;
  let finish!: (value: { error: unknown }) => void;
  const record = createSessionContextRecorder(() => { writes++; return new Promise(resolve => { finish = resolve; }); });
  for (const access_level of ['BLOCKED', 'MFA_REQUIRED', 'PROFILE_REQUIRED']) await record({ ...full, access_level });
  await record({ ...full, session_id: null }); assert.equal(writes, 0);
  const pending = record(full);
  await record(full); assert.equal(writes, 1);
  finish({ error: null }); await pending;
  await record(full); assert.equal(writes, 1);
  const other = record({ ...full, session_id: 'session-b' });
  finish({ error: null }); await other; assert.equal(writes, 2);
});
test('writer errors are best effort and can retry on the next access-state refresh', async () => {
  let attempts = 0;
  const record = createSessionContextRecorder(async () => {
    attempts++; if (attempts === 1) throw new Error('offline');
    return { error: attempts === 2 ? { code: 'PGRST202' } : null };
  });
  await record(full); await record(full); await record(full); await record(full);
  assert.equal(attempts, 3);
});
