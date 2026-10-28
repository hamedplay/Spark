CREATE OR REPLACE FUNCTION private.meeting_series_message_context(p_meetings jsonb, p_event_type text, p_recipient uuid, p_pattern text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_rows jsonb; v_first jsonb; v_last jsonb; v_count integer; v_dates text; v_summary text; v_pattern text; v_name text; v_gender text; v_weekdays text; v_frequency text; v_interval integer;
BEGIN
 SELECT jsonb_agg(e ORDER BY private.meeting_local_date(e->>'request_date'),e->>'start_time',e->>'id')
 INTO v_rows FROM jsonb_array_elements(p_meetings)e;
 v_count:=jsonb_array_length(v_rows);
 IF COALESCE(v_count,0)=0 THEN RAISE EXCEPTION 'EMPTY_MEETING_EVENT'; END IF;
 v_first:=v_rows->0; v_last:=v_rows->(v_count-1);
 v_dates:=private.format_jalali_date(private.meeting_local_date(v_first->>'request_date'));
 IF v_count>1 THEN v_dates:=v_dates||' تا '||private.format_jalali_date(private.meeting_local_date(v_last->>'request_date'))||' ('||v_count||' نوبت)'; END IF;
 v_pattern:=COALESCE(NULLIF(p_pattern,''),CASE v_first->>'repeat_type' WHEN 'weekly' THEN 'تکرار هفتگی' ELSE 'تکرار ماهانه' END);
 v_summary:=CASE p_event_type WHEN 'series_invite' THEN 'دعوت به' WHEN 'series_cancel' THEN 'لغو دعوت/جلسه'
 WHEN 'series_reminder' THEN 'یادآوری' ELSE 'تغییر برنامه' END||' «'||(v_first->>'subject')||'» | '||v_dates||
 ' | ساعت '||COALESCE(v_first->>'start_time','')||' تا '||COALESCE(v_first->>'end_time','')||' | '||COALESCE(v_first->>'location','');
 IF v_count>1 THEN v_summary:=v_summary||' | '||v_pattern||'؛ جزئیات و استثناها در تقویم اسپارک'; END IF;
 SELECT COALESCE(full_name,'همکار گرامی'),gender INTO v_name,v_gender FROM public.profiles WHERE user_id=p_recipient;
 v_name:=COALESCE(v_name,'همکار گرامی');
 SELECT string_agg(CASE d.dow WHEN 0 THEN 'یکشنبه‌ها' WHEN 1 THEN 'دوشنبه‌ها' WHEN 2 THEN 'سه‌شنبه‌ها'
 WHEN 3 THEN 'چهارشنبه‌ها' WHEN 4 THEN 'پنجشنبه‌ها' WHEN 5 THEN 'جمعه‌ها' ELSE 'شنبه‌ها' END,' و ' ORDER BY (d.dow+1)%7)
 INTO v_weekdays FROM (SELECT DISTINCT extract(dow FROM private.meeting_local_date(e->>'request_date'))::integer dow
 FROM jsonb_array_elements(v_rows)e)d;
 v_interval:=COALESCE(NULLIF(v_first->>'repeat_interval','')::integer,1);
 v_frequency:=CASE v_first->>'repeat_type'
 WHEN 'weekly' THEN CASE WHEN v_interval=1 THEN 'هفتگی' ELSE 'هر '||translate(v_interval::text,'0123456789','۰۱۲۳۴۵۶۷۸۹')||' هفته' END
 WHEN 'monthly' THEN CASE WHEN v_interval=1 THEN 'ماهانه' ELSE 'هر '||translate(v_interval::text,'0123456789','۰۱۲۳۴۵۶۷۸۹')||' ماه' END
 ELSE 'مطابق تقویم' END;
 RETURN jsonb_build_object('series_weekdays',v_weekdays,'recurrence_frequency',v_frequency,
 'formal_recipient_greeting',CASE WHEN v_name='همکار گرامی' THEN v_name WHEN v_gender='male' THEN 'جناب آقای '||v_name
 WHEN v_gender='female' THEN 'سرکار خانم '||v_name ELSE v_name||' گرامی' END,'summary',v_summary,'meeting_subject',v_first->>'subject',
 'meeting_date',private.format_jalali_date(private.meeting_local_date(v_first->>'request_date')),
 'start_time',COALESCE(v_first->>'start_time',''),'end_time',COALESCE(v_first->>'end_time',''),
 'location',COALESCE(v_first->>'location',''),'full_name',v_name,'recipient_greeting',v_name||' گرامی',
 'series_id',v_first->>'series_id','occurrence_count',v_count,'series_pattern',v_pattern,
 'series_start_date',replace(private.format_jalali_date(private.meeting_local_date(v_first->>'request_date')),'-','/'),
 'series_end_date',replace(private.format_jalali_date(private.meeting_local_date(v_last->>'request_date')),'-','/'),
 'meeting_time',COALESCE(v_first->>'start_time','')||' تا '||COALESCE(v_first->>'end_time',''),
 'location_part',CASE WHEN nullif(v_first->>'location','') IS NULL THEN '' ELSE ' | '||(v_first->>'location') END);
END;
$function$;

-- Only the invitation text changes; notification policies and other event bodies stay intact.
UPDATE public.sms_templates SET subject='دعوت به جلسات تکرارشونده',
 body=E'{{formal_recipient_greeting}}\n\nشما به مجموعه جلسات تکرارشونده «{{meeting_subject}}» دعوت شده‌اید.\n\nروز برگزاری: {{series_weekdays}}\nساعت: {{start_time}}\nدوره تکرار: {{recurrence_frequency}}\nاز تاریخ {{series_start_date}} تا {{series_end_date}}\n\nجزئیات و برنامه جلسات در تقویم سامانه اسپارک قابل مشاهده است.',
 placeholders=ARRAY['formal_recipient_greeting','meeting_subject','series_weekdays','start_time','recurrence_frequency','series_start_date','series_end_date'],updated_at=now()
WHERE category='meeting' AND event_type='series_invite' AND audience='all';
UPDATE public.notification_templates SET title='دعوت به جلسات تکرارشونده',
 body=E'شما به مجموعه جلسات «{{meeting_subject}}» دعوت شده‌اید.\n\nاین جلسات به‌صورت {{recurrence_frequency}}، هر {{series_weekdays}} ساعت {{start_time}}، از تاریخ {{series_start_date}} تا {{series_end_date}} برگزار خواهند شد.\n\nتعداد جلسات برنامه‌ریزی‌شده: {{occurrence_count}}\n\nبرنامه کامل جلسات در تقویم شما ثبت شده است.',
 placeholders=ARRAY['meeting_subject','recurrence_frequency','series_weekdays','start_time','series_start_date','series_end_date','occurrence_count'],updated_at=now()
WHERE category='meeting' AND event_type='series_invite' AND audience='all';
-- Refresh only unsent invitations so their new template fields are present.
UPDATE private.meeting_notification_jobs j
SET context=j.context||private.meeting_series_message_context(j.meetings,j.event_type,j.recipient_id,j.context->>'series_pattern')
WHERE j.status='pending' AND j.event_type='series_invite' AND jsonb_array_length(j.meetings)>0;
NOTIFY pgrst,'reload schema';
