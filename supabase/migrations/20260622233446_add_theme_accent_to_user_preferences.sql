ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT 'teal';
