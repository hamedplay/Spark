/*
# Seed minutes document configuration in system_config

1. Purpose
   Adds a new `minutes` section to `system_config` with structured, validated
   keys that control the appearance and defaults of the minutes/decisions
   document (header title, org name, subtitle, footer, visibility toggles,
   font size, default confidentiality, default approval mode, show logo).

2. New config rows (section = 'minutes')
   - minutes_header_title      (string)  — title shown in document header
   - minutes_org_name          (string)  — organization name in header
   - minutes_subtitle          (string)  — optional subtitle
   - minutes_footer_text       (string)  — footer text
   - minutes_show_logo         (boolean) — whether to show logo
   - minutes_show_participants (boolean) — whether to show participants/signatures
   - minutes_show_approvers     (boolean) — whether to show approver signatures
   - minutes_show_confidentiality (boolean) — whether to show confidentiality level
   - minutes_show_decisions    (boolean) — whether to show decisions section
   - minutes_font_size         (select)  — font size: small, medium, large
   - minutes_default_confidentiality (select) — default confidentiality level
   - minutes_default_approval_mode (select) — default approval mode

3. Security
   - No new tables. Uses existing system_config table.
   - RLS already enabled on system_config.
   - No policy changes needed.

4. Permission seed
   - Adds `minutes_config` permission_key to org_level_permissions for all
     existing levels, mirroring the existing `system_config` permission.

5. Notes
   - All inserts are idempotent (ON CONFLICT DO NOTHING).
   - No existing data is modified or deleted.
   - Backward-compatible: MinutesDocumentLayout falls back to hard-coded
     defaults when these config rows are absent.
*/

-- Seed minutes config rows
INSERT INTO public.system_config (section, key, value, value_type, label, description)
VALUES
  ('minutes', 'minutes_header_title', 'صورت‌جلسه', 'string', 'عنوان سربرگ سند', 'عنوان اصلی نمایش‌داده‌شده در بالای صورت‌جلسه'),
  ('minutes', 'minutes_org_name', '', 'string', 'نام سازمان', 'نام سازمان یا واحد نمایش‌داده‌شده در سربرگ'),
  ('minutes', 'minutes_subtitle', '', 'string', 'زیرعنوان اختیاری', 'زیرعنوان نمایش‌داده‌شده زیر عنوان اصلی'),
  ('minutes', 'minutes_footer_text', 'پایان صورت‌جلسه', 'string', 'متن پاورقی', 'متن نمایش‌داده‌شده در انتهای سند'),
  ('minutes', 'minutes_show_logo', 'true', 'boolean', 'نمایش لوگو', 'نمایش یا عدم نمایش لوگو در سربرگ صورت‌جلسه'),
  ('minutes', 'minutes_show_participants', 'true', 'boolean', 'نمایش شرکت‌کنندگان و امضاها', 'نمایش بخش شرکت‌کنندگان و امضاها در سند'),
  ('minutes', 'minutes_show_approvers', 'true', 'boolean', 'نمایش تأییدکنندگان', 'نمایش بخش تأییدکنندگان و امضاها'),
  ('minutes', 'minutes_show_confidentiality', 'true', 'boolean', 'نمایش سطح محرمانگی', 'نمایش برچسب سطح محرمانگی در سند'),
  ('minutes', 'minutes_show_decisions', 'true', 'boolean', 'نمایش اطلاعات مصوبات', 'نمایش بخش مصوبات در سند'),
  ('minutes', 'minutes_font_size', 'medium', 'select', 'اندازه فونت سند', 'اندازه فونت متن صورت‌جلسه'),
  ('minutes', 'minutes_default_confidentiality', 'organizational', 'select', 'سطح محرمانگی پیش‌فرض', 'سطح محرمانگی پیش‌فرض هنگام ایجاد صورت‌جلسه جدید'),
  ('minutes', 'minutes_default_approval_mode', 'system', 'select', 'شیوه تأیید پیش‌فرض', 'شیوه تأیید پیش‌فرض هنگام ایجاد صورت‌جلسه جدید')
ON CONFLICT (section, key) DO NOTHING;

-- Seed minutes_config permission for all existing org levels
INSERT INTO public.org_level_permissions (level, permission_key, granted)
SELECT level, 'minutes_config', true
FROM (SELECT DISTINCT level FROM public.org_level_permissions) AS levels
WHERE NOT EXISTS (
  SELECT 1 FROM public.org_level_permissions p
  WHERE p.level = levels.level AND p.permission_key = 'minutes_config'
);
