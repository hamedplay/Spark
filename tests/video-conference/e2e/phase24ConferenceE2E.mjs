import assert from 'node:assert/strict';
import { chromium } from 'playwright';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const conferenceUrl = required('PHASE24_CONFERENCE_URL');
const hostName = required('PHASE24_HOST_NAME');
const participantName = required('PHASE24_PARTICIPANT_NAME');
const hostState = process.env.PHASE24_HOST_STORAGE_STATE || '/state/host.json';
const participantState =
  process.env.PHASE24_PARTICIPANT_STORAGE_STATE || '/state/participant.json';

const requireCountdown =
  process.env.PHASE24_E2E_REQUIRE_COUNTDOWN === '1';
const requireRecording =
  process.env.PHASE24_E2E_RECORDING === '1';
const requireScreenShare =
  process.env.PHASE24_E2E_SCREEN_SHARE !== '0';

const origin = new URL(conferenceUrl).origin;
const results = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    results.push({
      name,
      ok: true,
      durationMs: Date.now() - started,
      details: details ?? null,
    });
    console.log(`PASS ${name}`);
    return details;
  } catch (error) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function createContext(browser, storageState) {
  const context = await browser.newContext({
    storageState,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    permissions: ['camera', 'microphone'],
  });
  await context.grantPermissions(
    ['camera', 'microphone'],
    { origin },
  );
  return context;
}

async function joinRoom(page) {
  await page.goto(conferenceUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });

  const dialog = page.getByRole('dialog', {
    name: 'تنظیم دستگاه قبل از ورود',
  });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });

  const consent = dialog.getByRole('button', { name: 'موافقم' });
  if (await consent.isVisible().catch(() => false)) {
    await consent.click();
  }

  const enter = dialog.getByRole('button', { name: 'ورود به جلسه' });
  await enter.waitFor({ state: 'visible', timeout: 20_000 });
  await enter.click();

  const continueButton = dialog.getByRole('button', {
    name: 'ادامه و ورود',
  });
  if (
    await continueButton.isVisible({ timeout: 8_000 }).catch(() => false)
  ) {
    await continueButton.click();
  }

  await page.getByRole('button', { name: 'خروج از جلسه' })
    .waitFor({ state: 'visible', timeout: 45_000 });
}

async function openPanel(page, label) {
  const button = page.getByRole('button', { name: label });
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
}

function participantRow(page, displayName) {
  return page
    .getByText(displayName, { exact: true })
    .locator(
      'xpath=ancestor::div[.//button[contains(normalize-space(.),"Mute فعلی")]][1]',
    );
}

async function sendPublicChat(page, body) {
  await openPanel(page, 'گفتگوی جلسه');
  const composer = page.locator(
    'textarea[placeholder^="پیام…"]',
  );
  await composer.fill(body);
  await page.getByRole('button', { name: 'ارسال', exact: true }).click();
}

async function sendPrivateChat(page, peerName, body) {
  await openPanel(page, 'پیام خصوصی');
  const peer = page.getByRole('button', { name: peerName, exact: true });
  await peer.waitFor({ state: 'visible', timeout: 15_000 });
  await peer.click();

  const composer = page.locator(
    'textarea[placeholder="پیام خصوصی…"]',
  );
  await composer.fill(body);
  await page.getByRole('button', { name: 'ارسال', exact: true }).click();
}

async function currentPhaseSection(page) {
  await openPanel(page, 'شرکت‌کنندگان');
  const title = page.getByText('مدیریت فاز جلسه', { exact: true });
  await title.waitFor({ state: 'visible', timeout: 15_000 });
  return title.locator('xpath=ancestor::section[1]');
}

