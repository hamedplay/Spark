/*
# Add description column to meeting_agenda_items

1. Modified Tables
- `meeting_agenda_items`
  - Added `description` (text, nullable) — optional long-form description for an agenda item.
  - No existing columns are removed, renamed, or type-changed.
  - Existing rows get NULL for the new column (no data backfill needed).

2. Security
- No RLS policy changes. Existing policies on `meeting_agenda_items` remain unchanged.

3. Important Notes
- This is an additive migration: it only adds a nullable column.
- Old minutes data (discussion_result, result_type, additional_notes on the minutes side) is untouched.
- The frontend minutes form will stop emitting fabricated values for removed fields,
  but existing rows in minutes tables keep their original values and remain readable
  in the detail page.
*/

ALTER TABLE meeting_agenda_items
  ADD COLUMN IF NOT EXISTS description text;
