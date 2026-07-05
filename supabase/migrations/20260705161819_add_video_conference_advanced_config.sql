/*
# افزودن تنظیمات پیشرفته ویدیو کنفرانس

## خلاصه
سه فیلد پیکربندی جدید به بخش video_conference در جدول system_config اضافه می‌شود.
این فیلدها به ادمین امکان می‌دهند رفتار اتصال ICE را دقیق‌تر تنظیم کنند.

## فیلدهای جدید

1. `ice_connection_timeout` (number, default: 30)
   - حداکثر زمان انتظار برای برقراری اتصال ICE بر حسب ثانیه.
   - اگر در این مدت اتصال برقرار نشود، تماس به عنوان ناموفق تلقی می‌شود.

2. `ice_restart_on_disconnect` (boolean, default: true)
   - اگر فعال باشد، پس از قطع شبکه به صورت خودکار تلاش برای بازیابی اتصال ICE انجام می‌شود.
   - caller سمت را برای ICE restart مسئول می‌داند.

3. `enable_turn_fallback` (boolean, default: true)
   - اگر فعال باشد و اتصال STUN/P2P موفق نشود، به صورت خودکار به TURN fallback می‌شود.
   - در ترکیب با ice_transport_policy کار می‌کند.

## جدول تغییریافته
- `system_config`: سه ردیف جدید با section='video_conference' اضافه می‌شود.

## امنیت
- تغییری در RLS اعمال نمی‌شود (سیاست‌های موجود پوشش می‌دهند).

## نکات مهم
- از INSERT ... ON CONFLICT DO NOTHING استفاده می‌شود تا در صورت وجود قبلی، خطا نداشته باشیم.
- مقادیر پیش‌فرض محافظه‌کارانه انتخاب شده‌اند تا رفتار موجود برای کاربران فعلی تغییر نکند.
*/

INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES
  (
    'video_conference',
    'ice_connection_timeout',
    '30',
    'number',
    'زمان انتظار اتصال ICE (ثانیه)',
    'حداکثر زمان (ثانیه) برای برقراری اتصال ICE. پس از این مدت، تماس ناموفق تلقی می‌شود.'
  ),
  (
    'video_conference',
    'ice_restart_on_disconnect',
    'true',
    'boolean',
    'بازیابی خودکار پس از قطع شبکه',
    'در صورت قطع شبکه، به صورت خودکار تلاش برای بازیابی اتصال ICE انجام می‌شود.'
  ),
  (
    'video_conference',
    'enable_turn_fallback',
    'true',
    'boolean',
    'استفاده از TURN در صورت عدم اتصال مستقیم',
    'اگر اتصال P2P یا STUN موفق نشود، به صورت خودکار از TURN استفاده می‌شود.'
  )
ON CONFLICT (section, key) DO NOTHING;
