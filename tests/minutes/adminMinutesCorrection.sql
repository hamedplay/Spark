-- Run against a migrated Spark test DB with at least one minute and admin.
-- Fixtures and all document changes are rolled back; no real token is needed.
BEGIN;
DO $test$
DECLARE
 admin_id uuid; session_id uuid:=gen_random_uuid(); epoch integer; test_minute_id uuid; decision_id uuid:=gen_random_uuid();
 version timestamptz; decision_version timestamptz; result jsonb; payload jsonb; decisions jsonb; states jsonb;
 before_failure jsonb; target text;
BEGIN
 SELECT user_id,auth_epoch INTO admin_id,epoch FROM public.profiles
   WHERE is_admin AND is_active AND account_status='ACTIVE' AND mfa_method IS NULL LIMIT 1;
 SELECT id INTO test_minute_id FROM public.minutes ORDER BY created_at LIMIT 1;
 IF admin_id IS NULL OR test_minute_id IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURES_REQUIRED'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 result:=public.admin_correct_minutes(test_minute_id,now(),'{}','[]','{}','{}','published','test','{}','[]');
 IF result->>'error_code' IS DISTINCT FROM 'ADMIN_FULL_ACCESS_REQUIRED' THEN RAISE EXCEPTION 'Anonymous access allowed: %',result; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT user_id FROM public.profiles WHERE NOT is_admin LIMIT 1),'role','authenticated')::text,true);
 result:=public.admin_correct_minutes(test_minute_id,now(),'{}','[]','{}','{}','published','test','{}','[]');
 IF result->>'error_code' IS DISTINCT FROM 'ADMIN_FULL_ACCESS_REQUIRED' THEN RAISE EXCEPTION 'Non-admin access allowed'; END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal) VALUES(session_id,admin_id,now(),now(),'aal1');
 INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
 VALUES(session_id,admin_id,coalesce(epoch,1),now()+interval '1 hour',now()+interval '1 hour');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',session_id,'role','authenticated','aal','aal1','amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true);
 IF public.get_my_auth_access_state()->>'access_level' IS DISTINCT FROM 'FULL' THEN RAISE EXCEPTION 'Test session not FULL: %',public.get_my_auth_access_state(); END IF;
 UPDATE public.minutes SET status='published',published_at=now() WHERE id=test_minute_id RETURNING updated_at INTO version;
 PERFORM public.get_minutes_decisions_for_edit(test_minute_id);
 INSERT INTO public.minutes_decisions(id,minute_id,title,primary_owner_user_id,created_by_user_id,status,progress_percent)
 VALUES(decision_id,test_minute_id,'Admin correction test decision',admin_id,admin_id,'in_progress',20) RETURNING updated_at INTO decision_version;
 payload:=jsonb_build_object('meeting_title_snapshot','Admin correction test','meeting_date_snapshot','2026-10-20',
   'secretary_name_snapshot','Test secretary','chair_name_snapshot','Test chair','confidentiality','organizational',
   'admin_finalization',jsonb_build_object('signDate','2026-10-20','versionNumber','2.1','versionNotes','Corrected by manager'),'approval_mode','in_person','internal_participants','[]'::jsonb,'external_participants','[]'::jsonb,'agenda_results','[]'::jsonb);
 decisions:=jsonb_build_array(jsonb_build_object('id',decision_id,'title','Corrected decision','responsible_party_type','internal',
   'primary_owner_user_id',admin_id,'priority','normal','requires_followup',false));
 states:=jsonb_build_array(jsonb_build_object('id',decision_id,'status','completed','progress_percent',100,'expected_updated_at',decision_version));
 result:=public.admin_correct_minutes(test_minute_id,version,payload,decisions,'{}','{}','published','Manager requested correction','{"internal":[],"external":[]}',states);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Admin correction failed: %',result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.minutes WHERE id=test_minute_id AND status='published' AND meeting_title_snapshot='Admin correction test') THEN RAISE EXCEPTION 'Published content not saved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.minutes_decisions WHERE id=decision_id AND title='Corrected decision' AND status='completed' AND completed_at IS NOT NULL AND progress_percent=100) THEN RAISE EXCEPTION 'Decision content/status not saved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.minutes_audit_log WHERE minute_id=test_minute_id AND action='admin_correction' AND actor_user_id=admin_id AND metadata->>'reason'='Manager requested correction' AND old_values->'minute'->>'status'='published' AND new_values->'minute'->>'status'='published') THEN RAISE EXCEPTION 'Full audit missing'; END IF;
 SELECT updated_at INTO version FROM public.minutes WHERE id=test_minute_id;
 result:=public.admin_correct_minutes(test_minute_id,version,payload,decisions,'{}','{}','published',' ','{"internal":[],"external":[]}','[]');
 IF result->>'error_code' IS DISTINCT FROM 'CORRECTION_REASON_REQUIRED' THEN RAISE EXCEPTION 'Reason not enforced'; END IF;
 result:=public.admin_correct_minutes(test_minute_id,'2000-01-01',payload,decisions,'{}','{}','published','test','{"internal":[],"external":[]}','[]');
 IF result->>'error_code' IS DISTINCT FROM 'MINUTES_VERSION_CONFLICT' THEN RAISE EXCEPTION 'Document conflict not enforced'; END IF;
 states:=jsonb_build_array(jsonb_build_object('id',decision_id,'status','completed','progress_percent',100,'expected_updated_at','2000-01-01'));
 result:=public.admin_correct_minutes(test_minute_id,version,payload,decisions,'{}','{}','published','test','{"internal":[],"external":[]}',states);
 IF result->>'error_code' IS DISTINCT FROM 'DECISION_VERSION_CONFLICT' THEN RAISE EXCEPTION 'Decision conflict not enforced'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.minutes WHERE id=test_minute_id AND admin_finalization->>'versionNumber'='2.1') THEN RAISE EXCEPTION 'Finalization not saved'; END IF;
 before_failure:=private.admin_minutes_snapshot(test_minute_id);
 -- A late failure must roll back content, temporary draft state, signatories and audit.
 SELECT updated_at INTO decision_version FROM public.minutes_decisions WHERE id=decision_id;
 states:=jsonb_build_array(jsonb_build_object('id',decision_id,'status','completed','progress_percent',50,'expected_updated_at',decision_version));
 result:=public.admin_correct_minutes(test_minute_id,version,payload||'{"meeting_title_snapshot":"MUST ROLLBACK"}',decisions,'{}','{}','draft','test','{"internal":[],"external":[]}',states);
 IF result->>'error_code' IS DISTINCT FROM 'COMPLETION_REQUIRES_100_PERCENT' THEN RAISE EXCEPTION 'Invalid completion accepted: %',result; END IF;
 IF private.admin_minutes_snapshot(test_minute_id) IS DISTINCT FROM before_failure THEN RAISE EXCEPTION 'Partial save leaked'; END IF;
 -- All five supported minute statuses are administratively selectable.
 FOREACH target IN ARRAY ARRAY['draft','changes_requested','pending_approval','approved','published'] LOOP
  SELECT updated_at INTO version FROM public.minutes WHERE id=test_minute_id;
  result:=public.admin_correct_minutes(test_minute_id,version,payload,decisions,'{}','{}',target,'Status correction','{"internal":[],"external":[]}','[]');
  IF result->>'success' IS DISTINCT FROM 'true' OR (SELECT status FROM public.minutes WHERE id=test_minute_id)<>target THEN RAISE EXCEPTION 'Status correction failed: % %',target,result; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.minutes WHERE id=test_minute_id AND admin_published_by_user_id=admin_id
   AND admin_published_at IS NOT NULL AND secretary_confirmed_at IS NULL AND chair_confirmed_at IS NULL) THEN
   RAISE EXCEPTION 'Administrative publication/signature separation failed';
 END IF;
 -- A valid admin identity without a valid session cannot use the correction API.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 result:=public.admin_correct_minutes(test_minute_id,version,payload,decisions,'{}','{}','published','test','{"internal":[],"external":[]}','[]');
 IF result->>'error_code' IS DISTINCT FROM 'ADMIN_FULL_ACCESS_REQUIRED' THEN RAISE EXCEPTION 'Session gate bypassed'; END IF;
END;
$test$;
ROLLBACK;
