import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, ChevronLeft, FileText, Users, SquareCheck as CheckSquare, Paperclip, Shield, Signature as FileSignature, Save, Eye, Send, X, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinuteIdInUrl, setMinutesPageInUrl, getMeetingIdFromUrl } from '../../lib/minutesNavigation';
import { loadMinutesPrefill } from '../../lib/minutesPrefill';
import { checkSystemApproverEligibility } from '../../lib/minutesApprovalEligibility';
import { PageHeader, TableSkeleton } from './MinutesShared';
import type {
  ConfidentialityLevel, InvitationStatus, AttendanceStatus,
  AgendaResultType, DecisionPriority,
  MinutesStatus, ApprovalMode,
} from './types';
import type {
  ProfileOption, OrgUnitOption,
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, DraftDecision, DraftFinalization,
  MinutesDraftPayload,
} from './Form/types';
import {
  uid, defaultInfo, defaultInternalParticipant, defaultExternalParticipant,
  defaultAgendaItem, defaultDecision, defaultFinalization,
} from './Form/defaults';
import { SectionInfo } from './Form/SectionInfo';
import { SectionParticipants } from './Form/SectionParticipants';
import { SectionAgenda } from './Form/SectionAgenda';
import { SectionDecisions } from './Form/SectionDecisions';
import { SectionAttachments } from './Form/SectionAttachments';
import { SectionApprovers } from './Form/SectionApprovers';
import { SectionFinal } from './Form/SectionFinal';
import { DebugPayloadPanel } from './Form/DebugPayloadPanel';

interface Props {
  mode: 'new' | 'edit';
  onNavigate: (page: string) => void;
  minuteId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section definitions
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'info',         label: 'اطلاعات جلسه',           icon: FileText },
  { id: 'participants', label: 'شرکت‌کنندگان',             icon: Users },
  { id: 'agenda',       label: 'دستور جلسات',              icon: CheckSquare },
  { id: 'decisions',    label: 'مصوبات',                   icon: CheckSquare },
  { id: 'attachments',  label: 'پیوست‌ها',                 icon: Paperclip },
  { id: 'approvers',    label: 'تأییدکنندگان',             icon: Shield },
  { id: 'final',        label: 'نسخه نهایی',               icon: FileSignature },
];

const isDev = import.meta.env.DEV;

// ─────────────────────────────────────────────────────────────────────────────
// RPC error-code → Persian message mapping
// ─────────────────────────────────────────────────────────────────────────────

