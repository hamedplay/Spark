export interface ConfigEntry { id: string; section: string; key: string; value: string | null; value_type: string; label: string | null; description: string | null; }
export interface AuditEntry { id: string; user_name: string | null; ip_address: string | null; user_agent: string | null; module: string | null; entity_name: string | null; action: string; details: string | null; severity: string; created_at: string; }
export interface Profile { user_id: string; full_name: string | null; email: string | null; is_admin: boolean | null; is_active: boolean | null; created_at: string | null; avatar_url?: string | null; department?: string | null; position?: string | null; }

export const HIDDEN_SECURITY_CONFIG_KEYS = new Set([
  'phone_login_enabled',
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
  'phone_password_recovery_e2e_verified',
  'phone_password_recovery_test_mode',
  'phone_password_recovery_test_phone',
  'phone_password_recovery_secret_operator_confirmed',
  'phone_password_recovery_otp_ttl_seconds',
]);

export const SELECT_OPTIONS: Record<string, { value: string; label: string; description: string }[]> = {
  ice_transport_policy: [
    { value: 'p2p-first', label: 'P2P اول، سپس STUN، سپس TURN', description: 'سریع‌ترین اتصال ممکن. ابتدا اتصال مستقیم (LAN)، سپس STUN، در صورت نیاز TURN. برای اکثر محیط‌ها بهترین گزینه است.' },
    { value: 'auto', label: 'خودکار (پیشنهادی)', description: 'همه مسیرهای ICE (host، srflx، relay) مجاز هستند. WebRTC بهترین را انتخاب می‌کند.' },
    { value: 'all', label: 'همه مسیرها', description: 'هر مسیر ICE همزمان امتحان می‌شود. سریع اما ممکن است IP واقعی افشا شود.' },
    { value: 'relay', label: 'فقط TURN (relay)', description: 'همه ترافیک اجباراً از سرور TURN عبور می‌کند. برای شبکه‌های محدود، پشت فایروال، یا حریم خصوصی کامل.' },
    { value: 'stun-only', label: 'فقط STUN (بدون TURN)', description: 'فقط از STUN برای پیدا کردن آی‌پی عمومی استفاده می‌شود. TURN نادیده گرفته می‌شود. برای شبکه‌های ساده با NAT معمولی.' },
  ],
};
