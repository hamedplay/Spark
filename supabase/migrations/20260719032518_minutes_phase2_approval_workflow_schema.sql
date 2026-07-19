-- ============================================================
-- Migration: Minutes Phase 2 — Approval Workflow schema
--
-- Adds approval workflow columns to public.minutes, creates
-- public.minutes_approvals and public.minutes_approval_comments,
-- maps legacy 'rejected' status to 'changes_requested', and
-- enables RLS with SELECT-only policies on the new tables.
--
-- No existing policies/triggers/functions are modified here
-- (corrective RLS UPDATE policy change is in a separate migration).
-- No test data is inserted.
-- ============================================================

-- ----------------------------------------------------------------------------
-- 1. Add approval workflow columns to public.minutes
-- ----------------------------------------------------------------------------
ALTER TABLE public.minutes
  ADD COLUMN IF NOT EXISTS approval_mode text,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS secretary_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS secretary_confirmed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS chair_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS chair_confirmed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by_user_id uuid;

-- Foreign keys to auth.users (SET NULL for confirmation/publish actors,
-- RESTRICT for submitter to preserve audit trail)
ALTER TABLE public.minutes
  ADD CONSTRAINT minutes_submitted_by_user_id_fkey
    FOREIGN KEY (submitted_by_user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD CONSTRAINT minutes_secretary_confirmed_by_user_id_fkey
    FOREIGN KEY (secretary_confirmed_by_user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD CONSTRAINT minutes_chair_confirmed_by_user_id_fkey
    FOREIGN KEY (chair_confirmed_by_user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD CONSTRAINT minutes_published_by_user_id_fkey
    FOREIGN KEY (published_by_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. Map legacy 'rejected' status → 'changes_requested' (non-destructive)
--    Then replace the status CHECK constraint to the new enum.
-- ----------------------------------------------------------------------------
UPDATE public.minutes
  SET status = 'changes_requested'
  WHERE status = 'rejected';

ALTER TABLE public.minutes
  DROP CONSTRAINT IF EXISTS minutes_status_check;

ALTER TABLE public.minutes
  ADD CONSTRAINT minutes_status_check
    CHECK (status IN ('draft', 'pending_approval', 'changes_requested', 'approved', 'published'));

-- Approval mode + revision constraints
ALTER TABLE public.minutes
  ADD CONSTRAINT minutes_approval_mode_check
    CHECK (approval_mode IS NULL OR approval_mode IN ('system', 'in_person')),
  ADD CONSTRAINT minutes_revision_number_check
    CHECK (revision_number >= 1),
  ADD CONSTRAINT minutes_published_consistency_check
    CHECK (
      status <> 'published'
      OR (chair_confirmed_at IS NOT NULL AND secretary_confirmed_at IS NOT NULL)
    );

-- Indexes for approval workflow queries
CREATE INDEX IF NOT EXISTS minutes_approval_mode_idx        ON public.minutes (approval_mode);
CREATE INDEX IF NOT EXISTS minutes_submitted_by_user_id_idx ON public.minutes (submitted_by_user_id);
CREATE INDEX IF NOT EXISTS minutes_status_revision_idx      ON public.minutes (status, revision_number);

-- ----------------------------------------------------------------------------
-- 3. Table: public.minutes_approvals
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes_approvals (
  id                     uuid          NOT NULL DEFAULT gen_random_uuid(),
  minute_id              uuid          NOT NULL,
  revision_number        integer       NOT NULL,
  approver_user_id       uuid          NOT NULL,
  status                 text          NOT NULL DEFAULT 'pending',
  approved_at            timestamptz,
  changes_requested_at   timestamptz,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT minutes_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT minutes_approvals_minute_revision_approver_unique
    UNIQUE (minute_id, revision_number, approver_user_id),
  CONSTRAINT minutes_approvals_minute_id_fkey
    FOREIGN KEY (minute_id) REFERENCES public.minutes (id) ON DELETE CASCADE,
  CONSTRAINT minutes_approvals_approver_user_id_fkey
    FOREIGN KEY (approver_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT minutes_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'changes_requested', 'invalidated')),
  CONSTRAINT minutes_approvals_revision_number_check
    CHECK (revision_number >= 1)
);

CREATE INDEX minutes_approvals_approver_status_idx
  ON public.minutes_approvals (approver_user_id, status);
CREATE INDEX minutes_approvals_minute_revision_idx
  ON public.minutes_approvals (minute_id, revision_number);
CREATE INDEX minutes_approvals_minute_status_idx
  ON public.minutes_approvals (minute_id, status);

-- ----------------------------------------------------------------------------
-- 4. Table: public.minutes_approval_comments
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes_approval_comments (
  id                     uuid          NOT NULL DEFAULT gen_random_uuid(),
  approval_id            uuid          NOT NULL,
  minute_id              uuid          NOT NULL,
  revision_number        integer       NOT NULL,
  agenda_result_id       uuid,
  reason                 text          NOT NULL,
  suggested_correction   text,
  created_by_user_id     uuid          NOT NULL,
  created_at             timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT minutes_approval_comments_pkey PRIMARY KEY (id),
  CONSTRAINT minutes_approval_comments_approval_id_fkey
    FOREIGN KEY (approval_id) REFERENCES public.minutes_approvals (id) ON DELETE CASCADE,
  CONSTRAINT minutes_approval_comments_minute_id_fkey
    FOREIGN KEY (minute_id) REFERENCES public.minutes (id) ON DELETE CASCADE,
  CONSTRAINT minutes_approval_comments_agenda_result_id_fkey
    FOREIGN KEY (agenda_result_id) REFERENCES public.minutes_agenda_results (id) ON DELETE SET NULL,
  CONSTRAINT minutes_approval_comments_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT minutes_approval_comments_reason_check
    CHECK (btrim(reason) <> ''),
  CONSTRAINT minutes_approval_comments_revision_number_check
    CHECK (revision_number >= 1),
  -- General objection (agenda_result_id NULL) requires a non-empty suggested_correction
  CONSTRAINT minutes_approval_comments_general_objection_check
    CHECK (
      agenda_result_id IS NOT NULL
      OR (suggested_correction IS NOT NULL AND btrim(suggested_correction) <> '')
    )
);

CREATE INDEX minutes_approval_comments_approval_id_idx
  ON public.minutes_approval_comments (approval_id);
CREATE INDEX minutes_approval_comments_minute_revision_idx
  ON public.minutes_approval_comments (minute_id, revision_number);

-- ----------------------------------------------------------------------------
-- 5. Enable RLS on new tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.minutes_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_approval_comments ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 6. RLS policies: minutes_approvals (SELECT only — writes via RPCs)
-- ----------------------------------------------------------------------------
CREATE POLICY minutes_approvals_select
  ON public.minutes_approvals
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR approver_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_approvals.minute_id
        AND (
          m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
    -- Fellow approvers of the same minute can see all approval statuses
    OR EXISTS (
      SELECT 1 FROM public.minutes_approvals ma2
      WHERE ma2.minute_id = public.minutes_approvals.minute_id
        AND ma2.approver_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 7. RLS policies: minutes_approval_comments (SELECT only — writes via RPCs)
-- ----------------------------------------------------------------------------
CREATE POLICY minutes_approval_comments_select
  ON public.minutes_approval_comments
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR created_by_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_approval_comments.minute_id
        AND (
          m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.minutes_approvals ma
      WHERE ma.minute_id = public.minutes_approval_comments.minute_id
        AND ma.approver_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 8. updated_at trigger for minutes_approvals
--    (reuse existing minutes_set_updated_at() trigger function)
-- ----------------------------------------------------------------------------
CREATE TRIGGER minutes_approvals_set_updated_at
  BEFORE UPDATE ON public.minutes_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.minutes_set_updated_at();
