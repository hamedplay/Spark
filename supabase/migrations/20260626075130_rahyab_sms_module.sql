
-- Rahyab Rayan SOAP SMS service settings (one row)
CREATE TABLE rahyab_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    VARCHAR(100) NOT NULL DEFAULT '',
  password    VARCHAR(100) NOT NULL DEFAULT '',
  short_code  VARCHAR(50)  NOT NULL DEFAULT '',
  token       VARCHAR(200) NOT NULL DEFAULT '',
  soap_url    VARCHAR(500) NOT NULL DEFAULT 'http://RahvabBulk.ir/WebService/sms.asmx',
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rahyab_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rahyab_settings_select" ON rahyab_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "rahyab_settings_insert" ON rahyab_settings FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "rahyab_settings_update" ON rahyab_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rahyab_settings_delete" ON rahyab_settings FOR DELETE
  TO authenticated USING (true);

-- Rahyab received messages inbox
CREATE TABLE rahyab_inbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id      BIGINT UNIQUE,
  sender      VARCHAR(30)  NOT NULL DEFAULT '',
  receiver    VARCHAR(30)  NOT NULL DEFAULT '',
  message     TEXT         NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_read     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE rahyab_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rahyab_inbox_select" ON rahyab_inbox FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "rahyab_inbox_insert" ON rahyab_inbox FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "rahyab_inbox_update" ON rahyab_inbox FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rahyab_inbox_delete" ON rahyab_inbox FOR DELETE
  TO authenticated USING (true);

-- Insert active engine selection into system_config (sms section)
INSERT INTO system_config (section, key, value, value_type, label, description)
VALUES ('sms', 'active_engine', 'standard', 'string',
        'موتور ارسال پیامک',
        'انتخاب روش ارسال پیامک: standard = سرویس‌دهنده استاندارد، rahyab = وب‌سرویس رهیاب رایان')
ON CONFLICT (section, key) DO NOTHING;
