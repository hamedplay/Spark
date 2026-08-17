import { Settings, Users, Bell, Activity, Lock, Monitor, Bot } from 'lucide-react';

export const NAV_ITEMS = [
  { key: 'platform', label: 'تنظیمات پلتفرم', icon: Settings, sub: [
    { key: 'general', label: 'تنظیمات کلی' },
    { key: 'appearance', label: 'ظاهر و برندینگ' },
    { key: 'regional', label: 'تنظیمات منطقه‌ای' },
    { key: 'ui_settings', label: 'تنظیمات محیطی' },
  ]},
  { key: 'users', label: 'کاربران', icon: Users, sub: [
    { key: 'users_list', label: 'فهرست کاربران' },
    { key: 'users_online', label: 'کاربران آنلاین' },
    { key: 'user_groups', label: 'گروه‌های کاربری' },
    { key: 'group_events', label: 'رخدادها' },
    { key: 'org_structure', label: 'ساختار سازمانی' },
  ]},
  { key: 'access', label: 'حقوق دسترسی', icon: Lock, sub: [
    { key: 'security', label: 'امنیت و دسترسی' },
    { key: 'server', label: 'دسترسی سرور' },
    { key: 'backup', label: 'پشتیبان‌گیری و بازگردانی' },
  ]},
  { key: 'audit', label: 'رویدادها و رخدادها', icon: Activity, sub: [
    { key: 'audit_log', label: 'گزارش رخدادها' },
  ]},
  { key: 'notifications', label: 'اعلان‌ها و پیامک', icon: Bell, sub: [
    { key: 'notifications', label: 'اعلان‌ها' },
    { key: 'sms', label: 'پیامک' },
    { key: 'social_notifications', label: 'شبکه‌های اجتماعی' },
    { key: 'email', label: 'پست الکترونیک' },
    { key: 'daily_report', label: 'ارسال جلسات مدیریتی' },
  ]},
  { key: 'modules', label: 'مدیریت موجودیت‌ها', icon: Monitor, sub: [
    { key: 'video_conference', label: 'ویدیو کنفرانس' },
    { key: 'calendar', label: 'تقویم و مناسبت‌ها' },
    { key: 'minutes_config', label: 'صورت‌جلسات و مصوبات' },
    { key: 'monitoring', label: 'مانیتورینگ سیستم' },
  ]},
  { key: 'spark', label: 'دستیار اسپارک', icon: Bot, sub: [
    { key: 'spark_config', label: 'پیکربندی اسپارک' },
  ]},
];

export const SELECT_OPTIONS: Record<string, { value: string; label: string; description: string }[]> = {
  ice_transport_policy: [
    {
      value: 'p2p-first',
      label: 'P2P اول، سپس STUN، سپس TURN',
      description: 'سریع‌ترین اتصال ممکن. ابتدا اتصال مستقیم (LAN)، سپس STUN، در صورت نیاز TURN. برای اکثر محیط‌ها بهترین گزینه است.',
    },
    {
      value: 'auto',
      label: 'خودکار (پیشنهادی)',
      description: 'همه مسیرهای ICE (host، srflx، relay) مجاز هستند. WebRTC بهترین را انتخاب می‌کند.',
    },
    {
      value: 'all',
      label: 'همه مسیرها',
      description: 'هر مسیر ICE همزمان امتحان می‌شود. سریع اما ممکن است IP واقعی افشا شود.',
    },
    {
      value: 'relay',
      label: 'فقط TURN (relay)',
      description: 'همه ترافیک اجباراً از سرور TURN عبور می‌کند. برای شبکه‌های محدود، پشت فایروال، یا حریم خصوصی کامل.',
    },
    {
      value: 'stun-only',
      label: 'فقط STUN (بدون TURN)',
      description: 'فقط از STUN برای پیدا کردن آی‌پی عمومی استفاده می‌شود. TURN نادیده گرفته می‌شود. برای شبکه‌های ساده با NAT معمولی.',
    },
  ],
};

export const SECURITY_CONFIG_PRESENTATION: Record<string, { label: string; description: string }> = {
  allowed_ip_ranges: {
    label: 'محدوده‌های نشانی اینترنتی مجاز',
    description: 'نشانی‌ها یا محدوده‌های مجاز را با ویرگول جدا کنید. خالی بودن یعنی محدودیت نشانی اعمال نمی‌شود.',
  },
  audit_log_retention_days: {
    label: 'مدت نگهداری گزارش رخدادها (روز)',
    description: 'تعداد روزهایی که گزارش رویدادهای امنیتی و مدیریتی نگهداری می‌شوند.',
  },
  enable_2fa: {
    label: 'احراز هویت دومرحله‌ای',
    description: 'الزام عامل دوم برای حساب‌ها مطابق سیاست امنیتی سامانه.',
  },
  log_all_actions: {
    label: 'ثبت همه اقدامات کاربران',
    description: 'اقدامات قابل ممیزی کاربران و مدیران در گزارش رخدادها ثبت شوند.',
  },
  maintenance_mode: {
    label: 'حالت تعمیر و نگهداری',
    description: 'در صورت فعال بودن، فقط مدیران مجاز می‌توانند وارد سامانه شوند.',
  },
  max_login_attempts: {
    label: 'حداکثر تلاش ناموفق برای ورود',
    description: 'تعداد تلاش ناموفق مجاز پیش از اعمال محدودیت موقت ورود.',
  },
  require_strong_password: {
    label: 'الزام رمز عبور قوی',
    description: 'رمز عبور باید شرایط امنیتی تعریف‌شده در سامانه را داشته باشد.',
  },
  session_timeout_minutes: {
    label: 'مهلت بی‌کاری نشست (دقیقه)',
    description: 'نشست کاربر پس از این مدت بی‌کاری نیازمند ورود دوباره خواهد بود.',
  },
};

// Security settings are intentionally allow-listed. Internal runtime flags,
// secrets and compatibility keys must never be rendered as generic inputs.
export const VISIBLE_SECURITY_CONFIG_KEYS = new Set(
  Object.keys(SECURITY_CONFIG_PRESENTATION),
);

export const HIDDEN_SECURITY_CONFIG_KEYS = new Set([
  'phone_login_enabled',
  'phone_login_canonical_enabled',
  'phone_login_hook_operator_confirmed',
  'phone_login_e2e_verified',
  'send_sms_hook_secret',
  'phone_rate_limit_pepper',
  'phone_login_allowed_origins',
  'phone_login_test_mode',
  'phone_login_test_phone',
  'phone_login_otp_ttl_seconds',
  'phone_login_otp_ttl_operator_confirmed',
  'phone_password_recovery_enabled',
  'phone_password_recovery_canonical_enabled',
  'phone_password_recovery_e2e_verified',
  'phone_password_recovery_test_mode',
  'phone_password_recovery_test_phone',
  'phone_password_recovery_secret_operator_confirmed',
  'phone_password_recovery_otp_ttl_seconds',
  'phone_auth_pepper',
  'phone_login_bale_otp_enabled',
  'phone_password_recovery_bale_otp_enabled',
  'phone_password_recovery_secret_configured',
  'phone_rate_limit_pepper_configured',
  'phone_otp_login_backend_ready',
  'phone_otp_login_max_attempts',
  'phone_otp_login_resend_seconds',
  'phone_otp_login_ttl_seconds',
  'registration_phone_otp_resend_seconds',
  'registration_phone_otp_secret_configured',
  'registration_phone_otp_ttl_seconds',
]);
