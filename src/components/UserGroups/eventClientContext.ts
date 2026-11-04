import type { CenterEvent } from './eventCenterModel';

const missing = 'ثبت نشده';
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Descriptive UA parsing, never a hardware fingerprint or proof of identity. */
export function describeUserAgent(value: unknown, hints: Record<string, unknown> = {}) {
  const ua = text(value)?.slice(0, 512) ?? null;
  let browser = missing;
  let os = missing;
  let device = missing;
  let platform = missing;
  const notes: string[] = [];
  if (!ua || ua === 'unknown') return { userAgent: null, browser, os, device, platform, notes };

  const browsers: [string, RegExp][] = [
    ['مایکروسافت اج', /(?:EdgA|EdgiOS|Edg|Edge)\/([\d.]+)/],
    ['اپرا', /(?:OPR|OPiOS)\/([\d.]+)/], ['سامسونگ اینترنت', /SamsungBrowser\/([\d.]+)/],
    ['فایرفاکس', /(?:FxiOS|Firefox)\/([\d.]+)/], ['گوگل کروم', /(?:CriOS|Chrome)\/([\d.]+)/],
    ['سافاری', /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, pattern] of browsers) {
    const match = ua.match(pattern);
    if (match) { browser = `${name} ${match[1]}`; break; }
  }
  if (/; wv\)|\bwv\b/.test(ua)) { browser = browser === missing ? 'نمای وب اندروید' : `${browser} (نمای وب اندروید)`; }

  if (/Android/i.test(ua)) {
    const version = ua.match(/Android\s+([\d.]+)/i)?.[1];
    const reduced = /Android 10; K\)/.test(ua);
    platform = 'اندروید'; os = reduced ? 'اندروید (نسخهٔ دقیق اعلام نشده)' : `اندروید${version ? ` ${version}` : ''}`;
    device = /Mobile/i.test(ua) ? 'تلفن همراه' : 'تبلت یا دستگاه اندرویدی';
    if (reduced) notes.push('مرورگر نسخهٔ سیستم‌عامل و مدل دستگاه را محدود کرده است.');
  } else if (/iPhone|iPod|iPad/.test(ua)) {
    const version = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/)?.[1]?.replace(/_/g, '.');
    platform = 'اپل'; os = `${/iPad/.test(ua) ? 'iPadOS' : 'iOS'}${version ? ` ${version}` : ''}`;
    device = /iPad/.test(ua) ? 'تبلت (آیپد)' : /iPod/.test(ua) ? 'آیپاد' : 'تلفن همراه (آیفون)';
  } else if (/Windows NT/.test(ua)) {
    const version = ua.match(/Windows NT ([\d.]+)/)?.[1];
    platform = 'رایانه'; device = 'رایانه';
    os = version === '10.0' ? 'ویندوز ۱۰ یا ۱۱' : `ویندوز${version ? ` (NT ${version})` : ''}`;
    if (version === '10.0') notes.push('این مشخصات مرورگر، ویندوز ۱۰ را از ۱۱ تفکیک نمی‌کند.');
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    const version = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.');
    platform = 'اپل'; device = 'رایانهٔ مک یا آیپد با حالت دسکتاپ'; os = `macOS یا iPadOS${version ? ` (نسخهٔ گزارش‌شده: ${version})` : ''}`;
    notes.push('آیپد در حالت دسکتاپ می‌تواند مشخصات مک را ارسال کند.');
  } else if (/CrOS/.test(ua)) {
    platform = 'رایانه'; device = 'رایانه'; os = 'ChromeOS';
  } else if (/Linux|X11/.test(ua)) {
    platform = 'رایانه'; device = 'رایانه'; os = 'لینوکس';
  }
  const version = text(hints.platformVersion);
  if (hints.platform === 'Windows' && version && /^\d+(?:\.\d+)*$/.test(version)) {
    const major = Number(version.split('.')[0]);
    if (major >= 13) { os = 'ویندوز ۱۱'; notes.splice(0); }
    else if (major >= 1) { os = 'ویندوز ۱۰'; notes.splice(0); }
  }
  if (hints.platform === 'Android' && version && /^[\d.]+$/.test(version)) { os = `اندروید ${version}`; notes.splice(0); }
  if (/Macintosh/.test(ua) && Number(hints.maxTouchPoints) > 1) {
    device = 'تبلت (آیپد)'; os = 'iPadOS (نسخهٔ دقیق اعلام نشده)'; notes.splice(0);
  }
  const model = text(hints.model);
  if (model && platform === 'اندروید') device += ` · ${model.slice(0,100)}`;
  const brands: Record<string,string> = { 'Microsoft Edge':'مایکروسافت اج','Google Chrome':'گوگل کروم','Opera':'اپرا','Chromium':'کرومیوم' };
  const brand = text(hints.browser);
  if (brand && Object.hasOwn(brands,brand) && text(hints.browserVersion)) browser = `${brands[brand]} ${text(hints.browserVersion)!.slice(0,100)}`;
  return { userAgent: ua, browser, os, device, platform, notes };
}

const ipSources: Record<string, string> = {
  trusted_ingress: 'اتصال ثبت‌شده در ورودی سرور', proxy_header: 'هدر قدیمی پراکسی (تأییدنشده)', forwarded_header: 'هدر فورواردشده (نیازمند بررسی پراکسی)',
  auth_service: 'سرویس احراز هویت', stored_event: 'رکورد اصلی رخداد',
};
export const ipSourceTitle = (source: unknown) => Object.prototype.hasOwnProperty.call(ipSources, String(source)) ? ipSources[String(source)] : missing;

export function eventClientContext(event: Pick<CenterEvent, 'source' | 'ip_address' | 'metadata'>) {
  const metadata = event.metadata ?? {};
  const session = object(metadata.session_context);
  const registry = object(metadata.session_device);
  const current = describeUserAgent(metadata.user_agent);
  const related = describeUserAgent(session.user_agent ?? registry.user_agent);
  return {
    current: { ...current, reportedIp: text(metadata.reported_ip_address) ?? (metadata.ip_source !== 'trusted_ingress' ? text(event.ip_address) : null), ip: metadata.ip_source === 'trusted_ingress' ? text(event.ip_address) : null, ipSource: ipSourceTitle(metadata.ip_source ?? (event.ip_address ? 'stored_event' : null)),
      provenance: current.userAgent ? event.source === 'application' ? 'مشخصات ارسالی مرورگر در گزارش فعالیت' : 'مشخصات درخواست ثبت‌شده' : missing },
    session: Object.keys(session).length || related.userAgent ? {
      ...related, reportedIp: text(session.reported_ip_address) ?? (session.ip_source !== 'trusted_ingress' ? text(session.ip_address) : null), ip: session.ip_source === 'trusted_ingress' ? text(session.ip_address) : null, ipSource: ipSourceTitle(session.ip_source), observedAt: text(session.observed_at),
      provenance: Object.keys(session).length ? 'اولین درخواست نشست پس از تأیید دسترسی کامل' : 'مشخصات دستگاه هنگام ثبت نشست',
    } : null,
  };
}
