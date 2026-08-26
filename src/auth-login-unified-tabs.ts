const IDENTIFIER_LABEL = 'نام کاربری، ایمیل یا شماره موبایل';
const PASSWORD_TAB_LABEL = 'ورود با رمز عبور';
const OTP_TAB_LABEL = 'ورود با کد پیامکی';

const LOCK_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect width="18" height="11" x="3" y="11" rx="2" />
  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
</svg>`;

const PHONE_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
  <path d="M12 18h.01" />
</svg>`;

function normalizePhoneCandidate(value: string): string {
  return value.replace(/[\s\-()]/g, '');
}

function inferCredentialMethod(value: string): 'username' | 'email' | 'phone' {
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';

  const phone = normalizePhoneCandidate(trimmed);
  if (/^(?:\+98|0098|98|0)?9\d{9}$/.test(phone)) return 'phone';

  return 'username';
}

function findButtonByText(root: ParentNode, text: string, excludeSelector?: string): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => {
    if (excludeSelector && button.matches(excludeSelector)) return false;
    return button.textContent?.replace(/\s+/g, ' ').trim().includes(text);
  }) ?? null;
}

/**
 * Only adjusts presentation. Never changes React credential state while the user
 * is typing. The previous implementation clicked a native credential tab on
 * every input event; that forced React to reconcile the controlled input and
 * could make the typed identifier disappear.
 */
function syncIdentifierPresentation(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('input[autocomplete="username"]');
  if (!input) return;

  if (input.placeholder !== IDENTIFIER_LABEL) input.placeholder = IDENTIFIER_LABEL;
  input.setAttribute('aria-label', IDENTIFIER_LABEL);

  // This field accepts username, email, or mobile. React's native credential
  // tabs may leave it as type="email" until submit, which makes the browser
  // reject username/mobile before our submit handler can infer the real method.
  // Disable native constraint validation for this unified form and present the
  // identifier as plain text; server-side/password-login remains authoritative.
  const form = input.closest<HTMLFormElement>('form.spark-reference-form');
  if (form) form.noValidate = true;
  if (input.type !== 'text') input.type = 'text';

  const field = input.closest('.spark-reference-field');
  const label = field?.querySelector<HTMLElement>(':scope > span');
  if (label && label.textContent !== IDENTIFIER_LABEL) label.textContent = IDENTIFIER_LABEL;
}

function targetCredentialButton(root: HTMLElement, value: string): HTMLButtonElement | null {
  const method = inferCredentialMethod(value);
  const targetText = method === 'email'
    ? 'ورود با ایمیل'
    : method === 'phone'
      ? 'ورود با موبایل'
      : 'ورود با نام کاربری';

  const nativeTabs = root.querySelector<HTMLElement>('.spark-reference-tabs');
  return nativeTabs ? findButtonByText(nativeTabs, targetText) : null;
}

function createUnifiedTabs(): HTMLDivElement {
  const tabs = document.createElement('div');
  tabs.className = 'spark-login-unified-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'روش ورود');
  tabs.innerHTML = `
    <button type="button" class="spark-login-unified-tab spark-login-unified-password" role="tab">
      ${LOCK_ICON}<span>${PASSWORD_TAB_LABEL}</span>
    </button>
    <button type="button" class="spark-login-unified-tab spark-login-unified-otp" role="tab">
      ${PHONE_ICON}<span>${OTP_TAB_LABEL}</span>
    </button>`;
  return tabs;
}

function syncUnifiedTabs(): void {
  const panel = document.querySelector<HTMLElement>('.spark-reference-form-panel');
  if (!panel) return;

  const passwordInput = panel.querySelector<HTMLInputElement>('input[autocomplete="username"]');
  const otpBack = Array.from(panel.querySelectorAll<HTMLButtonElement>('.spark-reference-back')).find(
    button => button.textContent?.includes('بازگشت به ورود با رمز عبور'),
  ) ?? null;

  const isPasswordLogin = Boolean(passwordInput);
  const isOtpLogin = Boolean(otpBack);
  const isLoginFlow = isPasswordLogin || isOtpLogin;

  const existingTabs = panel.querySelector<HTMLDivElement>('.spark-login-unified-tabs');
  if (!isLoginFlow) {
    existingTabs?.remove();
    return;
  }

  let tabs = existingTabs;
  if (!tabs) {
    tabs = createUnifiedTabs();
    const anchor = isPasswordLogin
      ? passwordInput?.closest('form.spark-reference-form')
      : otpBack?.closest('.spark-reference-compact-flow');
    if (!anchor?.parentElement) return;
    anchor.parentElement.insertBefore(tabs, anchor);
  }

  const passwordTab = tabs.querySelector<HTMLButtonElement>('.spark-login-unified-password');
  const otpTab = tabs.querySelector<HTMLButtonElement>('.spark-login-unified-otp');
  if (!passwordTab || !otpTab) return;

  const nativeOtpTrigger = findButtonByText(panel, OTP_TAB_LABEL, '.spark-login-unified-tab');
  if (nativeOtpTrigger) nativeOtpTrigger.classList.add('spark-login-native-otp-trigger');

  const otpAvailable = isOtpLogin || Boolean(nativeOtpTrigger);
  passwordTab.classList.toggle('is-active', isPasswordLogin);
  otpTab.classList.toggle('is-active', isOtpLogin);
  passwordTab.setAttribute('aria-selected', String(isPasswordLogin));
  otpTab.setAttribute('aria-selected', String(isOtpLogin));
  otpTab.disabled = !otpAvailable;
  otpTab.setAttribute('aria-disabled', String(!otpAvailable));
  otpTab.title = otpAvailable ? OTP_TAB_LABEL : 'ورود با کد پیامکی در حال حاضر فعال نیست';

  passwordTab.onclick = () => {
    if (isOtpLogin) otpBack?.click();
  };

  otpTab.onclick = () => {
    if (isPasswordLogin && nativeOtpTrigger) nativeOtpTrigger.click();
  };

  if (isPasswordLogin) syncIdentifierPresentation(panel);
}

const resubmittingForms = new WeakSet<HTMLFormElement>();

function handlePasswordSubmit(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || resubmittingForms.has(form)) return;

  const panel = form.closest<HTMLElement>('.spark-reference-form-panel');
  const input = form.querySelector<HTMLInputElement>('input[autocomplete="username"]');
  if (!panel || !input) return;

  const target = targetCredentialButton(panel, input.value);
  if (!target || target.getAttribute('aria-selected') === 'true') return;

  // Resolve username/email/mobile only when the user submits. This keeps the
  // controlled identifier field stable for the entire typing session.
  event.preventDefault();
  event.stopPropagation();
  target.click();

  resubmittingForms.add(form);
  requestAnimationFrame(() => {
    try {
      form.requestSubmit();
    } finally {
      resubmittingForms.delete(form);
    }
  });
}

let framePending = false;
function scheduleSync(): void {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    syncUnifiedTabs();
  });
}

if (typeof document !== 'undefined' && document.documentElement.dataset.sparkAuthUnifiedTabs !== '1') {
  document.documentElement.dataset.sparkAuthUnifiedTabs = '1';

  document.addEventListener('submit', handlePasswordSubmit, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

export {};
