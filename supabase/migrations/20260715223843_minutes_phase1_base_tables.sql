-- ============================================================================
-- Migration: minutes_phase1_base_tables
-- Description: Creates four base tables for meeting minutes (phase 1)
--              Enables RLS on all four tables (no policies — locked until next migration)
-- Scope: CREATE TABLE + FK + CHECK + UNIQUE + INDEX + ENABLE RLS
-- No policies, no triggers, no functions, no buckets
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table 1: public.minutes
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes (
    id                          uuid          NOT NULL DEFAULT gen_random_uuid(),
    meeting_id                  uuid          NOT NULL,
    meeting_title_snapshot      text          NOT NULL,
    meeting_date_snapshot       text          NOT NULL,
    meeting_start_time_snapshot text,
    meeting_end_time_snapshot   text,
    meeting_location_snapshot   text,
    meeting_type                text,
    org_unit_id                 uuid,
    org_unit_name_snapshot      text,
    secretary_user_id           uuid,
    secretary_name_snapshot     text          NOT NULL,
    chair_user_id               uuid,
    chair_name_snapshot         text          NOT NULL,
    notes                       text,
    confidentiality             text          NOT NULL DEFAULT 'organizational',
    status                      text          NOT NULL DEFAULT 'draft',
    created_by_user_id          uuid          NOT NULL,
    created_at                  timestamptz   NOT NULL DEFAULT now(),
    updated_at                  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT minutes_pkey PRIMARY KEY (id),
    CONSTRAINT minutes_meeting_id_key UNIQUE (meeting_id),
    CONSTRAINT minutes_meeting_id_fkey
        FOREIGN KEY (meeting_id) REFERENCES public.meetings (id) ON DELETE RESTRICT,
    CONSTRAINT minutes_org_unit_id_fkey
        FOREIGN KEY (org_unit_id) REFERENCES public.org_units (id) ON DELETE SET NULL,
    CONSTRAINT minutes_secretary_user_id_fkey
        FOREIGN KEY (secretary_user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT minutes_chair_user_id_fkey
        FOREIGN KEY (chair_user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT minutes_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
    CONSTRAINT minutes_confidentiality_check
        CHECK (confidentiality IN ('public', 'organizational', 'restricted', 'confidential')),
    CONSTRAINT minutes_status_check
        CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'published')),
    CONSTRAINT minutes_meeting_title_snapshot_check
        CHECK (btrim(meeting_title_snapshot) <> ''),
    CONSTRAINT minutes_meeting_date_snapshot_check
        CHECK (btrim(meeting_date_snapshot) <> ''),
    CONSTRAINT minutes_secretary_name_snapshot_check
        CHECK (btrim(secretary_name_snapshot) <> ''),
    CONSTRAINT minutes_chair_name_snapshot_check
        CHECK (btrim(chair_name_snapshot) <> '')
);

COMMENT ON COLUMN public.minutes.meeting_date_snapshot IS
    'TEXT snapshot of public.meetings.request_date — source column is text (Jalali date), not date/timestamptz';
COMMENT ON COLUMN public.minutes.meeting_start_time_snapshot IS
    'TEXT snapshot of public.meetings.start_time — source column is text, not timestamptz';
COMMENT ON COLUMN public.minutes.meeting_end_time_snapshot IS
    'TEXT snapshot of public.meetings.end_time — source column is text, not timestamptz';

CREATE INDEX minutes_secretary_user_id_idx     ON public.minutes (secretary_user_id);
CREATE INDEX minutes_chair_user_id_idx         ON public.minutes (chair_user_id);
CREATE INDEX minutes_org_unit_id_idx           ON public.minutes (org_unit_id);
CREATE INDEX minutes_status_idx                ON public.minutes (status);
CREATE INDEX minutes_created_by_user_id_idx    ON public.minutes (created_by_user_id);

-- ----------------------------------------------------------------------------
-- Table 2: public.minutes_participants
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes_participants (
    id                     uuid          NOT NULL DEFAULT gen_random_uuid(),
    minute_id              uuid          NOT NULL,
    user_id                uuid,
    name_snapshot          text          NOT NULL,
    position_snapshot      text,
    org_unit_id            uuid,
    org_unit_name_snapshot text,
    invitation_status      text          NOT NULL DEFAULT 'invited',
    attendance_status      text,
    notes                  text,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT minutes_participants_pkey PRIMARY KEY (id),
    CONSTRAINT minutes_participants_minute_id_fkey
        FOREIGN KEY (minute_id) REFERENCES public.minutes (id) ON DELETE CASCADE,
    CONSTRAINT minutes_participants_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT minutes_participants_org_unit_id_fkey
        FOREIGN KEY (org_unit_id) REFERENCES public.org_units (id) ON DELETE SET NULL,
    CONSTRAINT minutes_participants_invitation_status_check
        CHECK (invitation_status IN ('invited', 'accepted', 'declined', 'no_response', 'delegated')),
    CONSTRAINT minutes_participants_attendance_status_check
        CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'absent', 'online', 'late', 'delegate_attended')),
    CONSTRAINT minutes_participants_name_snapshot_check
        CHECK (btrim(name_snapshot) <> '')
);

