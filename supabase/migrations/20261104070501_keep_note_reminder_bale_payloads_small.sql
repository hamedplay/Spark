-- Bale sends only its own chunk; do not duplicate the entire note in every chunk row.
UPDATE private.note_reminder_deliveries SET note_content='' WHERE channel='bale';

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
        CASE WHEN v_parts>1 THEN '['||v_part||'/'||v_parts||']'||E'\n' ELSE '' END||substring(v_text FROM (v_part-1)*1500+1 FOR 1500),coalesce(n.title,''),'') ON CONFLICT DO NOTHING;
     END LOOP;
   END LOOP;
   UPDATE public.notes SET reminder_sent_at=now() WHERE id=n.id;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $f$;
REVOKE ALL ON FUNCTION private.process_due_note_reminders(integer) FROM PUBLIC,anon,authenticated,service_role;

