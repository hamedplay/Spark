-- series_weekdays already uses plural weekday names (e.g. شنبه‌ها).
UPDATE public.notification_templates
SET body=replace(body,'، هر {{series_weekdays}} ساعت','، {{series_weekdays}} ساعت'),updated_at=now()
WHERE category='meeting' AND event_type='series_invite' AND audience='all';