async function maybeCountdown(page) {
  const section = await currentPhaseSection(page);
  const text = await section.textContent() || '';

  if (text.includes('SCHEDULED')) {
    await section.getByRole('button', { name: 'باز کردن جلسه' }).click();
    await section.getByText('WAITING', { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });
  }

  const waiting = await section.getByText('WAITING', { exact: true })
    .isVisible()
    .catch(() => false);

  if (!waiting) {
    if (requireCountdown) {
      throw new Error(
        'Dedicated E2E room must be SCHEDULED or WAITING for countdown coverage',
      );
    }
    return { skipped: true, reason: 'room is already beyond WAITING' };
  }

  await section.getByLabel('زمان سفارشی شمارش معکوس به ثانیه').fill('10');
  await section.getByRole('button', {
    name: 'شروع شمارش معکوس',
  }).click();

  await section.getByText('COUNTDOWN', { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });

  await section.getByText('LIVE', { exact: true })
    .waitFor({ state: 'visible', timeout: 25_000 });

  return { completed: true };
}

async function runBreak(page) {
  const section = await currentPhaseSection(page);

  await section.getByText('LIVE', { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await section.getByLabel('مدت سفارشی استراحت به ثانیه').fill('10');
  await section.getByRole('button', { name: 'شروع استراحت' }).click();

  await section.getByText('BREAK', { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });

  await section.getByRole('button', {
    name: 'پایان زودتر استراحت',
  }).click();

  await section.getByText('LIVE', { exact: true })
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function startQueuedSpeaker(page, displayName) {
  await openPanel(page, 'شرکت‌کنندگان');
  const queueTitle = page.getByText('صف صحبت', { exact: true });
  await queueTitle.waitFor({ state: 'visible', timeout: 15_000 });

  const queueRow = page
    .getByText(displayName, { exact: true })
    .locator(
      'xpath=ancestor::div[.//button[contains(normalize-space(.),"اجازه صحبت")]][1]',
    );

  await queueRow.getByLabel('زمان سفارشی صحبت به ثانیه').fill('10');
  await queueRow.getByRole('button', { name: 'ثبت زمان' }).click();
  await queueRow.getByRole('button', { name: 'اجازه صحبت' }).click();

  await page.getByText(/زمان صحبت/)
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--disable-dev-shm-usage',
  ],
});

let hostContext;
let participantContext;
let hostPage;
let participantPage;

try {
  hostContext = await createContext(browser, hostState);
  participantContext = await createContext(browser, participantState);
  hostPage = await hostContext.newPage();
  participantPage = await participantContext.newPage();

  await step('two users join the real conference room', async () => {
    await Promise.all([
      joinRoom(hostPage),
      joinRoom(participantPage),
    ]);

    await hostPage.getByText(/2\/20/)
      .waitFor({ state: 'visible', timeout: 20_000 });
    await participantPage.getByText(/2\/20/)
      .waitFor({ state: 'visible', timeout: 20_000 });

    return { participants: 2 };
  });

  await step('public chat propagates between users', async () => {
    const body = `phase24-public-${Date.now()}`;
    await sendPublicChat(hostPage, body);

    await openPanel(participantPage, 'گفتگوی جلسه');
    await participantPage.getByText(body, { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });

    return { body };
  });

  await step('private chat stays addressable to selected peer', async () => {
    const body = `phase24-private-${Date.now()}`;
    await sendPrivateChat(hostPage, participantName, body);

    await openPanel(participantPage, 'پیام خصوصی');
    await participantPage
      .getByRole('button', { name: hostName, exact: true })
      .click();
    await participantPage.getByText(body, { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });

    return { body };
  });

  await step('raise hand creates speaker queue state', async () => {
    await participantPage.getByRole('button', {
      name: 'بالا بردن دست',
    }).click();

    await participantPage.getByRole('button', {
      name: 'پایین آوردن دست',
    }).waitFor({ state: 'visible', timeout: 10_000 });

    await openPanel(hostPage, 'شرکت‌کنندگان');
    await hostPage.getByText('صف صحبت', { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });
  });

  await step('host mute and publish restriction controls work', async () => {
    const row = participantRow(hostPage, participantName);
    await row.waitFor({ state: 'visible', timeout: 15_000 });

    await row.getByRole('button', { name: 'Mute فعلی' }).click();

    const disableMic = row.getByRole('button', {
      name: /بستن میکروفون/,
    });
    await disableMic.click();

    await row.getByRole('button', {
      name: /میکروفون ممنوع/,
    }).waitFor({ state: 'visible', timeout: 15_000 });

    await row.getByRole('button', {
      name: /میکروفون ممنوع/,
    }).click();

    await row.getByRole('button', {
      name: /بستن میکروفون/,
    }).waitFor({ state: 'visible', timeout: 15_000 });
  });

  await step('queued participant receives timed speaker session', async () => {
    await startQueuedSpeaker(hostPage, participantName);
  });

  await step('screen sharing publishes and unpublishes', async () => {
    const share = hostPage.getByRole('button', { name: 'اشتراک صفحه' });

    if (!await share.isVisible().catch(() => false)) {
      if (requireScreenShare) {
        throw new Error('screen-share control is not available');
      }
      return { skipped: true };
    }

    await share.click();
    const stop = hostPage.getByRole('button', {
      name: 'توقف اشتراک صفحه',
    });
    await stop.waitFor({ state: 'visible', timeout: 20_000 });
    await stop.click();
    await share.waitFor({ state: 'visible', timeout: 20_000 });
  });

  await step('poll create and vote lifecycle works', async () => {
    const question = `phase24-poll-${Date.now()}`;

    await openPanel(hostPage, 'نظرسنجی‌ها');
    await hostPage.getByRole('button', {
      name: 'نظرسنجی جدید',
    }).click();

    await hostPage.locator(
      'textarea[placeholder="سؤال نظرسنجی"]',
    ).fill(question);

    const form = hostPage
      .locator('textarea[placeholder="سؤال نظرسنجی"]')
      .locator('xpath=ancestor::section[1]');
    await form.locator('select').first().selectOption('YES_NO');
    await form.getByRole('button', { name: 'ایجاد نظرسنجی' }).click();

    await hostPage.getByText(question, { exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });

    await openPanel(participantPage, 'نظرسنجی‌ها');
    const card = participantPage
      .getByText(question, { exact: true })
      .locator('xpath=ancestor::article[1]');

    await card.getByRole('button', { name: /بله/ }).first().click();
    await card.getByRole('button', { name: /^ثبت رأی/ }).click();

    await card.getByText(/رأی‌دهنده/)
      .waitFor({ state: 'visible', timeout: 15_000 });
  });

  await step('countdown phase transition', async () => {
    return maybeCountdown(hostPage);
  });

  await step('break and resume transition', async () => {
    await runBreak(hostPage);
  });

  await step('recording start and stop lifecycle', async () => {
    const start = hostPage.getByRole('button', { name: 'شروع ضبط' });

    if (!requireRecording) {
      return {
        skipped: true,
        reason: 'PHASE24_E2E_RECORDING is not 1',
      };
    }

    await start.waitFor({ state: 'visible', timeout: 15_000 });
    await start.click();

    const stop = hostPage.getByRole('button', { name: 'توقف ضبط' });
    await stop.waitFor({ state: 'visible', timeout: 30_000 });
    await stop.click();

    await start.waitFor({ state: 'visible', timeout: 45_000 });
  });

  await step('browser network loss recovers conference session', async () => {
    await participantContext.setOffline(true);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await participantContext.setOffline(false);

    await participantPage.getByRole('button', {
      name: 'خروج از جلسه',
    }).waitFor({ state: 'visible', timeout: 20_000 });

    await participantPage.getByRole('button', {
      name: /قطع میکروفون|فعال کردن میکروفون/,
    }).waitFor({ state: 'visible', timeout: 20_000 });

    assert.equal(
      await participantPage
        .getByText(/بازیابی اتصال رسانه‌ای ناموفق بود/)
        .count(),
      0,
    );
  });
} finally {
  try {
    if (participantPage) {
      const lower = participantPage.getByRole('button', {
        name: 'پایین آوردن دست',
      });
      if (await lower.isVisible().catch(() => false)) {
        await lower.click().catch(() => {});
      }
    }
  } catch {}

  await participantContext?.close().catch(() => {});
  await hostContext?.close().catch(() => {});
  await browser.close();
}

console.log(JSON.stringify({
  ok: results.every((item) => item.ok),
  results,
}, null, 2));
