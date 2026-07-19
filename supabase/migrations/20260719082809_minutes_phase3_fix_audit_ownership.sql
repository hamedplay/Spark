/*
# Minutes Phase 3 — fix audit trigger to bypass RLS on audit log

The minutes_audit_log table has RLS enabled with only a SELECT policy.
SECURITY DEFINER trigger functions insert into it, but RLS still blocks
the INSERT because the function owner does not have BYPASSRLS in this
environment. Fix: make the trigger functions insert directly (they are
SECURITY DEFINER) and grant the table owner role INSERT bypass. Since we
cannot alter role attributes here, we instead add an INSERT policy scoped
to the `postgres`/owner role is not feasible. The robust fix: the trigger
functions are SECURITY DEFINER owned by the table owner — we just need to
ensure the table owner bypasses RLS. We achieve this by setting the table
owner to the current migration role (which has BYPASSRLS in Supabase).

Actually the simplest robust fix: disable RLS on minutes_audit_log for
INSERT only by adding a permissive INSERT policy that only the SECURITY
DEFINER functions can satisfy. Since the functions run as the table owner,
and the table owner bypasses RLS, the INSERT should work. The issue is that
the table owner is NOT the function owner. We fix by re-owning both the
table and the functions to the same role (postgres), which has BYPASSRLS.
*/

ALTER TABLE public.minutes_audit_log OWNER TO postgres;
ALTER FUNCTION public._write_minutes_audit(uuid,text,text,uuid,integer,jsonb,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION public._minutes_audit_trigger_fn() OWNER TO postgres;
ALTER FUNCTION public._minutes_decisions_audit_trigger_fn() OWNER TO postgres;
ALTER TABLE public.minutes_attachments OWNER TO postgres;
ALTER FUNCTION public._minutes_attachment_target_ok(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public._user_can_view_minute(uuid) OWNER TO postgres;
ALTER FUNCTION public._user_can_manage_minute_content(uuid) OWNER TO postgres;
ALTER FUNCTION public.create_minutes_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.delete_minutes_attachment(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_minutes_attachment_signed_url(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_minutes_dashboard_stats() OWNER TO postgres;
ALTER FUNCTION public.search_minutes_report(jsonb,int,int) OWNER TO postgres;
ALTER FUNCTION public.search_decisions_report(jsonb,int,int) OWNER TO postgres;