CREATE INDEX minutes_participants_minute_id_idx ON public.minutes_participants (minute_id);
CREATE INDEX minutes_participants_user_id_idx   ON public.minutes_participants (user_id);

CREATE UNIQUE INDEX minutes_participants_minute_user_unique
    ON public.minutes_participants (minute_id, user_id)
    WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table 3: public.minutes_external_participants
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes_external_participants (
    id                uuid          NOT NULL DEFAULT gen_random_uuid(),
    minute_id         uuid          NOT NULL,
    full_name         text          NOT NULL,
    organization      text,
    position          text,
    mobile            text,
    email             text,
    invitation_status text          NOT NULL DEFAULT 'invited',
    attendance_status text,
    notes             text,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT minutes_external_participants_pkey PRIMARY KEY (id),
    CONSTRAINT minutes_external_participants_minute_id_fkey
        FOREIGN KEY (minute_id) REFERENCES public.minutes (id) ON DELETE CASCADE,
    CONSTRAINT minutes_external_participants_invitation_status_check
        CHECK (invitation_status IN ('invited', 'accepted', 'declined', 'no_response', 'delegated')),
    CONSTRAINT minutes_external_participants_attendance_status_check
        CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'absent', 'online', 'late', 'delegate_attended')),
    CONSTRAINT minutes_external_participants_full_name_check
        CHECK (btrim(full_name) <> '')
);

CREATE INDEX minutes_external_participants_minute_id_idx
    ON public.minutes_external_participants (minute_id);

-- ----------------------------------------------------------------------------
-- Table 4: public.minutes_agenda_results
-- ----------------------------------------------------------------------------
CREATE TABLE public.minutes_agenda_results (
    id                          uuid          NOT NULL DEFAULT gen_random_uuid(),
    minute_id                   uuid          NOT NULL,
    meeting_agenda_item_id      uuid,
    sort_order_snapshot         integer       NOT NULL DEFAULT 0,
    agenda_title_snapshot       text          NOT NULL,
    agenda_description_snapshot text,
    presenter_snapshot          text,
    allocated_minutes_snapshot  integer,
    discussion_result           text,
    result_type                 text          NOT NULL DEFAULT 'discussion',
    additional_notes            text,
    created_at                  timestamptz   NOT NULL DEFAULT now(),
    updated_at                  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT minutes_agenda_results_pkey PRIMARY KEY (id),
    CONSTRAINT minutes_agenda_results_minute_id_fkey
        FOREIGN KEY (minute_id) REFERENCES public.minutes (id) ON DELETE CASCADE,
    CONSTRAINT minutes_agenda_results_meeting_agenda_item_id_fkey
        FOREIGN KEY (meeting_agenda_item_id) REFERENCES public.meeting_agenda_items (id) ON DELETE SET NULL,
    CONSTRAINT minutes_agenda_results_sort_order_snapshot_check
        CHECK (sort_order_snapshot >= 0),
    CONSTRAINT minutes_agenda_results_allocated_minutes_snapshot_check
        CHECK (allocated_minutes_snapshot IS NULL OR allocated_minutes_snapshot >= 0),
    CONSTRAINT minutes_agenda_results_result_type_check
        CHECK (result_type IN ('discussion', 'action', 'resolution', 'deferred', 'no_result')),
    CONSTRAINT minutes_agenda_results_agenda_title_snapshot_check
        CHECK (btrim(agenda_title_snapshot) <> '')
);

CREATE INDEX minutes_agenda_results_minute_id_idx
    ON public.minutes_agenda_results (minute_id);

CREATE INDEX minutes_agenda_results_meeting_agenda_item_id_idx
    ON public.minutes_agenda_results (meeting_agenda_item_id);

CREATE UNIQUE INDEX minutes_agenda_results_minute_agenda_unique
    ON public.minutes_agenda_results (minute_id, meeting_agenda_item_id)
    WHERE meeting_agenda_item_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Enable RLS on all four tables (no policies — locked until next migration)
-- ----------------------------------------------------------------------------
ALTER TABLE public.minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_external_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_agenda_results ENABLE ROW LEVEL SECURITY;