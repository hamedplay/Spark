-- Compute zero-argument identity calls once per statement. Preserve policy
-- names, roles, commands and restrictive/permissive behavior. Work from live
-- definitions so a restored environment's newer rules are never overwritten.
DO $migration$
DECLARE
 v_policy record;
 v_field integer;
 v_old text;
 v_remaining text;
 v_result text;
 v_token text;
 v_prefix text;
 v_position integer;
 v_using text;
 v_check text;
 v_command text;
 v_count integer:=0;
BEGIN
 FOR v_policy IN SELECT * FROM pg_policies WHERE schemaname IN('public','private','storage')
 LOOP
   v_using:=NULL; v_check:=NULL;
   FOR v_field IN 1..2 LOOP
     v_old:=CASE WHEN v_field=1 THEN v_policy.qual ELSE v_policy.with_check END;
     IF v_old IS NULL THEN CONTINUE; END IF;
     v_remaining:=v_old; v_result:='';
     LOOP
       -- Treat SQL string literals as tokens; never rewrite their contents.
       v_token:=substring(v_remaining FROM $pattern$'(?:''|[^'])*'|auth\.(?:uid|jwt|role)\(\)$pattern$);
       EXIT WHEN v_token IS NULL;
       v_position:=strpos(v_remaining,v_token);
       v_prefix:=substring(v_remaining FROM 1 FOR v_position-1);
       v_result:=v_result||v_prefix;
       IF left(v_token,1)=chr(39) OR v_result ~* '\mSELECT[[:space:]]*$' THEN
         v_result:=v_result||v_token;
       ELSE
         v_result:=v_result||'(SELECT '||v_token||')';
       END IF;
       v_remaining:=substring(v_remaining FROM v_position+length(v_token));
     END LOOP;
     v_result:=v_result||v_remaining;
     IF v_result IS DISTINCT FROM v_old THEN
       IF v_field=1 THEN v_using:=v_result; ELSE v_check:=v_result; END IF;
     END IF;
   END LOOP;
   IF v_using IS NOT NULL OR v_check IS NOT NULL THEN
     v_command:=format('ALTER POLICY %I ON %I.%I',v_policy.policyname,v_policy.schemaname,v_policy.tablename);
     IF v_using IS NOT NULL THEN v_command:=v_command||' USING ('||v_using||')'; END IF;
     IF v_check IS NOT NULL THEN v_command:=v_command||' WITH CHECK ('||v_check||')'; END IF;
     EXECUTE v_command;
     v_count:=v_count+1;
   END IF;
 END LOOP;
 RAISE NOTICE 'Optimized identity evaluation in % policies',v_count;
END $migration$;

-- Cover the observed high-traffic parent deletion/lookup paths; do not create
-- every advisory index or delete indexes based on fresh restore statistics.
CREATE INDEX IF NOT EXISTS notification_outbox_meeting_id_idx ON public.notification_outbox(meeting_id);
CREATE INDEX IF NOT EXISTS minutes_decisions_agenda_result_id_idx ON public.minutes_decisions(agenda_result_id);
CREATE INDEX IF NOT EXISTS minutes_decision_updates_minute_id_idx ON public.minutes_decision_updates(minute_id);
CREATE INDEX IF NOT EXISTS minutes_decision_reminders_minute_id_idx ON public.minutes_decision_reminders(minute_id);
CREATE INDEX IF NOT EXISTS meeting_inbox_delegated_by_user_id_idx ON public.meeting_inbox(delegated_by_user_id);
CREATE INDEX IF NOT EXISTS shared_meetings_meeting_id_idx ON public.shared_meetings(meeting_id);
CREATE INDEX IF NOT EXISTS meetings_calendar_id_idx ON public.meetings(calendar_id);
