/*
# Minutes Phase 3 — Attachments & Audit Log base schema

## 1. New Tables

### minutes_attachments
Stores file attachments for a minute. An attachment may belong to:
  - the whole minute (agenda_result_id IS NULL AND decision_id IS NULL)
  - an agenda result row (agenda_result_id NOT NULL)
  - a decision (decision_id NOT NULL)
Fields:
  - id (uuid PK)
  - minute_id (uuid FK -> minutes.id ON DELETE CASCADE)
  - agenda_result_id (uuid nullable FK -> minutes_agenda_results.id ON DELETE SET NULL)
  - decision_id (uuid nullable FK -> minutes_decisions.id ON DELETE SET NULL)
  - storage_path (text not null) — path inside the minutes-attachments bucket
  - original_filename (text not null) — user-facing filename (trimmed, non-empty)
  - stored_filename (text not null) — sanitized server-side filename
  - mime_type (text not null)
  - size_bytes (bigint not null, check > 0)
  - uploaded_by_user_id (uuid not null, default auth.uid())
  - description (text nullable)
  - created_at (timestamptz default now())
  - deleted_at (timestamptz nullable) — soft delete
Constraints:
  - not both agenda_result_id and decision_id (CHECK)
  - agenda_result_id belongs to same minute (CHECK via function)
  - decision_id belongs to same minute (CHECK via function)
  - original_filename trimmed non-empty (CHECK)
  - size_bytes positive (CHECK)

### minutes_audit_log
Append-only audit trail for minutes.
Fields:
  - id (uuid PK)
  - minute_id (uuid FK -> minutes.id ON DELETE CASCADE)
  - actor_user_id (uuid nullable)
  - action (text not null)
  - entity_type (text not null)
  - entity_id (uuid nullable)
  - revision_number (integer nullable)
  - old_values (jsonb nullable)
  - new_values (jsonb nullable)
  - metadata (jsonb nullable)
  - created_at (timestamptz default now())

## 2. Storage
- Create private bucket `minutes-attachments` (public = false).

## 3. Security (RLS)
- minutes_attachments: RLS enabled. SELECT for users allowed to view the parent
  minute (delegated to the same visibility predicate as minutes). All writes
  (INSERT/UPDATE/DELETE) are blocked for anon/authenticated — only the
  SECURITY DEFINER RPCs may write.
- minutes_audit_log: RLS enabled. SELECT for users allowed to view the parent
  minute. INSERT/UPDATE/DELETE all blocked for anon/authenticated — only the
  SECURITY DEFINER audit helper may write.

## 4. RPCs
- create_minutes_attachment_record(p_minute_id, p_agenda_result_id, p_decision_id,
    p_storage_path, p_original_filename, p_stored_filename, p_mime_type,
    p_size_bytes, p_description) — validates authorization + constraints,
  inserts the row, writes audit, returns the new id.
- delete_minutes_attachment(p_attachment_id) — soft-deletes (sets deleted_at),
  validates authorization, writes audit.
- get_minutes_attachment_signed_url(p_attachment_id) — returns a signed URL
  only if the caller may view the parent minute.
- _write_minutes_audit(p_minute_id, p_action, p_entity_type, p_entity_id,
    p_revision_number, p_old_values, p_new_values, p_metadata) — internal
  SECURITY DEFINER helper; EXECUTE revoked from anon/authenticated.

## 5. Indexes
- minutes_attachments(minute_id)
- minutes_attachments(agenda_result_id) WHERE agenda_result_id IS NOT NULL
- minutes_attachments(decision_id) WHERE decision_id IS NOT NULL
- minutes_audit_log(minute_id, created_at DESC)
*/

