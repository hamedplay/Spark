-- Requires the existing notes/reminder delivery schema. Historical migrations are unchanged.
ALTER TABLE public.notes
 ADD COLUMN creator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN creator_name text,
 ADD COLUMN reminder_creator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN reminder_creator_name text,
 ADD COLUMN sms_include_content boolean NOT NULL DEFAULT true;
ALTER TABLE private.note_reminder_deliveries
 ADD COLUMN event_type text NOT NULL DEFAULT 'reminder' CHECK (event_type IN ('share','reminder')),
 ADD COLUMN context jsonb NOT NULL DEFAULT '{}';

CREATE FUNCTION private.note_sender_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT coalesce(nullif(btrim(full_name),''),nullif(btrim(username),''))
 FROM public.profiles WHERE user_id=p_user),'کاربر بدون نام ('||p_user::text||')');
$$;
CREATE FUNCTION private.note_reminder_time(p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_at IS NULL THEN '' ELSE translate(
 replace(private.format_jalali_date((p_at AT TIME ZONE 'Asia/Tehran')::date),'-','/')||' '||
 to_char(p_at AT TIME ZONE 'Asia/Tehran','HH24:MI'),'0123456789','۰۱۲۳۴۵۶۷۸۹') END;
$$;
CREATE FUNCTION private.note_message(p_event text,p_sender text,p_content text,p_time text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_event='reminder' THEN 'یادآوری یادداشت توسط ' ELSE 'یادداشت جدیدی توسط ' END||
 p_sender||' برای شما ارسال شده است.'||E'\n\nمتن یادداشت: '||coalesce(p_content,'')||
 CASE WHEN p_event='reminder' THEN E'\n\nزمان یادآوری: '||p_time ELSE '' END;
$$;
CREATE FUNCTION private.capture_note_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.creator_id:=coalesce(auth.uid(),NEW.user_id);
  NEW.creator_name:=private.note_sender_name(NEW.creator_id);
 ELSE
  -- Identity snapshots cannot be forged by a client or changed by later edits/services.
  NEW.creator_id:=OLD.creator_id; NEW.creator_name:=OLD.creator_name;
  NEW.reminder_creator_id:=OLD.reminder_creator_id;
  NEW.reminder_creator_name:=OLD.reminder_creator_name;
 END IF;
 IF NEW.remind_at IS NOT NULL AND (TG_OP='INSERT' OR NEW.remind_at IS DISTINCT FROM OLD.remind_at) THEN
  NEW.reminder_creator_id:=coalesce(auth.uid(),NEW.user_id);
  NEW.reminder_creator_name:=private.note_sender_name(NEW.reminder_creator_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notes_capture_identity BEFORE INSERT OR UPDATE ON public.notes
 FOR EACH ROW EXECUTE FUNCTION private.capture_note_identity();

CREATE FUNCTION private.enqueue_note_message(p_note uuid,p_recipient uuid,p_event text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.notes; v_sender uuid; v_name text; v_time text; v_body text; v_external text;
 v_context jsonb; v_parts integer; v_part integer;
BEGIN
 SELECT * INTO STRICT n FROM public.notes WHERE id=p_note;
 v_sender:=CASE WHEN p_event='share' THEN n.creator_id ELSE coalesce(n.reminder_creator_id,n.user_id) END;
 v_name:=CASE WHEN p_event='share' THEN n.creator_name ELSE n.reminder_creator_name END;
 v_name:=coalesce(v_name,private.note_sender_name(v_sender));
 IF NOT private.note_reminder_recipient_allowed(v_sender,p_recipient) THEN
  RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE='42501';
 END IF;
 v_time:=private.note_reminder_time(n.remind_at);
 v_body:=private.note_message(p_event,v_name,n.content,v_time);
 v_context:=jsonb_build_object('note_id',n.id,'sender_id',v_sender,'sender_name',v_name,
  'recipient_id',p_recipient,'recipient_name',private.note_sender_name(p_recipient),
  'note_created_at',n.created_at,'remind_at',n.remind_at,'reminder_time',v_time,
  'note_title',CASE WHEN n.sms_include_content THEN n.title ELSE 'یادداشت محرمانه' END,
  'note_content',CASE WHEN n.sms_include_content THEN n.content ELSE 'برای مشاهده متن یادداشت وارد سامانه شوید.' END);
 INSERT INTO public.notifications(user_id,title,message,type,action_url,entity_type,entity_id,
  template_category,template_event_type,sender_id,sender_name,actor_user_id,metadata)
 VALUES(p_recipient,CASE WHEN p_event='share' THEN 'یادداشت جدید' ELSE 'یادآوری یادداشت' END,
  v_body,'note','notes','note',n.id,'note',p_event,v_sender,v_name,v_sender,
  v_context||jsonb_build_object('note_content',n.content,'note_title',n.title));
 v_external:=private.note_message(p_event,v_name,v_context->>'note_content',v_time);
 INSERT INTO private.note_reminder_deliveries(note_id,owner_id,recipient_id,remind_at,channel,message,note_title,note_content,event_type,context)
 VALUES(n.id,n.user_id,p_recipient,coalesce(n.remind_at,n.created_at),'sms',v_external,
  v_context->>'note_title',v_context->>'note_content',p_event,v_context) ON CONFLICT DO NOTHING;
 v_parts:=greatest(1,ceil(char_length(v_external)/1500.0)::integer);
 FOR v_part IN 1..v_parts LOOP
  INSERT INTO private.note_reminder_deliveries(note_id,owner_id,recipient_id,remind_at,channel,part_index,message,note_title,note_content,event_type,context)
  VALUES(n.id,n.user_id,p_recipient,coalesce(n.remind_at,n.created_at),'bale',v_part,
   CASE WHEN v_parts>1 THEN '['||v_part||'/'||v_parts||']'||E'\n' ELSE '' END||
   substring(v_external FROM (v_part-1)*1500+1 FOR 1500),v_context->>'note_title','',p_event,v_context) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION private.process_due_note_reminders(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n record; v_recipient uuid; v_count integer:=0;
BEGIN
 FOR n IN SELECT id,user_id,reminder_user_ids FROM public.notes
  WHERE status='active' AND remind_at<=now() AND reminder_sent_at IS NULL ORDER BY remind_at,id
  LIMIT greatest(1,least(coalesce(p_limit,100),1000)) FOR UPDATE SKIP LOCKED LOOP
  FOR v_recipient IN SELECT DISTINCT x FROM unnest(ARRAY[n.user_id]||n.reminder_user_ids) x LOOP
   IF private.note_reminder_recipient_allowed(n.user_id,v_recipient) THEN
    PERFORM private.enqueue_note_message(n.id,v_recipient,'reminder');
   END IF;
  END LOOP;
  UPDATE public.notes SET reminder_sent_at=now() WHERE id=n.id;
  v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;

CREATE FUNCTION public.share_note_v2(p_note_id uuid,p_recipient_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.notes; v_copy uuid;
BEGIN
 IF auth.uid() IS NULL OR private.is_current_session_fully_authorized() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO n FROM public.notes WHERE id=p_note_id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOTE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF NOT private.note_reminder_recipient_allowed(auth.uid(),p_recipient_id) THEN
  RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.notes(title,content,note_type,status,user_id,sms_include_content)
 VALUES(n.title,n.content,n.note_type,'active',p_recipient_id,n.sms_include_content) RETURNING id INTO v_copy;
 PERFORM private.enqueue_note_message(v_copy,p_recipient_id,'share');
 RETURN v_copy;
END $$;
-- The old text-only API cannot verify a source note or inherit its privacy policy.
CREATE OR REPLACE FUNCTION private.share_note_to_user(p_title text,p_content text,p_note_type text,p_recipient_id uuid,p_sender_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'NOTE_SOURCE_REQUIRED: لطفاً صفحه یادداشت‌ها را بازخوانی کنید' USING ERRCODE='22023'; END $$;

CREATE OR REPLACE FUNCTION public.claim_note_reminder_deliveries(p_limit integer DEFAULT 10)
RETURNS SETOF private.note_reminder_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.note_reminder_deliveries SET status='uncertain',last_error='DELIVERY_OUTCOME_UNKNOWN'
 WHERE status='sending' AND claimed_at<now()-interval '5 minutes';
 UPDATE private.note_reminder_deliveries j SET status='cancelled',last_error='REMINDER_CANCELLED_OR_RECIPIENT_NOT_ALLOWED'
 WHERE status IN('pending','failed') AND (NOT EXISTS(SELECT FROM public.notes n WHERE n.id=j.note_id
  AND n.user_id=j.owner_id AND n.status='active' AND
  ((j.event_type='share' AND n.user_id=j.recipient_id) OR (j.event_type='reminder' AND n.remind_at=j.remind_at
    AND (n.user_id=j.recipient_id OR j.recipient_id=ANY(n.reminder_user_ids)))))
  OR NOT private.note_reminder_recipient_allowed(coalesce((j.context->>'sender_id')::uuid,j.owner_id),j.recipient_id));
 RETURN QUERY WITH candidates AS (
  SELECT j.id FROM private.note_reminder_deliveries j
  WHERE j.status IN('pending','failed') AND j.attempts<3 AND j.available_at<=now()
   AND NOT EXISTS(SELECT FROM private.note_reminder_deliveries earlier WHERE earlier.note_id=j.note_id
    AND earlier.remind_at=j.remind_at AND earlier.recipient_id=j.recipient_id AND earlier.channel=j.channel
    AND earlier.part_index<j.part_index AND earlier.status NOT IN('sent','skipped'))
  ORDER BY j.created_at,j.part_index,j.id LIMIT greatest(1,least(coalesce(p_limit,10),25)) FOR UPDATE SKIP LOCKED
 ) UPDATE private.note_reminder_deliveries j SET status='sending',lease=gen_random_uuid(),claimed_at=now(),attempts=j.attempts+1
 FROM candidates c WHERE j.id=c.id RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION public.finish_note_reminder_delivery(p_id uuid,p_lease uuid,p_status text,p_error text DEFAULT NULL,p_available_at timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 IF p_status NOT IN('sent','skipped','failed','uncertain','pending','cancelled') THEN RAISE EXCEPTION 'INVALID_DELIVERY_STATUS'; END IF;
 UPDATE private.note_reminder_deliveries SET status=p_status,last_error=left(p_error,500),
 available_at=coalesce(p_available_at,now()+interval '2 minutes'),
 attempts=CASE WHEN p_status='pending' THEN greatest(0,attempts-1) ELSE attempts END
 WHERE id=p_id AND lease=p_lease AND status='sending';
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count=1;
END $$;

-- Resolve again immediately before external delivery: queued jobs cannot bypass a later privacy change.
CREATE FUNCTION public.get_note_delivery_envelope(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.note_reminder_deliveries; n public.notes; v_context jsonb; v_name text; v_sender uuid; v_message text;
BEGIN
 SELECT * INTO j FROM private.note_reminder_deliveries WHERE id=p_id AND lease=p_lease AND status='sending';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO n FROM public.notes WHERE id=j.note_id AND user_id=j.owner_id AND status='active';
 IF NOT FOUND OR (j.event_type='reminder' AND (n.remind_at IS DISTINCT FROM j.remind_at OR
  NOT (n.user_id=j.recipient_id OR j.recipient_id=ANY(n.reminder_user_ids)))) THEN RETURN NULL; END IF;
 v_sender:=coalesce((j.context->>'sender_id')::uuid,n.reminder_creator_id,j.owner_id);
 IF NOT private.note_reminder_recipient_allowed(v_sender,j.recipient_id) THEN RETURN NULL; END IF;
 v_name:=coalesce(j.context->>'sender_name',n.reminder_creator_name,private.note_sender_name(v_sender));
 v_context:=j.context||jsonb_build_object('sender_id',v_sender,'sender_name',v_name,'note_id',j.note_id,
  'note_title',j.note_title,'note_content',j.note_content,'reminder_time',private.note_reminder_time(n.remind_at));
 IF NOT n.sms_include_content AND j.channel='bale' AND j.part_index>1 THEN
  RETURN jsonb_build_object('skip',true);
 END IF;
 IF NOT n.sms_include_content THEN
  v_context:=v_context||jsonb_build_object('note_title','یادداشت محرمانه','note_content','برای مشاهده متن یادداشت وارد سامانه شوید.');
  v_message:=private.note_message(j.event_type,v_name,v_context->>'note_content',v_context->>'reminder_time');
 ELSIF j.context='{}'::jsonb AND j.channel='bale' THEN
  -- Legacy multipart jobs retain every part; add identity and time without guessing lost text.
  v_message:=private.note_message(j.event_type,v_name,j.message,v_context->>'reminder_time');
 ELSE
  v_message:=CASE WHEN j.channel='bale' THEN j.message ELSE private.note_message(j.event_type,v_name,j.note_content,v_context->>'reminder_time') END;
 END IF;
 RETURN jsonb_build_object('message',v_message,'context',v_context,'event_type',j.event_type,'sender_id',v_sender);
END $$;

CREATE FUNCTION public.get_note_message_details(p_note_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.notes; v_users jsonb;
BEGIN
 IF auth.uid() IS NULL OR private.is_current_session_fully_authorized() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO n FROM public.notes WHERE id=p_note_id;
 IF NOT FOUND OR NOT (n.user_id=auth.uid() OR
  (auth.uid()=ANY(n.reminder_user_ids) AND n.remind_at IS NOT NULL
   AND private.note_reminder_recipient_allowed(n.user_id,auth.uid()))) THEN
  RAISE EXCEPTION 'NOTE_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',x,'name',private.note_sender_name(x))) INTO v_users
 FROM (SELECT DISTINCT x FROM unnest(ARRAY[n.user_id]||n.reminder_user_ids) x
  WHERE x=n.user_id OR private.note_reminder_recipient_allowed(n.user_id,x)) u
 WHERE n.user_id=auth.uid() OR x=auth.uid();
 RETURN jsonb_build_object('creator_name',n.creator_name,'reminder_creator_name',
  coalesce(n.reminder_creator_name,CASE WHEN n.remind_at IS NOT NULL THEN private.note_sender_name(n.user_id) END),
  'created_at',n.created_at,'remind_at',n.remind_at,'recipients',v_users,'sms_include_content',n.sms_include_content);
END $$;

-- Apply the requested standard to all configured note audiences, leaving other categories alone.
UPDATE public.sms_templates SET body=CASE WHEN event_type='share' THEN
 E'یادداشت جدیدی توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}'
 ELSE E'یادآوری یادداشت توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}\n\nزمان یادآوری: {{reminder_time}}' END,
 placeholders=CASE WHEN event_type='share' THEN ARRAY['sender_name','note_content'] ELSE ARRAY['sender_name','note_content','reminder_time'] END,
 updated_at=now() WHERE category='note' AND event_type IN('share','reminder');
INSERT INTO public.sms_templates(category,event_type,audience,subject,body,placeholders)
SELECT 'note',e,'all',CASE WHEN e='share' THEN 'یادداشت جدید' ELSE 'یادآوری یادداشت' END,
 CASE WHEN e='share' THEN E'یادداشت جدیدی توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}'
 ELSE E'یادآوری یادداشت توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}\n\nزمان یادآوری: {{reminder_time}}' END,
 CASE WHEN e='share' THEN ARRAY['sender_name','note_content'] ELSE ARRAY['sender_name','note_content','reminder_time'] END
FROM unnest(ARRAY['share','reminder']) e WHERE NOT EXISTS(SELECT FROM public.sms_templates WHERE category='note' AND event_type=e AND audience='all');
UPDATE public.notification_templates SET title=CASE WHEN event_type='share' THEN 'یادداشت جدید' ELSE 'یادآوری یادداشت' END,
 body=CASE WHEN event_type='share' THEN E'یادداشت جدیدی توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}'
 ELSE E'یادآوری یادداشت توسط {{sender_name}} برای شما ارسال شده است.\n\nمتن یادداشت: {{note_content}}\n\nزمان یادآوری: {{reminder_time}}' END,
 placeholders=CASE WHEN event_type='share' THEN ARRAY['sender_name','note_content'] ELSE ARRAY['sender_name','note_content','reminder_time'] END,
 updated_at=now() WHERE category='note' AND event_type IN('share','reminder');

REVOKE ALL ON FUNCTION private.note_sender_name(uuid),private.note_reminder_time(timestamptz),
 private.note_message(text,text,text,text),private.capture_note_identity(),private.enqueue_note_message(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_note_delivery_envelope(uuid,uuid),public.share_note_v2(uuid,uuid),public.get_note_message_details(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_note_delivery_envelope(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.share_note_v2(uuid,uuid),public.get_note_message_details(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
INSERT INTO public.notification_templates(category,event_type,audience,title,body,placeholders)
SELECT 'note',s.event_type,'all',s.subject,s.body,s.placeholders FROM public.sms_templates s
WHERE s.category='note' AND s.event_type IN('share','reminder') AND s.audience='all'
AND NOT EXISTS(SELECT FROM public.notification_templates t WHERE t.category='note' AND t.event_type=s.event_type AND t.audience='all');
