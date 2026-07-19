-- Align username uniqueness with the login lookup.
-- get_email_by_username() resolves accounts via lower(username), but the
-- existing profiles_username_key constraint is a case-sensitive btree. Two
-- usernames differing only in case (e.g. "Alice" and "alice") would both
-- satisfy the unique constraint yet collide in the case-insensitive login
-- lookup, returning an arbitrary account. Replace it with a case-insensitive
-- unique index on lower(username). Also reject empty/whitespace usernames
-- so the initial-set path cannot record a blank value.
-- Verified preconditions (read-only): no existing lower(username) duplicates
-- and no empty/whitespace usernames, so the swap is safe.

ALTER TABLE public.profiles DROP CONSTRAINT profiles_username_key;

CREATE UNIQUE INDEX profiles_username_lower_key
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_nonempty
  CHECK (username IS NULL OR btrim(username) <> '');