-- ── Helper: attachment target belongs to same minute ────────────────────────
CREATE OR REPLACE FUNCTION public._minutes_attachment_target_ok(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT
    (p_agenda_result_id IS NULL OR EXISTS (
      SELECT 1 FROM public.minutes_agenda_results ar
      WHERE ar.id = p_agenda_result_id AND ar.minute_id = p_minute_id
    ))
    AND
    (p_decision_id IS NULL OR EXISTS (
      SELECT 1 FROM public.minutes_decisions d
      WHERE d.id = p_decision_id AND d.minute_id = p_minute_id
    ))
    AND NOT (p_agenda_result_id IS NOT NULL AND p_decision_id IS NOT NULL);
$function$;
REVOKE EXECUTE ON FUNCTION public._minutes_attachment_target_ok(uuid, uuid, uuid) FROM anon, authenticated;

-- ── Helper: user may view a minute (mirrors minutes SELECT policy) ────────────
CREATE OR REPLACE FUNCTION public._user_can_view_minute(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.minutes m
    WHERE m.id = p_minute_id AND (
      public.is_current_user_admin()
      OR m.created_by_user_id = auth.uid()
      OR m.secretary_user_id = auth.uid()
      OR m.chair_user_id = auth.uid()
      OR (m.confidentiality IN ('organizational','public') AND EXISTS (
        SELECT 1 FROM public.meetings mt WHERE mt.id = m.meeting_id))
      OR (m.confidentiality = 'restricted' AND public.can_view_restricted_minutes_meeting(m.meeting_id))
    )
  );
$function$;
REVOKE EXECUTE ON FUNCTION public._user_can_view_minute(uuid) FROM anon, authenticated;

-- ── Helper: user may manage a minute's content (upload/delete attachments) ──
CREATE OR REPLACE FUNCTION public._user_can_manage_minute_content(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.minutes m
    WHERE m.id = p_minute_id AND (
      public.is_current_user_admin()
      OR m.created_by_user_id = auth.uid()
      OR m.secretary_user_id = auth.uid()
      OR m.chair_user_id = auth.uid()
    )
  );
$function$;
REVOKE EXECUTE ON FUNCTION public._user_can_manage_minute_content(uuid) FROM anon, authenticated;

-- ── Audit helper (append-only) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._write_minutes_audit(
  p_minute_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_revision_number integer,
  p_old_values jsonb,
  p_new_values jsonb,
  p_metadata jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.minutes_audit_log (
    minute_id, actor_user_id, action, entity_type, entity_id,
    revision_number, old_values, new_values, metadata, created_at
  ) VALUES (
    p_minute_id, auth.uid(), p_action, p_entity_type, p_entity_id,
    p_revision_number, p_old_values, p_new_values, p_metadata, now()
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._write_minutes_audit(uuid,text,text,uuid,integer,jsonb,jsonb,jsonb) FROM anon, authenticated;

-- ── minutes_attachments table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.minutes_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id uuid NOT NULL REFERENCES public.minutes(id) ON DELETE CASCADE,
  agenda_result_id uuid REFERENCES public.minutes_agenda_results(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.minutes_decisions(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT attachments_size_positive CHECK (size_bytes > 0),
  CONSTRAINT attachments_filename_nonempty CHECK (btrim(original_filename) <> ''),
  CONSTRAINT attachments_not_both_targets CHECK (
    (agenda_result_id IS NULL OR decision_id IS NULL)
  ),
  CONSTRAINT attachments_target_ok CHECK (
    public._minutes_attachment_target_ok(minute_id, agenda_result_id, decision_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_minutes_attachments_minute_id
  ON public.minutes_attachments(minute_id);
CREATE INDEX IF NOT EXISTS idx_minutes_attachments_agenda
  ON public.minutes_attachments(agenda_result_id) WHERE agenda_result_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_minutes_attachments_decision
  ON public.minutes_attachments(decision_id) WHERE decision_id IS NOT NULL;

ALTER TABLE public.minutes_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attachments_select_visible" ON public.minutes_attachments;
CREATE POLICY "attachments_select_visible"
  ON public.minutes_attachments FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public._user_can_view_minute(minute_id)
  );

-- No INSERT/UPDATE/DELETE policies: writes only via SECURITY DEFINER RPCs.

-- ── minutes_audit_log table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.minutes_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id uuid NOT NULL REFERENCES public.minutes(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  revision_number integer,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minutes_audit_minute_created
  ON public.minutes_audit_log(minute_id, created_at DESC);

ALTER TABLE public.minutes_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_visible" ON public.minutes_audit_log;
CREATE POLICY "audit_select_visible"
  ON public.minutes_audit_log FOR SELECT
  TO authenticated
  USING (public._user_can_view_minute(minute_id));

-- No INSERT/UPDATE/DELETE policies: append-only via SECURITY DEFINER helper.

-- ── Storage bucket ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('minutes-attachments', 'minutes-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ── create_minutes_attachment_record RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_minutes_attachment_record(
  p_minute_id uuid,
  p_agenda_result_id uuid,
  p_decision_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_stored_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public._user_can_manage_minute_content(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_original_filename) = '' OR p_storage_path IS NULL OR p_stored_filename IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '23514';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 20971520 THEN
    RAISE EXCEPTION 'INVALID_SIZE' USING ERRCODE = '23514';
  END IF;
  IF NOT public._minutes_attachment_target_ok(p_minute_id, p_agenda_result_id, p_decision_id) THEN
    RAISE EXCEPTION 'TARGET_MISMATCH' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO v_status FROM public.minutes WHERE id = p_minute_id;
  IF v_status = 'published' AND NOT public.is_current_user_admin()
    AND NOT EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = p_minute_id
      AND (m.secretary_user_id = auth.uid() OR m.chair_user_id = auth.uid())
    ) THEN
    RAISE EXCEPTION 'PUBLISHED_LOCKED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.minutes_attachments (
    minute_id, agenda_result_id, decision_id, storage_path,
    original_filename, stored_filename, mime_type, size_bytes,
    uploaded_by_user_id, description
  ) VALUES (
    p_minute_id, p_agenda_result_id, p_decision_id, p_storage_path,
    p_original_filename, p_stored_filename, p_mime_type, p_size_bytes,
    auth.uid(), p_description
  ) RETURNING id INTO v_id;

  PERFORM public._write_minutes_audit(
    p_minute_id, 'attachment_uploaded', 'attachment', v_id,
    NULL, NULL,
    jsonb_build_object('filename', p_original_filename, 'size', p_size_bytes, 'mime', p_mime_type),
    NULL
  );

  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_minutes_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_minutes_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text) TO authenticated;

-- ── delete_minutes_attachment RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_minutes_attachment(
  p_attachment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_minute_id uuid;
  v_filename text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT minute_id, original_filename INTO v_minute_id, v_filename
  FROM public.minutes_attachments
  WHERE id = p_attachment_id AND deleted_at IS NULL;
  IF v_minute_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._user_can_manage_minute_content(v_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.minutes_attachments
  SET deleted_at = now()
  WHERE id = p_attachment_id;

  PERFORM public._write_minutes_audit(
    v_minute_id, 'attachment_deleted', 'attachment', p_attachment_id,
    NULL, jsonb_build_object('filename', v_filename), NULL, NULL
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_minutes_attachment(uuid) TO authenticated;

-- ── get_minutes_attachment_signed_url RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_minutes_attachment_signed_url(
  p_attachment_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_storage_path text;
  v_minute_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT storage_path, minute_id INTO v_storage_path, v_minute_id
  FROM public.minutes_attachments
  WHERE id = p_attachment_id AND deleted_at IS NULL;
  IF v_storage_path IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._user_can_view_minute(v_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN v_storage_path;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_minutes_attachment_signed_url(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_attachment_signed_url(uuid) TO authenticated;
