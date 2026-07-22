-- Bale-specific auth notification templates
INSERT INTO notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  ('auth', 'login_otp_bale', 'all',
   'کد ورود بله',
   'کد ورود شما به اسپارک: {{otp}}

این کد را در اختیار دیگران قرار ندهید.',
   'key', 'teal', ARRAY['otp'], true)
ON CONFLICT (category, event_type, audience) DO NOTHING;

INSERT INTO notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  ('auth', 'password_reset_otp_bale', 'all',
   'کد بازیابی بله',
   'کد بازیابی رمز اسپارک: {{otp}}

این کد را در اختیار دیگران قرار ندهید.',
   'key', 'teal', ARRAY['otp'], true)
ON CONFLICT (category, event_type, audience) DO NOTHING;
