-- Official minute numbers may be scoped by council, organization, or year.
-- Do not impose a global uniqueness constraint without an approved numbering policy.
-- Decision numbers retain their within-minute unique index.
drop index if exists public.minutes_official_number_idx;
create index if not exists minutes_official_number_search_idx
  on public.minutes(official_number) where official_number is not null;
