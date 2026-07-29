/*
# Add position column to contacts_email

1. Schema changes
- Adds nullable `position` text column to `public.contacts_email`.
- Stores the organizational role/title for external contacts.
- No default value — column is intentionally nullable.
2. Data safety
- Existing rows are unaffected; `position` is simply NULL for all existing contacts.
- The `email` column is preserved and untouched.
- No RLS changes.
3. Important notes
- `position` is nullable; inserts that omit it succeed.
- Legacy `email` data is preserved and still readable by the frontend for backward compatibility.
*/

ALTER TABLE public.contacts_email
  ADD COLUMN IF NOT EXISTS position text;
