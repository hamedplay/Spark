ALTER TABLE public.notes ADD COLUMN reminder_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE TABLE private.note_reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL, recipient_id uuid NOT NULL, remind_at timestamptz NOT NULL,
 channel text NOT NULL CHECK(channel IN('sms','bale')), part_index integer NOT NULL DEFAULT 1,
 message text NOT NULL, note_title text NOT NULL, note_content text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','skipped','failed','uncertain','cancelled')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease uuid, claimed_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(note_id,remind_at,recipient_id,channel,part_index)
);
ALTER TABLE private.note_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.note_reminder_deliveries FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX note_reminder_delivery_pending_idx ON private.note_reminder_deliveries(available_at,created_at) WHERE status IN('pending','failed','sending');
CREATE TABLE private.note_reminder_worker_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), worker_url text,
 worker_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
 last_tick_at timestamptz, last_error text
);
ALTER TABLE private.note_reminder_worker_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.note_reminder_worker_config FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.note_reminder_worker_config(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION private.note_reminder_recipient_allowed(p_owner uuid,p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT FROM public.profiles s JOIN public.profiles r ON r.user_id=p_recipient
 WHERE s.user_id=p_owner AND s.is_active IS TRUE AND s.account_status='ACTIVE'
 AND r.is_active IS TRUE AND r.account_status='ACTIVE'
 AND (p_owner=p_recipient OR (nullif(btrim(s.organization),'') IS NOT NULL AND s.organization=r.organization AND NOT coalesce(r.is_hidden,false))));
$f$;
REVOKE ALL ON FUNCTION private.note_reminder_recipient_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.prepare_note_reminder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_id uuid;
BEGIN
 IF NEW.status='archived' OR NEW.remind_at IS NULL THEN
   NEW.remind_at:=NULL; NEW.reminder_user_ids:='{}'; NEW.reminder_sent_at:=NULL;
   RETURN NEW;
 END IF;
 NEW.reminder_user_ids:=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(NEW.reminder_user_ids,'{}')) x WHERE x IS NOT NULL AND x<>NEW.user_id ORDER BY x);
 IF cardinality(NEW.reminder_user_ids)>20 THEN RAISE EXCEPTION 'حداکثر ۲۰ گیرنده دیگر مجاز است' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.remind_at IS NOT DISTINCT FROM OLD.remind_at AND NEW.reminder_user_ids IS NOT DISTINCT FROM OLD.reminder_user_ids THEN RETURN NEW; END IF;
 END IF;
 IF NOT isfinite(NEW.remind_at) OR NEW.remind_at<=now() THEN
   RAISE EXCEPTION 'تاریخ و ساعت یادآوری باید در آینده باشد' USING ERRCODE='22023';
 END IF;
 FOREACH v_id IN ARRAY NEW.reminder_user_ids LOOP
   IF NOT private.note_reminder_recipient_allowed(NEW.user_id,v_id) THEN
     RAISE EXCEPTION 'گیرنده یادآوری مجاز نیست یا حساب او غیرفعال است' USING ERRCODE='42501';
   END IF;
 END LOOP;
 NEW.reminder_sent_at:=NULL;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.prepare_note_reminder() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.process_due_note_reminders(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE n record; v_recipient uuid; v_count integer:=0; v_text text; v_parts integer; v_part integer;
BEGIN
 FOR n IN SELECT id,user_id,title,content,remind_at,reminder_user_ids FROM public.notes
  WHERE status='active' AND remind_at<=now() AND reminder_sent_at IS NULL ORDER BY remind_at,id
  LIMIT greatest(1,least(coalesce(p_limit,100),1000)) FOR UPDATE SKIP LOCKED LOOP
   v_text:='یادآوری یادداشت: '||coalesce(n.title,'')||E'\n\n'||coalesce(n.content,'');
   FOR v_recipient IN SELECT DISTINCT x FROM unnest(ARRAY[n.user_id]||n.reminder_user_ids) x LOOP
     IF NOT private.note_reminder_recipient_allowed(n.user_id,v_recipient) THEN CONTINUE; END IF;
     INSERT INTO public.notifications(user_id,title,message,type,action_url,entity_type,entity_id,template_category,template_event_type,metadata)
      VALUES(v_recipient,'یادآوری یادداشت: '||coalesce(n.title,''),coalesce(n.content,''),'note','notes','note',n.id,'note','reminder',jsonb_build_object('note_id',n.id,'remind_at',n.remind_at,'owner_id',n.user_id));
     INSERT INTO private.note_reminder_deliveries(note_id,owner_id,recipient_id,remind_at,channel,message,note_title,note_content)
      VALUES(n.id,n.user_id,v_recipient,n.remind_at,'sms',v_text,coalesce(n.title,''),coalesce(n.content,'')) ON CONFLICT DO NOTHING;
     -- Separate ledger entries preserve the complete text of long Bale messages.
     v_parts:=greatest(1,ceil(char_length(v_text)/1500.0)::integer);
     FOR v_part IN 1..v_parts LOOP
       INSERT INTO private.note_reminder_deliveries(note_id,owner_id,recipient_id,remind_at,channel,part_index,message,note_title,note_content)
        VALUES(n.id,n.user_id,v_recipient,n.remind_at,'bale',v_part,
        CASE WHEN v_parts>1 THEN '['||v_part||'/'||v_parts||']'||E'\n' ELSE '' END||substring(v_text FROM (v_part-1)*1500+1 FOR 1500),coalesce(n.title,''),coalesce(n.content,'')) ON CONFLICT DO NOTHING;
     END LOOP;
   END LOOP;
   UPDATE public.notes SET reminder_sent_at=now() WHERE id=n.id;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $f$;
REVOKE ALL ON FUNCTION private.process_due_note_reminders(integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_note_reminder_deliveries(p_limit integer DEFAULT 10)
RETURNS SETOF private.note_reminder_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 UPDATE private.note_reminder_deliveries SET status='uncertain',last_error='DELIVERY_OUTCOME_UNKNOWN'
 WHERE status='sending' AND claimed_at<now()-interval '5 minutes';
 UPDATE private.note_reminder_deliveries j SET status='cancelled',last_error='REMINDER_CANCELLED_OR_RECIPIENT_NOT_ALLOWED'
 WHERE status IN('pending','failed') AND (NOT EXISTS(SELECT FROM public.notes n WHERE n.id=j.note_id AND n.user_id=j.owner_id AND n.status='active' AND n.remind_at=j.remind_at AND (n.user_id=j.recipient_id OR j.recipient_id=ANY(n.reminder_user_ids))) OR NOT private.note_reminder_recipient_allowed(j.owner_id,j.recipient_id));
 RETURN QUERY WITH candidates AS (
  SELECT j.id FROM private.note_reminder_deliveries j
  WHERE j.status IN('pending','failed') AND j.attempts<3 AND j.available_at<=now()
   AND NOT EXISTS(SELECT FROM private.note_reminder_deliveries earlier WHERE earlier.note_id=j.note_id AND earlier.remind_at=j.remind_at AND earlier.recipient_id=j.recipient_id AND earlier.channel=j.channel AND earlier.part_index<j.part_index AND earlier.status NOT IN('sent','skipped'))
  ORDER BY j.created_at,j.part_index,j.id LIMIT greatest(1,least(coalesce(p_limit,10),25)) FOR UPDATE SKIP LOCKED
 ) UPDATE private.note_reminder_deliveries j SET status='sending',lease=gen_random_uuid(),claimed_at=now(),attempts=j.attempts+1
 FROM candidates c WHERE j.id=c.id RETURNING j.*;
END $f$;
REVOKE ALL ON FUNCTION public.claim_note_reminder_deliveries(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_note_reminder_deliveries(integer) TO service_role;

CREATE FUNCTION public.finish_note_reminder_delivery(p_id uuid,p_lease uuid,p_status text,p_error text DEFAULT NULL,p_available_at timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_count integer;
BEGIN
 IF p_status NOT IN('sent','skipped','failed','uncertain','pending') THEN RAISE EXCEPTION 'INVALID_DELIVERY_STATUS'; END IF;
 UPDATE private.note_reminder_deliveries SET status=p_status,last_error=left(p_error,500),
 available_at=coalesce(p_available_at,now()+interval '2 minutes'), attempts=CASE WHEN p_status='pending' THEN greatest(0,attempts-1) ELSE attempts END
 WHERE id=p_id AND lease=p_lease AND status='sending';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END $f$;
REVOKE ALL ON FUNCTION public.finish_note_reminder_delivery(uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_note_reminder_delivery(uuid,uuid,text,text,timestamptz) TO service_role;

CREATE FUNCTION public.verify_note_reminder_worker_token(p_candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT coalesce((SELECT p_candidate IS NOT NULL AND length(p_candidate)>0 AND extensions.digest(p_candidate,'sha256')=extensions.digest(worker_token,'sha256') FROM private.note_reminder_worker_config WHERE singleton),false);
$f$;
REVOKE ALL ON FUNCTION public.verify_note_reminder_worker_token(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_note_reminder_worker_token(text) TO service_role;

CREATE FUNCTION private.configure_note_reminder_worker(p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF p_url !~ '^https://[^/?#@[:space:]]+/functions/v1/note-reminder-worker$' THEN RAISE EXCEPTION 'INVALID_NOTE_WORKER_URL'; END IF;
 UPDATE private.note_reminder_worker_config SET worker_url=p_url,last_error=NULL WHERE singleton;
END $f$;
REVOKE ALL ON FUNCTION private.configure_note_reminder_worker(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.run_note_reminder_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE cfg private.note_reminder_worker_config;
BEGIN
 PERFORM private.process_due_note_reminders();
 SELECT * INTO cfg FROM private.note_reminder_worker_config WHERE singleton;
 UPDATE private.note_reminder_worker_config SET last_tick_at=now() WHERE singleton;
 IF NOT EXISTS(SELECT FROM private.note_reminder_deliveries WHERE (status IN('pending','failed') AND attempts<3 AND available_at<=now()) OR status='sending') THEN RETURN; END IF;
 IF cfg.worker_url IS NULL THEN UPDATE private.note_reminder_worker_config SET last_error='WORKER_NOT_CONFIGURED' WHERE singleton; RETURN; END IF;
 BEGIN
  PERFORM net.http_post(url:=cfg.worker_url,headers:=jsonb_build_object('Content-Type','application/json','X-Note-Worker-Token',cfg.worker_token),body:='{}'::jsonb,timeout_milliseconds:=55000);
  UPDATE private.note_reminder_worker_config SET last_error=NULL WHERE singleton;
 EXCEPTION WHEN OTHERS THEN UPDATE private.note_reminder_worker_config SET last_error='WORKER_DISPATCH_FAILED:'||SQLSTATE WHERE singleton;
 END;
END $f$;
REVOKE ALL ON FUNCTION private.run_note_reminder_tick() FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.sms_templates(category,event_type,audience,subject,body,placeholders,is_active)
 SELECT 'note','reminder','all','یادآوری یادداشت','یادآوری یادداشت: {{note_title}}'||E'\n\n'||'{{note_content}}',ARRAY['note_title','note_content'],true
 WHERE NOT EXISTS(SELECT FROM public.sms_templates WHERE category='note' AND event_type='reminder' AND audience='all');
SELECT cron.schedule('spark-note-reminders','* * * * *','SELECT private.run_note_reminder_tick();');
NOTIFY pgrst,'reload schema';
