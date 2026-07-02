INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES ('security', 'maintenance_mode', 'false', 'boolean', 'حالت تعمیر و نگهداری', 'در صورت فعال بودن، کاربران غیر ادمین نمی‌توانند وارد سیستم شوند')
ON CONFLICT (section, key) DO NOTHING;
