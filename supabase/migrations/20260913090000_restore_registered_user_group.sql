-- Restore the required default group for public phone registration.
--
-- private.ensure_public_registration_defaults(uuid) intentionally aborts
-- registration when this group is missing. Keep this seed minimal and
-- idempotent so existing deployments preserve any customized group definition.

insert into public.user_groups (
  name,
  display_name,
  description,
  is_system,
  is_public,
  permissions
)
values (
  'registered_user',
  'کاربر ثبت‌نام‌شده',
  'گروه پیش‌فرض برای کاربرانی که از ثبت‌نام عمومی ایجاد می‌شوند',
  true,
  false,
  '{}'::jsonb
)
on conflict (name) do nothing;
