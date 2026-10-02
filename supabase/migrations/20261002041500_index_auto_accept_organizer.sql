-- Cover organizer FK/lookups for auto-accept relationships.
create index if not exists idx_user_auto_accept_organizers_organizer_user_id
  on public.user_auto_accept_organizers (organizer_user_id);
