INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES (
  'video_conference',
  'ice_transport_policy',
  'auto',
  'select',
  'سیاست انتقال ICE',
  'auto: اگر TURN پیکربندی شده باشد از relay استفاده می‌شود، وگرنه all | relay: اجبار به استفاده از TURN | all: هر مسیر ICE مجاز است'
)
ON CONFLICT (section, key) DO NOTHING;
