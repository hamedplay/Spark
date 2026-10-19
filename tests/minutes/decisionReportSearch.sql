BEGIN;
DO $test$
DECLARE
 caller_id uuid; m_id uuid; p_id uuid:=gen_random_uuid(); c_id uuid:=gen_random_uuid();
 r jsonb; baseline integer;
BEGIN
 SELECT user_id INTO caller_id FROM public.profiles WHERE is_admin AND is_active LIMIT 1;
 SELECT id INTO m_id FROM public.minutes ORDER BY created_at LIMIT 1;
 IF caller_id IS NULL OR m_id IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURES_REQUIRED'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',caller_id,'role','authenticated')::text,true);
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id),100,0);
 baseline:=(r->>'total_count')::integer;
 INSERT INTO public.minutes_decisions(id,minute_id,title,description,primary_owner_user_id,created_by_user_id)
 VALUES(p_id,m_id,'Report search fixture','sparkprobe100%_text',caller_id,caller_id);
 INSERT INTO public.minutes_decisions(id,minute_id,parent_decision_id,clause_order,title,description,primary_owner_user_id,created_by_user_id)
 VALUES(c_id,m_id,p_id,1,'Ordinary clause','بررسی بهينه‌سازي sparkclauseprobe',caller_id,caller_id);
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id,'query','بهینه سازی sparkclauseprobe'),1,0);
 IF (r->>'total_count')::integer<>1 OR r->'rows'->0->>'id'<>p_id::text THEN RAISE EXCEPTION 'Persian normalized clause search failed: %',r; END IF;
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id,'query','sparkprobe100%_text'),25,0);
 IF (r->>'total_count')::integer<>1 THEN RAISE EXCEPTION 'Literal percent/underscore search failed'; END IF;
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id,'query','sparkprobe100XYtext'),25,0);
 IF (r->>'total_count')::integer<>0 THEN RAISE EXCEPTION 'Literal query treated as a wildcard'; END IF;
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id,'query','sparkclauseprobe'),1,1);
 IF (r->>'total_count')::integer<>1 OR jsonb_array_length(r->'rows')<>0 THEN RAISE EXCEPTION 'Pagination count mismatch'; END IF;
 r:=public.search_decisions_report(jsonb_build_object('minute_id',m_id,'query','  '),100,0);
 IF (r->>'total_count')::integer<>baseline+1 THEN RAISE EXCEPTION 'Empty search changed report semantics'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN
  PERFORM public.search_decisions_report('{}',25,0);
  RAISE EXCEPTION 'Anonymous report access allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END;
$test$;
ROLLBACK;
