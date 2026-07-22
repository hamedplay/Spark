-- Additive system_config entries for Bale OTP delivery (default=false)
INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES
  ('security', 'phone_login_bale_otp_enabled', 'false', 'boolean',
   'ارسال کد ورود در بله',
   'فعال‌سازی ارسال کد یکبار مصرف ورود از طریق بات بله به‌عنوان کانال تکمیلی')
ON CONFLICT (section, key) DO NOTHING;

INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES
  ('security', 'phone_password_recovery_bale_otp_enabled', 'false', 'boolean',
   'ارسال کد بازیابی رمز در بله',
   'فعال‌سازی ارسال کد یکبار مصرف بازیابی رمز از طریق بات بله به‌عنوان کانال تکمیلی')
ON CONFLICT (section, key) DO NOTHING;
