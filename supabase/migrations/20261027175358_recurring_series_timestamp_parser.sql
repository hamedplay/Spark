create or replace function private.meeting_local_date(p_raw text) returns date language plpgsql immutable set search_path='' as $$
begin
 if nullif(trim(p_raw),'') is null then return null; end if;
 if p_raw ~ 'T|Z|[[:space:]][0-9]{2}:|[+][0-9]{2}' then return (p_raw::timestamptz at time zone 'Asia/Tehran')::date; end if;
 return p_raw::date;
exception when others then return null;
end $$;
-- Rebuild after changing the immutable parser used by this expression index.
reindex index public.meetings_managed_reminder_date_idx;
notify pgrst,'reload schema';
