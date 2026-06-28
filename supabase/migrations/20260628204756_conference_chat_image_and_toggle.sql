ALTER TABLE conference_messages ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE conference_rooms ADD COLUMN IF NOT EXISTS chat_enabled boolean DEFAULT true NOT NULL;