const RPC_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'احراز هویت نشده‌اید. لطفاً دوباره وارد شوید.',
  PAYLOAD_INVALID: 'اطلاعات ارسالی نامعتبر است.',
  MEETING_ID_REQUIRED: 'انتخاب جلسه الزامی است.',
  TITLE_REQUIRED: 'عنوان جلسه الزامی است.',
  DATE_REQUIRED: 'تاریخ جلسه الزامی است.',
  SECRETARY_NAME_REQUIRED: 'نام دبیر جلسه الزامی است.',
  CHAIR_NAME_REQUIRED: 'نام رئیس جلسه الزامی است.',
  INVALID_CONFIDENTIALITY: 'سطح محرمانگی نامعتبر است.',
  MEETING_NO_PERMISSION: 'شما اجازه ایجاد صورت‌جلسه برای این جلسه را ندارید.',
  MINUTES_ALREADY_EXISTS: 'برای این جلسه قبلاً صورت‌جلسه ثبت شده است.',
  SECRETARY_USER_NOT_FOUND: 'کاربر دبیر جلسه یافت نشد.',
  CHAIR_USER_NOT_FOUND: 'کاربر رئیس جلسه یافت نشد.',
  ORG_UNIT_NOT_FOUND: 'واحد سازمانی یافت نشد.',
  PARTICIPANT_NAME_REQUIRED: 'نام شرکت‌کننده الزامی است.',
  PARTICIPANT_USER_NOT_FOUND: 'کاربر شرکت‌کننده یافت نشد.',
  INVALID_INVITATION_STATUS: 'وضعیت دعوت نامعتبر است.',
  INVALID_ATTENDANCE_STATUS: 'وضعیت حضور نامعتبر است.',
  EXTERNAL_NAME_REQUIRED: 'نام شرکت‌کننده خارجی الزامی است.',
  AGENDA_TITLE_REQUIRED: 'عنوان دستور جلسه الزامی است.',
  AGENDA_SORT_ORDER_INVALID: 'ترتیب دستور جلسه نامعتبر است.',
  AGENDA_ALLOCATED_TIME_INVALID: 'زمان اختصاص‌یافته دستور جلسه نامعتبر است.',
  INVALID_RESULT_TYPE: 'نوع نتیجه دستور جلسه نامعتبر است.',
  AGENDA_ITEM_MISMATCH: 'مغایرت در دستور جلسات.',
  DUPLICATE_INTERNAL_PARTICIPANT: 'شرکت‌کننده داخلی تکراری است.',
  DUPLICATE_AGENDA_ITEM: 'دستور جلسه تکراری است.',
  INTERNAL_ERROR: 'خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function MinutesFormPage({ mode, onNavigate, minuteId }: Props) {
  const [activeSection, setActiveSection] = useState(0);

  const [info, setInfo] = useState<DraftMeetingInfo>(defaultInfo);
  const [internalParticipants, setInternalParticipants] = useState<DraftInternalParticipant[]>([defaultInternalParticipant()]);
  const [externalParticipants, setExternalParticipants] = useState<DraftExternalParticipant[]>([defaultExternalParticipant()]);
  const [agendaItems, setAgendaItems] = useState<DraftAgendaItem[]>([defaultAgendaItem(1)]);
  const [decisions, setDecisions] = useState<DraftDecision[]>([defaultDecision()]);
  const [finalization, setFinalization] = useState<DraftFinalization>(defaultFinalization);

  // Fetched reference data
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [orgUnitsError, setOrgUnitsError] = useState<string | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // New-mode prefill state — runs once, never overwrites user edits
  const [prefillLoading, setPrefillLoading] = useState(mode === 'new');
  const [prefillError, setPrefillError] = useState<string | null>(null);

  // Edit-mode state
  const [editMinuteId, setEditMinuteId] = useState<string | null>(null);
  const [workingMinuteId, setWorkingMinuteId] = useState<string | null>(null);
  const [editUpdatedAt, setEditUpdatedAt] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(mode === 'edit');
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotFound, setEditNotFound] = useState(false);

  const title = mode === 'new' ? 'ایجاد صورت‌جلسه' : 'ویرایش صورت‌جلسه';

  // ── Edit mode: fetch existing minute and populate form ───────────────
  useEffect(() => {
    if (mode !== 'edit') return;
    const targetId = minuteId || getMinuteIdFromUrl();
    if (!targetId) {
      setEditNotFound(true);
      setEditLoading(false);
      return;
    }
    (async () => {
      setEditLoading(true);
      setEditError(null);
      setEditNotFound(false);
      try {
        const { data: minData, error: minErr } = await supabase
          .from('minutes')
          .select('id, meeting_id, meeting_title_snapshot, meeting_date_snapshot, meeting_start_time_snapshot, meeting_end_time_snapshot, meeting_location_snapshot, meeting_type, org_unit_id, org_unit_name_snapshot, secretary_user_id, secretary_name_snapshot, chair_user_id, chair_name_snapshot, notes, confidentiality, status, updated_at, approval_mode, revision_number, submitted_at')
          .eq('id', targetId)
          .maybeSingle();
        if (minErr) throw minErr;
        if (!minData) { setEditNotFound(true); setEditLoading(false); return; }
        const m = minData as Record<string, unknown>;
        setEditMinuteId(m.id as string);
        setEditUpdatedAt(m.updated_at as string);
        setInfo({
          meetingId: m.meeting_id as string,
          meetingTitle: (m.meeting_title_snapshot as string) || '',
          meetingDate: (m.meeting_date_snapshot as string) || '',
          meetingType: (m.meeting_type as string) || '',
          startTime: (m.meeting_start_time_snapshot as string) || '',
          endTime: (m.meeting_end_time_snapshot as string) || '',
          location: (m.meeting_location_snapshot as string) || '',
          orgUnitId: (m.org_unit_id as string) || '',
          orgUnitNameSnapshot: (m.org_unit_name_snapshot as string) || '',
          secretaryUserId: (m.secretary_user_id as string) || '',
          secretaryNameSnapshot: (m.secretary_name_snapshot as string) || '',
          chairUserId: (m.chair_user_id as string) || '',
          chairNameSnapshot: (m.chair_name_snapshot as string) || '',
          notes: (m.notes as string) || '',
          confidentiality: (m.confidentiality as ConfidentialityLevel) || 'organizational',
          status: (m.status as MinutesStatus) || 'draft',
          approvalMode: (m.approval_mode as ApprovalMode) || '',
          revisionNumber: (m.revision_number as number) || 1,
          submittedAt: (m.submitted_at as string) || null,
        });

        const [ipRes, epRes, agRes, decRes] = await Promise.all([
          supabase.from('minutes_participants').select('id, user_id, name_snapshot, position_snapshot, org_unit_id, org_unit_name_snapshot, invitation_status, attendance_status, notes').eq('minute_id', targetId).order('created_at', { ascending: true }),
          supabase.from('minutes_external_participants').select('id, full_name, organization, position, mobile, email, attendance_status, notes').eq('minute_id', targetId).order('created_at', { ascending: true }),
          supabase.from('minutes_agenda_results').select('id, meeting_agenda_item_id, sort_order_snapshot, agenda_title_snapshot, agenda_description_snapshot, presenter_snapshot, allocated_minutes_snapshot, discussion_result, result_type, additional_notes').eq('minute_id', targetId).order('sort_order_snapshot', { ascending: true }),
          supabase.from('minutes_decisions').select('id, agenda_result_id, title, description, primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot, priority, start_date, due_date, requires_followup, latest_update, discussion_result, result_type, additional_notes').eq('minute_id', targetId).order('created_at', { ascending: true }),
        ]);
        if (ipRes.data) {
          const rows = ipRes.data as unknown as Record<string, unknown>[];
          setInternalParticipants(rows.length > 0 ? rows.map(r => ({
            id: uid(),
            userId: (r.user_id as string) || '',
            nameSnapshot: (r.name_snapshot as string) || '',
            positionSnapshot: (r.position_snapshot as string) || '',
            orgUnitId: (r.org_unit_id as string) || '',
            orgUnitNameSnapshot: (r.org_unit_name_snapshot as string) || '',
            invitationStatus: (r.invitation_status as InvitationStatus) || 'invited',
            attendanceStatus: (r.attendance_status as AttendanceStatus | null) ?? null,
            delegate: '',
            notes: (r.notes as string) || '',
          })) : [defaultInternalParticipant()]);
        }
        if (epRes.data) {
          const rows = epRes.data as unknown as Record<string, unknown>[];
          setExternalParticipants(rows.length > 0 ? rows.map(r => ({
            id: uid(),
            fullName: (r.full_name as string) || '',
            organization: (r.organization as string) || '',
            position: (r.position as string) || '',
            mobile: (r.mobile as string) || '',
            email: (r.email as string) || '',
            attendanceStatus: (r.attendance_status as AttendanceStatus | null) ?? null,
          })) : [defaultExternalParticipant()]);
        }
        if (agRes.data) {
          const rows = agRes.data as unknown as Record<string, unknown>[];
          setAgendaItems(rows.length > 0 ? rows.map((r, idx) => ({
            id: uid(),
            meetingAgendaItemId: (r.meeting_agenda_item_id as string) || '',
            order: idx + 1,
            title: (r.agenda_title_snapshot as string) || '',
            description: (r.agenda_description_snapshot as string) || '',
            presenter: (r.presenter_snapshot as string) || '',
            allocatedTime: r.allocated_minutes_snapshot != null ? String(r.allocated_minutes_snapshot) : '',
            discussionResult: (r.discussion_result as string) || '',
            resultType: (r.result_type as AgendaResultType) || 'discussion',
            additionalNotes: (r.additional_notes as string) || '',
          })) : [defaultAgendaItem(1)]);
        }
        if (decRes.data) {
          const rows = decRes.data as unknown as Record<string, unknown>[];
          setDecisions(rows.length > 0 ? rows.map((r) => ({
            id: uid(),
            decisionId: (r.id as string) || null,
            agendaResultId: (r.agenda_result_id as string) || null,
            title: (r.title as string) || '',
            description: (r.description as string) || '',
            primaryOwnerUserId: (r.primary_owner_user_id as string) || '',
            responsibleUnitId: (r.responsible_unit_id as string) || null,
            responsibleUnitNameSnapshot: (r.responsible_unit_name_snapshot as string) || '',
            priority: (r.priority as DecisionPriority) || 'normal',
            startDate: (r.start_date as string) || '',
            dueDate: (r.due_date as string) || '',
            requiresFollowup: (r.requires_followup as boolean) ?? true,
            latestUpdate: (r.latest_update as string) || '',
            discussionResult: (r.discussion_result as string) || '',
            resultType: (r.result_type as AgendaResultType) || 'discussion',
            additionalNotes: (r.additional_notes as string) || '',
          })) : [defaultDecision()]);
        }
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'خطا در بارگذاری صورت‌جلسه');
      } finally {
        setEditLoading(false);
      }
    })();
  }, [mode, minuteId]);

  // ── New mode: centralized prefill from meeting (runs once) ──────────
  // Reads meetingId only from the `meeting` URL param. Access is checked via
  // can_create_minutes_for_meeting RPC inside loadMinutesPrefill. Never
  // overwrites user edits — runs exactly once on mount.
  useEffect(() => {
    if (mode !== 'new') return;
    const meetingId = getMeetingIdFromUrl();
    if (!meetingId) {
      setPrefillLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setPrefillLoading(true);
      setPrefillError(null);
      try {
        const result = await loadMinutesPrefill(supabase, meetingId);
        if (cancelled) return;
        if (!result.allowed || !result.data) {
          setPrefillError('دسترسی به این جلسه برای ثبت صورت‌جلسه وجود ندارد.');
          setPrefillLoading(false);
          return;
        }
        const { info: prefillInfo, internalParticipants, externalParticipants, agendaItems, profiles: loadedProfiles, orgUnits: loadedOrgUnits } = result.data;
        setInfo(prev => ({ ...prev, ...prefillInfo }));
        setInternalParticipants(internalParticipants);
        setExternalParticipants(externalParticipants);
        setAgendaItems(agendaItems);
        setAgendaLoading(false);
        // Merge meeting-loaded profiles/orgUnits into the reference lists so
        // secretary/chair selectors include meeting participants even if the
        // global profile list hasn't loaded yet.
        if (loadedProfiles.length > 0) {
          setProfiles(prev => {
            const byId = new Map(prev.map(p => [p.user_id, p]));
            for (const p of loadedProfiles) if (!byId.has(p.user_id)) byId.set(p.user_id, p);
            return Array.from(byId.values());
          });
        }
        if (loadedOrgUnits.length > 0) {
          setOrgUnits(prev => {
            const byId = new Map(prev.map(u => [u.id, u]));
            for (const u of loadedOrgUnits) if (!byId.has(u.id)) byId.set(u.id, u);
            return Array.from(byId.values());
          });
        }
      } catch (err) {
        if (!cancelled) setPrefillError(err instanceof Error ? err.message : 'خطا در بارگذاری اطلاعات جلسه');
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch all profiles ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setProfilesLoading(true);
      setProfilesError(null);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, position, primary_unit_id')
          .neq('is_active', false)
          .order('full_name');
        if (error) throw error;
        setProfiles((data || []) as unknown as ProfileOption[]);
      } catch (err) {
        setProfilesError(err instanceof Error ? err.message : 'خطا در بارگذاری کاربران');
      } finally {
        setProfilesLoading(false);
      }
    })();
  }, []);

  // ── Fetch org units ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setOrgUnitsLoading(true);
      setOrgUnitsError(null);
      try {
        const { data, error } = await supabase
          .from('org_units')
          .select('id, name')
          .order('name');
        if (error) throw error;
        setOrgUnits((data || []) as unknown as OrgUnitOption[]);
      } catch (err) {
        setOrgUnitsError(err instanceof Error ? err.message : 'خطا در بارگذاری واحدها');
      } finally {
        setOrgUnitsLoading(false);
      }
    })();
  }, []);

  const payload: MinutesDraftPayload = useMemo(
    () => ({
      info,
      internalParticipants,
      externalParticipants,
      agendaItems,
      decisions,
      finalization,
    }),
    [info, internalParticipants, externalParticipants, agendaItems, decisions, finalization],
  );

  const validate = (): string | null => {
    if (!info.meetingId) return 'انتخاب جلسه الزامی است';
    if (!info.meetingTitle.trim()) return 'عنوان جلسه الزامی است';
    if (!info.meetingDate.trim()) return 'تاریخ جلسه الزامی است';
    if (!info.secretaryUserId) return 'انتخاب دبیر جلسه الزامی است';
    if (!info.chairUserId) return 'انتخاب رئیس جلسه الزامی است';
    for (const d of decisions) {
      if (!d.title.trim()) return 'عنوان هر مصوبه الزامی است';
      if (!d.primaryOwnerUserId) return 'انتخاب مسئول اصلی برای هر مصوبه الزامی است';
      if (d.startDate && d.dueDate && d.dueDate < d.startDate) return 'مهلت مصوبه نمی‌تواند قبل از تاریخ شروع باشد';
    }
    return null;
  };

  const handleSaveDraft = async () => {
    if (savingDraft) return; // prevent double submit

    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }

    setSavingDraft(true);

    const payload = {
      meeting_title_snapshot: info.meetingTitle,
      meeting_date_snapshot: info.meetingDate,
      meeting_start_time_snapshot: info.startTime || null,
      meeting_end_time_snapshot: info.endTime || null,
      meeting_location_snapshot: info.location || null,
      meeting_type: info.meetingType || null,
      org_unit_id: info.orgUnitId || null,
      org_unit_name_snapshot: info.orgUnitNameSnapshot || null,
      secretary_user_id: info.secretaryUserId || null,
      secretary_name_snapshot: info.secretaryNameSnapshot,
      chair_user_id: info.chairUserId || null,
      chair_name_snapshot: info.chairNameSnapshot,
      notes: info.notes || null,
      confidentiality: info.confidentiality,

      internal_participants: internalParticipants
        .filter((p) => p.nameSnapshot.trim())
        .map((p) => ({
          user_id: p.userId || null,
          name_snapshot: p.nameSnapshot,
          position_snapshot: p.positionSnapshot || null,
          org_unit_id: p.orgUnitId || null,
          org_unit_name_snapshot: p.orgUnitNameSnapshot || null,
          invitation_status: p.invitationStatus,
          attendance_status: p.attendanceStatus || null,
          notes: p.notes || null,
        })),

      external_participants: externalParticipants
        .filter((p) => p.fullName.trim())
        .map((p) => ({
          full_name: p.fullName,
          organization: p.organization || null,
          position: p.position || null,
          mobile: p.mobile || null,
          email: p.email || null,
          attendance_status: p.attendanceStatus || null,
          notes: null,
        })),

      agenda_results: agendaItems
        .filter((a) => a.title.trim())
        .map((a) => ({
          meeting_agenda_item_id: a.meetingAgendaItemId || null,
          sort_order_snapshot: a.order,
          agenda_title_snapshot: a.title,
          agenda_description_snapshot: a.description || null,
          presenter_snapshot: a.presenter || null,
          allocated_minutes_snapshot:
            a.allocatedTime && a.allocatedTime.trim()
              ? Number.parseInt(a.allocatedTime, 10)
              : null,
          discussion_result: null,
          result_type: null,
          additional_notes: null,
        })),

      decisions: decisions.map((d) => ({
        id: d.decisionId || null,
        agenda_result_id: d.agendaResultId || null,
        title: d.title.trim(),
        description: d.description || null,
        primary_owner_user_id: d.primaryOwnerUserId,
        responsible_unit_id: d.responsibleUnitId || null,
        responsible_unit_name_snapshot: d.responsibleUnitNameSnapshot || null,
        priority: d.priority,
        start_date: d.startDate || null,
        due_date: d.dueDate || null,
        requires_followup: d.requiresFollowup,
        latest_update: d.latestUpdate || null,
        discussion_result: d.discussionResult || null,
        result_type: d.resultType || null,
        additional_notes: d.additionalNotes || null,
      })),
    };

    if (isDev) {
      console.log('[MinutesDraftRPCPayload]', payload);
    }

    try {
      if (mode === 'new') {
        const createPayload = { meeting_id: info.meetingId, ...payload };
        const { data, error: rpcError } = await supabase.rpc('create_minutes_draft', {
          p_payload: createPayload,
        });
        if (rpcError) {
          if (isDev) console.error('[MinutesDraftRPC] Supabase error:', rpcError);
          toast.error('ذخیره پیش‌نویس ناموفق بود. لطفاً دوباره تلاش کنید.');
          return;
        }
        if (data && data.success === false) {
          const code: string = data.code || data.error_code || 'INTERNAL_ERROR';
          const msg = RPC_ERROR_MESSAGES[code] || 'ذخیره پیش‌نویس ناموفق بود.';
          if (isDev) console.error('[MinutesDraftRPC] Business error:', code, data.message);
          toast.error(msg);
          return;
        }
        if (data && data.success === true) {
          const newId = data.minute_id;
          if (isDev) console.log('[MinutesDraftRPC] Created minute_id:', newId);
          // Sync decisions via dedicated RPC
          const decisionsPayload = decisions.map((d) => ({
            id: d.decisionId || null,
            agenda_result_id: d.agendaResultId || null,
            title: d.title.trim(),
            description: d.description || null,
            primary_owner_user_id: d.primaryOwnerUserId,
            responsible_unit_id: d.responsibleUnitId || null,
            responsible_unit_name_snapshot: d.responsibleUnitNameSnapshot || null,
            priority: d.priority,
            start_date: d.startDate || null,
            due_date: d.dueDate || null,
            requires_followup: d.requiresFollowup,
            latest_update: d.latestUpdate || null,
            discussion_result: d.discussionResult || null,
            result_type: d.resultType || null,
            additional_notes: d.additionalNotes || null,
          }));
          const { error: syncErr } = await supabase.rpc('_sync_minutes_decisions', {
            p_minute_id: newId,
            p_decisions: decisionsPayload,
          });
          if (syncErr && isDev) console.error('[DecisionsSync] error:', syncErr);
          toast.success('پیش‌نویس صورت‌جلسه با موفقیت ذخیره شد.');
          setWorkingMinuteId(newId);
          setMinuteIdInUrl(newId);
          setMinutesPageInUrl('minutes-detail');
          onNavigate('minutes-detail');
          return;
        }
        if (isDev) console.error('[MinutesDraftRPC] Unexpected response:', data);
        toast.error('پاسخ نامعتبر از سرور دریافت شد.');
      } else {
        // edit mode
        if (!editMinuteId || !editUpdatedAt) {
          toast.error('صورت‌جلسه بارگذاری نشده است.');
          return;
        }
        const { data, error: rpcError } = await supabase.rpc('update_minutes_draft', {
          p_minute_id: editMinuteId,
          p_expected_updated_at: editUpdatedAt,
          p_payload: payload,
        });
        if (rpcError) {
          if (isDev) console.error('[MinutesUpdateRPC] Supabase error:', rpcError);
          toast.error('به‌روزرسانی پیش‌نویس ناموفق بود. لطفاً دوباره تلاش کنید.');
          return;
        }
        if (data && data.success === false) {
          const code: string = data.code || data.error_code || 'INTERNAL_ERROR';
          if (code === 'MINUTES_VERSION_CONFLICT') {
            toast.error('این صورت‌جلسه توسط کاربر دیگری تغییر کرده است. اطلاعات را دوباره بارگذاری کنید.');
          } else if (code === 'MINUTES_NO_PERMISSION') {
            toast.error('شما اجازه ویرایش این صورت‌جلسه را ندارید.');
          } else if (code === 'MINUTE_NOT_FOUND') {
            toast.error('صورت‌جلسه یافت نشد.');
          } else {
            const msg = RPC_ERROR_MESSAGES[code] || 'به‌روزرسانی پیش‌نویس ناموفق بود.';
            toast.error(msg);
          }
          return;
        }
        if (data && data.success === true) {
          if (isDev) console.log('[MinutesUpdateRPC] Updated:', data.minute_id, data.updated_at);
          // Sync decisions via dedicated RPC
          const decisionsPayload = decisions.map((d) => ({
            id: d.decisionId || null,
            agenda_result_id: d.agendaResultId || null,
            title: d.title.trim(),
            description: d.description || null,
            primary_owner_user_id: d.primaryOwnerUserId,
            responsible_unit_id: d.responsibleUnitId || null,
            responsible_unit_name_snapshot: d.responsibleUnitNameSnapshot || null,
            priority: d.priority,
            start_date: d.startDate || null,
            due_date: d.dueDate || null,
            requires_followup: d.requiresFollowup,
            latest_update: d.latestUpdate || null,
            discussion_result: d.discussionResult || null,
            result_type: d.resultType || null,
            additional_notes: d.additionalNotes || null,
          }));
          const { error: syncErr } = await supabase.rpc('_sync_minutes_decisions', {
            p_minute_id: editMinuteId,
            p_decisions: decisionsPayload,
          });
          if (syncErr && isDev) console.error('[DecisionsSync] error:', syncErr);
          toast.success('پیش‌نویس صورت‌جلسه با موفقیت به‌روزرسانی شد.');
          setWorkingMinuteId(data.minute_id);
          setMinuteIdInUrl(data.minute_id);
          setMinutesPageInUrl('minutes-detail');
          onNavigate('minutes-detail');
          return;
        }
        if (isDev) console.error('[MinutesUpdateRPC] Unexpected response:', data);
        toast.error('پاسخ نامعتبر از سرور دریافت شد.');
      }
    } catch (err) {
      if (isDev) console.error('[MinutesDraftRPC] Exception:', err);
      toast.error('خطای غیرمنتظره رخ داد. فرم حفظ شد؛ لطفاً دوباره تلاش کنید.');
    } finally {
      setSavingDraft(false);
    }
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmitForApproval = async () => {
    if (submitting) return;
    if (!info.approvalMode) {
      toast.error('لطفاً مدل تأیید را انتخاب کنید.');
      return;
    }
    if (!info.meetingId) {
      toast.error('لطفاً ابتدا جلسه را انتخاب و پیش‌نویس را ذخیره کنید.');
      return;
    }
    // For system mode, verify at least one internal participant with a valid user_id exists
    if (info.approvalMode === 'system') {
      const check = checkSystemApproverEligibility(info.approvalMode, internalParticipants);
      if (!check.canSubmit) {
        toast.error(check.errorMessage || 'در مدل سیستمی حداقل یک شرکت‌کننده داخلی با حساب کاربری لازم است.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_minutes_for_approval', {
        p_minute_id: mode === 'edit' ? (editMinuteId || info.meetingId) : info.meetingId,
        p_expected_updated_at: editUpdatedAt,
        p_approval_mode: info.approvalMode,
      });
      if (rpcError) {
        toast.error('ارسال برای تأیید ناموفق بود. لطفاً دوباره تلاش کنید.');
        return;
      }
      if (data && data.success === false) {
        const code: string = data.error_code || 'INTERNAL_ERROR';
        const msgs: Record<string, string> = {
          NOT_AUTHENTICATED: 'برای ارسال باید وارد شده باشید.',
          MINUTE_NOT_FOUND: 'صورت‌جلسه یافت نشد.',
          MINUTES_NO_PERMISSION: 'شما اجازه ارسال این صورت‌جلسه را ندارید.',
          MINUTE_NOT_SUBMITTABLE: 'این صورت‌جلسه در وضعیت قابل ارسال نیست.',
          MINUTES_VERSION_CONFLICT: 'این صورت‌جلسه توسط کاربر دیگری تغییر کرده است. اطلاعات را دوباره بارگذاری کنید.',
          APPROVAL_MODE_IMMUTABLE: 'مدل تأیید پس از اولین ارسال قابل تغییر نیست.',
          INVALID_APPROVAL_MODE: 'مدل تأیید نامعتبر است.',
          NO_ELIGIBLE_APPROVERS: 'هیچ شرکت‌کننده واجد شرایطی برای تأیید سیستمی وجود ندارد.',
        };
        toast.error(msgs[code] || 'ارسال برای تأیید ناموفق بود.');
        return;
      }
      if (data && data.success === true) {
        toast.success('صورت‌جلسه برای تأیید ارسال شد.');
        if (data.minute_id) setMinuteIdInUrl(data.minute_id);
        setMinutesPageInUrl('minutes-detail');
        onNavigate('minutes-detail');
        return;
      }
      toast.error('پاسخ نامعتبر از سرور دریافت شد.');
    } catch {
      toast.error('خطای غیرمنتظره رخ داد.');
    } finally {
      setSubmitting(false);
    }
  };

  // New-mode guard: require a valid meeting param (entry from meeting detail)
  if (mode === 'new' && !getMeetingIdFromUrl()) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="w-10 h-10 text-gray-400 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">جلسه‌ای انتخاب نشده</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">برای ثبت صورت‌جلسه ابتدا باید یک جلسه را از تقویم انتخاب کنید.</p>
          <button onClick={() => onNavigate('calendar')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <CalendarDays className="w-4 h-4" />
            رفتن به تقویم
          </button>
        </div>
      </div>
    );
  }

  // Edit-mode loading / not-found / error states
  if (mode === 'edit' && editLoading) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <TableSkeleton rows={6} />
        </div>
      </div>
    );
  }
  if (mode === 'edit' && editNotFound) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CircleAlert as AlertCircle className="w-10 h-10 text-gray-400 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">صورت‌جلسه‌ای یافت نشد</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">این صورت‌جلسه وجود ندارد، حذف شده است، یا شما دسترسی ویرایش آن را ندارید.</p>
          <button onClick={() => onNavigate('minutes')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            بازگشت به لیست
          </button>
        </div>
      </div>
    );
  }
  if (mode === 'edit' && editError) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          {editError}
        </div>
      </div>
    );
  }

  const isNonEditable = mode === 'edit' && info.status !== 'draft' && info.status !== 'changes_requested';

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title={title}
        actions={
          <button
            onClick={() => onNavigate('minutes')}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            انصراف
          </button>
        }
      />

      <div className="flex gap-5">
        {/* Section Stepper — desktop sidebar */}
        <div className="hidden lg:flex flex-col gap-1 w-48 flex-shrink-0">
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === activeSection;
            const isDone = i < activeSection;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : isDone
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main form area */}
        <div className="flex-1 min-w-0">
          {/* Mobile section tabs */}
          <div className="lg:hidden flex gap-1 overflow-x-auto pb-2 mb-4">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(i)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  i === activeSection
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            {activeSection === 0 && (
              <SectionInfo
                info={info}
                setInfo={setInfo}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                orgUnitsError={orgUnitsError}
                prefillLoading={prefillLoading}
                prefillError={prefillError}
                isMeetingPrefilled={mode === 'new' && !!info.meetingId}
                agendaLoading={agendaLoading}
                internalParticipants={internalParticipants}
              />
            )}
            {activeSection === 1 && (
              <SectionParticipants
                internalParticipants={internalParticipants}
                setInternalParticipants={setInternalParticipants}
                externalParticipants={externalParticipants}
                setExternalParticipants={setExternalParticipants}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                orgUnitsError={orgUnitsError}
                invitationStatusReadOnly={mode === 'new'}
              />
            )}
            {activeSection === 2 && (
              <SectionAgenda agendaItems={agendaItems} setAgendaItems={setAgendaItems} agendaLoading={agendaLoading} internalParticipants={internalParticipants} externalParticipants={externalParticipants} />
            )}
            {activeSection === 3 && (
              <SectionDecisions
                decisions={decisions}
                setDecisions={setDecisions}
                profiles={profiles}
                profilesLoading={profilesLoading}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                agendaItems={agendaItems}
                readOnly={isNonEditable}
              />
            )}
            {activeSection === 4 && (
              <SectionAttachments
                minuteId={mode === 'edit' ? editMinuteId : workingMinuteId}
                canManage={!isNonEditable}
              />
            )}
            {activeSection === 5 && (
              <SectionApprovers
                approvalMode={info.approvalMode}
                internalParticipants={internalParticipants}
                profiles={profiles}
                readOnly={isNonEditable}
              />
            )}
            {activeSection === 6 && (
              <SectionFinal finalization={finalization} setFinalization={setFinalization} />
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
            <button
              onClick={() => setActiveSection(s => Math.max(0, s - 1))}
              disabled={activeSection === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
              بخش قبلی
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSaveDraft}
                disabled={savingDraft}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {savingDraft ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس'}
              </button>
              <button
                onClick={() => onNavigate('minutes-detail')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Eye className="w-4 h-4" />
                پیش‌نمایش
              </button>
              {activeSection === SECTIONS.length - 1 ? (
                <button
                  onClick={handleSubmitForApproval}
                  disabled={submitting || savingDraft || !info.approvalMode}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'در حال ارسال...' : 'ارسال برای تأیید'}
                </button>
              ) : (
                <button
                  onClick={() => setActiveSection(s => Math.min(SECTIONS.length - 1, s + 1))}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  ذخیره و ادامه
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dev-only debug panel */}
      {isDev && <DebugPayloadPanel payload={payload} />}
    </div>
  );
}
