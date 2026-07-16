import { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Plus, Trash2, GripVertical, Users, FileText, SquareCheck as CheckSquare, Paperclip, Shield, Signature as FileSignature, Save, Eye, Send, X, CircleAlert as AlertCircle, Upload, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PageHeader, ConfidentialityBadge } from './MinutesShared';
import type {
  ConfidentialityLevel, InvitationStatus, AttendanceStatus,
  AgendaResultType, DecisionPriority, DecisionStatus, ApprovalMethod,
  MinutesStatus,
} from './types';

interface Props {
  mode: 'new' | 'edit';
  onNavigate: (page: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetched data types
// ─────────────────────────────────────────────────────────────────────────────

interface MeetingOption {
  id: string;
  subject: string;
  request_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string;
  status_type: string;
  user_id: string;
  meeting_manager: string | null;
  participant_user_ids: string[] | null;
  org_unit_id: string | null;
}

interface ProfileOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
  position: string | null;
  primary_unit_id: string | null;
}

interface OrgUnitOption {
  id: string;
  name: string;
}

interface AgendaItemOption {
  id: string;
  title: string;
  presenter: string | null;
  duration_minutes: number | null;
  sort_order: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft payload types (local to the form; reuse enums from types.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface DraftMeetingInfo {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  meetingType: string;
  startTime: string;
  endTime: string;
  location: string;
  orgUnitId: string;
  orgUnitNameSnapshot: string;
  secretaryUserId: string;
  secretaryNameSnapshot: string;
  chairUserId: string;
  chairNameSnapshot: string;
  notes: string;
  confidentiality: ConfidentialityLevel;
  status: MinutesStatus;
}

interface DraftInternalParticipant {
  id: string;
  userId: string;
  nameSnapshot: string;
  positionSnapshot: string;
  orgUnitId: string;
  orgUnitNameSnapshot: string;
  invitationStatus: InvitationStatus;
  attendanceStatus: AttendanceStatus | null;
  delegate: string;
  notes: string;
}

interface DraftExternalParticipant {
  id: string;
  fullName: string;
  organization: string;
  position: string;
  mobile: string;
  email: string;
  attendanceStatus: AttendanceStatus | null;
}

interface DraftAgendaItem {
  id: string;
  meetingAgendaItemId: string;
  order: number;
  title: string;
  description: string;
  presenter: string;
  allocatedTime: string;
  discussionResult: string;
  resultType: AgendaResultType;
  additionalNotes: string;
}

interface DraftDecision {
  id: string;
  title: string;
  description: string;
  priority: DecisionPriority;
  status: DecisionStatus;
  primaryOwner: string;
  responsibleUnit: string;
  startDate: string;
  deadline: string;
  progressPercent: number;
  requiresFollowup: boolean;
}

interface DraftApprover {
  id: string;
  name: string;
  position: string;
  unit: string;
  order: number;
  method: ApprovalMethod;
}

interface DraftFinalization {
  signDate: string;
  versionNumber: string;
  versionNotes: string;
}

interface MinutesDraftPayload {
  info: DraftMeetingInfo;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
  agendaItems: DraftAgendaItem[];
  decisions: DraftDecision[];
  approvers: DraftApprover[];
  finalization: DraftFinalization;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default factories
// ─────────────────────────────────────────────────────────────────────────────

const uid = () => String(Date.now()) + Math.random().toString(36).slice(2, 6);

const defaultInfo: DraftMeetingInfo = {
  meetingId: '',
  meetingTitle: '',
  meetingDate: '',
  meetingType: '',
  startTime: '',
  endTime: '',
  location: '',
  orgUnitId: '',
  orgUnitNameSnapshot: '',
  secretaryUserId: '',
  secretaryNameSnapshot: '',
  chairUserId: '',
  chairNameSnapshot: '',
  notes: '',
  confidentiality: 'organizational',
  status: 'draft',
};

const defaultInternalParticipant = (): DraftInternalParticipant => ({
  id: uid(),
  userId: '',
  nameSnapshot: '',
  positionSnapshot: '',
  orgUnitId: '',
  orgUnitNameSnapshot: '',
  invitationStatus: 'invited',
  attendanceStatus: null,
  delegate: '',
  notes: '',
});

const defaultExternalParticipant = (): DraftExternalParticipant => ({
  id: uid(),
  fullName: '',
  organization: '',
  position: '',
  mobile: '',
  email: '',
  attendanceStatus: null,
});

const defaultAgendaItem = (order: number): DraftAgendaItem => ({
  id: uid(),
  meetingAgendaItemId: '',
  order,
  title: '',
  description: '',
  presenter: '',
  allocatedTime: '',
  discussionResult: '',
  resultType: 'discussion',
  additionalNotes: '',
});

const defaultDecision = (): DraftDecision => ({
  id: uid(),
  title: '',
  description: '',
  priority: 'normal',
  status: 'not_started',
  primaryOwner: '',
  responsibleUnit: '',
  startDate: '',
  deadline: '',
  progressPercent: 0,
  requiresFollowup: false,
});

const defaultApprover = (order: number): DraftApprover => ({
  id: uid(),
  name: '',
  position: '',
  unit: '',
  order,
  method: 'digital',
});

const defaultFinalization: DraftFinalization = {
  signDate: '',
  versionNumber: '',
  versionNotes: '',
};

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

export function MinutesFormPage({ mode, onNavigate }: Props) {
  const [activeSection, setActiveSection] = useState(0);

  const [info, setInfo] = useState<DraftMeetingInfo>(defaultInfo);
  const [internalParticipants, setInternalParticipants] = useState<DraftInternalParticipant[]>([defaultInternalParticipant()]);
  const [externalParticipants, setExternalParticipants] = useState<DraftExternalParticipant[]>([defaultExternalParticipant()]);
  const [agendaItems, setAgendaItems] = useState<DraftAgendaItem[]>([defaultAgendaItem(1)]);
  const [decisions, setDecisions] = useState<DraftDecision[]>([defaultDecision()]);
  const [approvers, setApprovers] = useState<DraftApprover[]>([defaultApprover(1)]);
  const [finalization, setFinalization] = useState<DraftFinalization>(defaultFinalization);

  // Fetched reference data
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(true);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [orgUnitsError, setOrgUnitsError] = useState<string | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const title = mode === 'new' ? 'ایجاد صورت‌جلسه' : 'ویرایش صورت‌جلسه';

  // ── Fetch allowed meetings (scheduled + has calendar_id) ──────────────
  useEffect(() => {
    (async () => {
      setMeetingsLoading(true);
      setMeetingsError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setMeetingsError('کاربر احراز هویت نشده است.');
          setMeetingsLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from('meetings')
          .select('id, subject, request_date, start_time, end_time, location, status_type, user_id, meeting_manager, participant_user_ids, calendar_id')
          .eq('status_type', 'scheduled')
          .not('calendar_id', 'is', null)
          .order('request_date', { ascending: false });
        if (error) throw error;
        setMeetings((data || []) as unknown as MeetingOption[]);
      } catch (err) {
        setMeetingsError(err instanceof Error ? err.message : 'خطا در بارگذاری جلسات');
      } finally {
        setMeetingsLoading(false);
      }
    })();
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

  // ── Prefill agenda items when meeting is selected ─────────────────────
  const fetchAgendaItems = useCallback(async (meetingId: string) => {
    setAgendaLoading(true);
    try {
      const { data, error } = await supabase
        .from('meeting_agenda_items')
        .select('id, title, presenter, duration_minutes, sort_order')
        .eq('meeting_id', meetingId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const items = (data || []) as unknown as AgendaItemOption[];
      if (items.length > 0) {
        setAgendaItems(items.map((item, idx) => ({
          id: uid(),
          meetingAgendaItemId: item.id,
          order: idx + 1,
          title: item.title,
          description: '',
          presenter: item.presenter || '',
          allocatedTime: item.duration_minutes != null ? String(item.duration_minutes) : '',
          discussionResult: '',
          resultType: 'discussion',
          additionalNotes: '',
        })));
      } else {
        setAgendaItems([defaultAgendaItem(1)]);
      }
    } catch (err) {
      toast.error('خطا در بارگذاری دستور جلسات: ' + (err instanceof Error ? err.message : 'نامشخص'));
      setAgendaItems([defaultAgendaItem(1)]);
    } finally {
      setAgendaLoading(false);
    }
  }, []);

  const handleMeetingSelect = useCallback((meetingId: string) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) {
      setInfo(prev => ({ ...prev, meetingId: '', meetingTitle: '', meetingDate: '', startTime: '', endTime: '', location: '' }));
      return;
    }
    setInfo(prev => ({
      ...prev,
      meetingId: meeting.id,
      meetingTitle: meeting.subject,
      meetingDate: meeting.request_date || '',
      startTime: meeting.start_time || '',
      endTime: meeting.end_time || '',
      location: meeting.location || '',
    }));
    fetchAgendaItems(meeting.id);
  }, [meetings, fetchAgendaItems]);

  const payload: MinutesDraftPayload = useMemo(
    () => ({
      info,
      internalParticipants,
      externalParticipants,
      agendaItems,
      decisions,
      approvers,
      finalization,
    }),
    [info, internalParticipants, externalParticipants, agendaItems, decisions, approvers, finalization],
  );

  const validate = (): string | null => {
    if (!info.meetingId) return 'انتخاب جلسه الزامی است';
    if (!info.meetingTitle.trim()) return 'عنوان جلسه الزامی است';
    if (!info.meetingDate.trim()) return 'تاریخ جلسه الزامی است';
    if (!info.secretaryUserId) return 'انتخاب دبیر جلسه الزامی است';
    if (!info.chairUserId) return 'انتخاب رئیس جلسه الزامی است';
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
      meeting_id: info.meetingId,
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
          discussion_result: a.discussionResult || null,
          result_type: a.resultType,
          additional_notes: a.additionalNotes || null,
        })),
    };

    if (isDev) {
      console.log('[MinutesDraftRPCPayload]', payload);
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('create_minutes_draft', {
        p_payload: payload,
      });

      if (rpcError) {
        if (isDev) console.error('[MinutesDraftRPC] Supabase error:', rpcError);
        toast.error('ذخیره پیش‌نویس ناموفق بود. لطفاً دوباره تلاش کنید.');
        return;
      }

      if (data && data.success === false) {
        const code: string = data.code || 'INTERNAL_ERROR';
        const msg = RPC_ERROR_MESSAGES[code] || 'ذخیره پیش‌نویس ناموفق بود.';
        if (isDev) console.error('[MinutesDraftRPC] Business error:', code, data.message);
        toast.error(msg);
        return;
      }

      if (data && data.success === true) {
        const minuteId = data.minute_id;
        if (isDev) console.log('[MinutesDraftRPC] Created minute_id:', minuteId);
        toast.success('پیش‌نویس صورت‌جلسه با موفقیت ذخیره شد.');
        sessionStorage.setItem('selectedMinuteId', minuteId);
        onNavigate('minutes-detail');
        return;
      }

      // Unexpected response shape — treat as error but preserve form
      if (isDev) console.error('[MinutesDraftRPC] Unexpected response:', data);
      toast.error('پاسخ نامعتبر از سرور دریافت شد.');
    } catch (err) {
      if (isDev) console.error('[MinutesDraftRPC] Exception:', err);
      toast.error('خطای غیرمنتظره رخ داد. فرم حفظ شد؛ لطفاً دوباره تلاش کنید.');
    } finally {
      setSavingDraft(false);
    }
  };

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
                meetings={meetings}
                meetingsLoading={meetingsLoading}
                meetingsError={meetingsError}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                orgUnitsError={orgUnitsError}
                onMeetingSelect={handleMeetingSelect}
                agendaLoading={agendaLoading}
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
              />
            )}
            {activeSection === 2 && (
              <SectionAgenda agendaItems={agendaItems} setAgendaItems={setAgendaItems} agendaLoading={agendaLoading} />
            )}
            {activeSection === 3 && (
              <SectionDecisions decisions={decisions} setDecisions={setDecisions} />
            )}
            {activeSection === 4 && <SectionAttachments />}
            {activeSection === 5 && (
              <SectionApprovers approvers={approvers} setApprovers={setApprovers} />
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
                  onClick={handleSaveDraft}
                  disabled={savingDraft}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {savingDraft ? 'در حال ذخیره...' : 'ارسال برای تأیید'}
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

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Meeting Info
// ─────────────────────────────────────────────────────────────────────────────

interface SectionInfoProps {
  info: DraftMeetingInfo;
  setInfo: React.Dispatch<React.SetStateAction<DraftMeetingInfo>>;
  meetings: MeetingOption[];
  meetingsLoading: boolean;
  meetingsError: string | null;
  profiles: ProfileOption[];
  profilesLoading: boolean;
  profilesError: string | null;
  orgUnits: OrgUnitOption[];
  orgUnitsLoading: boolean;
  orgUnitsError: string | null;
  onMeetingSelect: (meetingId: string) => void;
  agendaLoading: boolean;
}

function SectionInfo({
  info, setInfo,
  meetings, meetingsLoading, meetingsError,
  profiles, profilesLoading, profilesError,
  orgUnits, orgUnitsLoading, orgUnitsError,
  onMeetingSelect, agendaLoading,
}: SectionInfoProps) {
  const update = (field: keyof DraftMeetingInfo, value: string) =>
    setInfo(prev => ({ ...prev, [field]: value }));

  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;

  const handleSecretaryChange = (userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    setInfo(prev => ({
      ...prev,
      secretaryUserId: userId,
      secretaryNameSnapshot: p ? profileLabel(p) : '',
    }));
  };

  const handleChairChange = (userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    setInfo(prev => ({
      ...prev,
      chairUserId: userId,
      chairNameSnapshot: p ? profileLabel(p) : '',
    }));
  };

  const handleOrgUnitChange = (unitId: string) => {
    const unit = orgUnits.find(u => u.id === unitId);
    setInfo(prev => ({
      ...prev,
      orgUnitId: unitId,
      orgUnitNameSnapshot: unit ? unit.name : '',
    }));
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        اطلاعات جلسه
      </h2>

      {/* Meeting selector hint */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-700 dark:text-blue-300">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        صورت‌جلسه فقط برای جلساتی قابل ایجاد است که در تقویم قرار دارند و وضعیت آن‌ها «برنامه‌ریزی‌شده» است.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Meeting selector */}
        <div className="sm:col-span-2">
          <label htmlFor="meeting-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            انتخاب جلسه <span className="text-red-500">*</span>
          </label>
          {meetingsLoading ? (
            <LoadingSelect label="در حال بارگذاری جلسات..." />
          ) : meetingsError ? (
            <ErrorState message={meetingsError} />
          ) : meetings.length === 0 ? (
            <EmptyState message="هیچ جلسه برنامه‌ریزی‌شده‌ای با تقویم یافت نشد." />
          ) : (
            <select
              id="meeting-select"
              value={info.meetingId}
              onChange={e => onMeetingSelect(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">انتخاب کنید...</option>
              {meetings.map(m => (
                <option key={m.id} value={m.id}>
                  {m.subject}{m.request_date ? ` — ${m.request_date}` : ''}
                </option>
              ))}
            </select>
          )}
          {agendaLoading && (
            <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              در حال بارگذاری دستور جلسات...
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            عنوان جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="meeting-title"
            type="text"
            value={info.meetingTitle}
            onChange={e => update('meetingTitle', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="عنوان جلسه را وارد کنید"
          />
        </div>

        <div>
          <label htmlFor="meeting-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            تاریخ جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="meeting-date"
            type="text"
            value={info.meetingDate}
            onChange={e => update('meetingDate', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="۱۴۰۳/۰۵/۱۲"
          />
        </div>

        <div>
          <label htmlFor="meeting-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            نوع جلسه
          </label>
          <select
            id="meeting-type"
            value={info.meetingType}
            onChange={e => update('meetingType', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="">انتخاب کنید</option>
            <option value="board">هیئت مدیره</option>
            <option value="management">مدیریتی</option>
            <option value="operational">عملیاتی</option>
            <option value="project">پروژه</option>
            <option value="coordination">هماهنگی</option>
          </select>
        </div>

        <div>
          <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            ساعت شروع
          </label>
          <input
            id="start-time"
            type="time"
            value={info.startTime}
            onChange={e => update('startTime', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            ساعت پایان
          </label>
          <input
            id="end-time"
            type="time"
            value={info.endTime}
            onChange={e => update('endTime', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            محل برگزاری
          </label>
          <input
            id="location"
            type="text"
            value={info.location}
            onChange={e => update('location', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="اتاق جلسات / آنلاین"
          />
        </div>

        {/* Org Unit selector */}
        <div>
          <label htmlFor="org-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            واحد برگزارکننده
          </label>
          {orgUnitsLoading ? (
            <LoadingSelect label="در حال بارگذاری واحدها..." />
          ) : orgUnitsError ? (
            <ErrorState message={orgUnitsError} />
          ) : orgUnits.length === 0 ? (
            <EmptyState message="هیچ واحد سازمانی یافت نشد." />
          ) : (
            <select
              id="org-unit"
              value={info.orgUnitId}
              onChange={e => handleOrgUnitChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">انتخاب کنید</option>
              {orgUnits.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Secretary selector */}
        <div>
          <label htmlFor="secretary" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            دبیر جلسه <span className="text-red-500">*</span>
          </label>
          {profilesLoading ? (
            <LoadingSelect label="در حال بارگذاری کاربران..." />
          ) : profilesError ? (
            <ErrorState message={profilesError} />
          ) : profiles.length === 0 ? (
            <EmptyState message="هیچ کاربری یافت نشد." />
          ) : (
            <select
              id="secretary"
              value={info.secretaryUserId}
              onChange={e => handleSecretaryChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">انتخاب کنید</option>
              {profiles.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {profileLabel(p)}{p.position ? ` — ${p.position}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Chair selector */}
        <div>
          <label htmlFor="chair" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            رئیس جلسه <span className="text-red-500">*</span>
          </label>
          {profilesLoading ? (
            <LoadingSelect label="در حال بارگذاری کاربران..." />
          ) : profilesError ? (
            <ErrorState message={profilesError} />
          ) : profiles.length === 0 ? (
            <EmptyState message="هیچ کاربری یافت نشد." />
          ) : (
            <select
              id="chair"
              value={info.chairUserId}
              onChange={e => handleChairChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">انتخاب کنید</option>
              {profiles.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {profileLabel(p)}{p.position ? ` — ${p.position}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            توضیحات
          </label>
          <textarea
            id="notes"
            rows={3}
            value={info.notes}
            onChange={e => update('notes', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
          />
        </div>

        <div>
          <label htmlFor="confidentiality" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            سطح محرمانگی
          </label>
          <div className="flex items-center gap-3">
            <select
              id="confidentiality"
              value={info.confidentiality}
              onChange={e => setInfo(prev => ({ ...prev, confidentiality: e.target.value as ConfidentialityLevel }))}
              className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="public">عمومی</option>
              <option value="organizational">سازمانی</option>
              <option value="restricted">محدود</option>
              <option value="confidential">محرمانه</option>
            </select>
            <ConfidentialityBadge level={info.confidentiality} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Participants
// ─────────────────────────────────────────────────────────────────────────────

interface SectionParticipantsProps {
  internalParticipants: DraftInternalParticipant[];
  setInternalParticipants: React.Dispatch<React.SetStateAction<DraftInternalParticipant[]>>;
  externalParticipants: DraftExternalParticipant[];
  setExternalParticipants: React.Dispatch<React.SetStateAction<DraftExternalParticipant[]>>;
  profiles: ProfileOption[];
  profilesLoading: boolean;
  profilesError: string | null;
  orgUnits: OrgUnitOption[];
  orgUnitsLoading: boolean;
  orgUnitsError: string | null;
}

function SectionParticipants({
  internalParticipants,
  setInternalParticipants,
  externalParticipants,
  setExternalParticipants,
  profiles,
  profilesLoading,
  profilesError,
  orgUnits,
  orgUnitsLoading,
  orgUnitsError,
}: SectionParticipantsProps) {
  const addInternal = () =>
    setInternalParticipants(l => [...l, defaultInternalParticipant()]);

  const removeInternal = (id: string) =>
    setInternalParticipants(l => l.filter(r => r.id !== id));

  const updateInternal = (id: string, field: keyof DraftInternalParticipant, value: string) =>
    setInternalParticipants(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const handleInternalUserChange = (rowId: string, userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    const unit = orgUnits.find(u => u.id === (p?.primary_unit_id || ''));
    setInternalParticipants(l => l.map(r => r.id === rowId ? {
      ...r,
      userId,
      nameSnapshot: p ? (p.full_name || p.email || '') : '',
      positionSnapshot: p?.position || '',
      orgUnitId: p?.primary_unit_id || '',
      orgUnitNameSnapshot: unit?.name || '',
    } : r));
  };

  const handleInternalOrgUnitChange = (rowId: string, unitId: string) => {
    const unit = orgUnits.find(u => u.id === unitId);
    setInternalParticipants(l => l.map(r => r.id === rowId ? {
      ...r,
      orgUnitId: unitId,
      orgUnitNameSnapshot: unit?.name || '',
    } : r));
  };

  const addExternal = () =>
    setExternalParticipants(l => [...l, defaultExternalParticipant()]);

  const removeExternal = (id: string) =>
    setExternalParticipants(l => l.filter(r => r.id !== id));

  const updateExternal = (id: string, field: keyof DraftExternalParticipant, value: string) =>
    setExternalParticipants(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;

  const usersDisabled = profilesLoading || !!profilesError || profiles.length === 0;
  const orgUnitsDisabled = orgUnitsLoading || !!orgUnitsError || orgUnits.length === 0;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        شرکت‌کنندگان
      </h2>

      {/* Internal participants */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">شرکت‌کنندگان داخلی</h3>
          <button
            onClick={addInternal}
            disabled={usersDisabled}
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> افزودن
          </button>
        </div>
        {profilesError && <ErrorState message={profilesError} />}
        {!profilesError && profilesLoading ? (
          <LoadingRow label="در حال بارگذاری کاربران..." />
        ) : !profilesError && profiles.length === 0 ? (
          <EmptyState message="هیچ کاربری برای انتخاب وجود ندارد." />
        ) : (
        <div className="space-y-3">
          {internalParticipants.map(row => (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              {/* User selector */}
              <div>
                <label htmlFor={`int-user-${row.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">کاربر</label>
                <select
                  id={`int-user-${row.id}`}
                  value={row.userId}
                  onChange={e => handleInternalUserChange(row.id, e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">انتخاب کنید</option>
                  {profiles.map(p => (
                    <option key={p.user_id} value={p.user_id}>
                      {profileLabel(p)}{p.position ? ` — ${p.position}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {/* Position snapshot (read-only display from profile, editable) */}
              <InputField id={`int-pos-${row.id}`} label="سمت" placeholder="سمت" value={row.positionSnapshot} onChange={v => updateInternal(row.id, 'positionSnapshot', v)} />
              {/* Org unit selector */}
              <div>
                <label htmlFor={`int-unit-${row.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">واحد</label>
                <select
                  id={`int-unit-${row.id}`}
                  value={row.orgUnitId}
                  onChange={e => handleInternalOrgUnitChange(row.id, e.target.value)}
                  disabled={orgUnitsDisabled}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-40"
                >
                  <option value="">انتخاب کنید</option>
                  {orgUnits.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <SelectField id={`int-inv-${row.id}`} label="وضعیت دعوت" options={INVITATION_OPTIONS} value={row.invitationStatus} onChange={v => updateInternal(row.id, 'invitationStatus', v)} />
              <SelectField id={`int-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS_WITH_NULL} value={row.attendanceStatus ?? ''} onChange={v => updateInternal(row.id, 'attendanceStatus', v)} />
              <div className="flex items-end">
                <button
                  onClick={() => removeInternal(row.id)}
                  aria-label="حذف ردیف"
                  className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* External participants */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">شرکت‌کنندگان خارجی</h3>
          <button
            onClick={addExternal}
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> افزودن
          </button>
        </div>
        <div className="space-y-3">
          {externalParticipants.map(row => (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <InputField id={`ext-name-${row.id}`} label="نام و نام خانوادگی" placeholder="" value={row.fullName} onChange={v => updateExternal(row.id, 'fullName', v)} />
              <InputField id={`ext-org-${row.id}`} label="سازمان" placeholder="" value={row.organization} onChange={v => updateExternal(row.id, 'organization', v)} />
              <InputField id={`ext-pos-${row.id}`} label="سمت" placeholder="" value={row.position} onChange={v => updateExternal(row.id, 'position', v)} />
              <InputField id={`ext-mob-${row.id}`} label="موبایل" placeholder="" value={row.mobile} onChange={v => updateExternal(row.id, 'mobile', v)} />
              <SelectField id={`ext-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS_WITH_NULL} value={row.attendanceStatus ?? ''} onChange={v => updateExternal(row.id, 'attendanceStatus', v)} />
              <div className="flex items-end">
                <button
                  onClick={() => removeExternal(row.id)}
                  aria-label="حذف ردیف"
                  className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Agenda
// ─────────────────────────────────────────────────────────────────────────────

interface SectionAgendaProps {
  agendaItems: DraftAgendaItem[];
  setAgendaItems: React.Dispatch<React.SetStateAction<DraftAgendaItem[]>>;
  agendaLoading: boolean;
}

function SectionAgenda({ agendaItems, setAgendaItems, agendaLoading }: SectionAgendaProps) {
  const add = () =>
    setAgendaItems(l => [...l, defaultAgendaItem(l.length + 1)]);

  const remove = (id: string) =>
    setAgendaItems(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftAgendaItem, value: string) =>
    setAgendaItems(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">دستور جلسات و نتایج</h2>
        <button onClick={add} disabled={agendaLoading} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40">
          <Plus className="w-4 h-4" /> افزودن دستور
        </button>
      </div>

      {agendaLoading ? (
        <LoadingRow label="در حال بارگذاری دستور جلسات..." />
      ) : agendaItems.length === 0 ? (
        <EmptyState message="هیچ دستور جلساتی یافت نشد." />
      ) : (
      agendaItems.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">دستور {idx + 1}</span>
            {item.meetingAgendaItemId && (
              <span className="text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">از دستور جلسات جلسه</span>
            )}
            <div className="flex-1" />
            <button onClick={() => remove(item.id)} aria-label="حذف دستور" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <InputField id={`ag-title-${item.id}`} label="عنوان دستور جلسه" placeholder="عنوان دستور را وارد کنید" value={item.title} onChange={v => update(item.id, 'title', v)} />
            </div>
            <TextareaField id={`ag-desc-${item.id}`} label="شرح" rows={2} value={item.description} onChange={v => update(item.id, 'description', v)} />
            <div className="space-y-3">
              <InputField id={`ag-presenter-${item.id}`} label="ارائه‌دهنده" placeholder="" value={item.presenter} onChange={v => update(item.id, 'presenter', v)} />
              <InputField id={`ag-time-${item.id}`} label="زمان اختصاص‌یافته (دقیقه)" placeholder="30" value={item.allocatedTime} onChange={v => update(item.id, 'allocatedTime', v)} />
            </div>
            <TextareaField id={`ag-result-${item.id}`} label="نتیجه بحث" rows={2} value={item.discussionResult} onChange={v => update(item.id, 'discussionResult', v)} />
            <div className="space-y-3">
              <SelectField id={`ag-type-${item.id}`} label="نوع نتیجه" options={AGENDA_RESULT_OPTIONS} value={item.resultType} onChange={v => update(item.id, 'resultType', v)} />
              <InputField id={`ag-notes-${item.id}`} label="توضیحات تکمیلی" placeholder="" value={item.additionalNotes} onChange={v => update(item.id, 'additionalNotes', v)} />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> افزودن نتیجه
              </button>
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> افزودن مصوبه
              </button>
            </div>
          </div>
        </div>
      ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Decisions
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDecisionsProps {
  decisions: DraftDecision[];
  setDecisions: React.Dispatch<React.SetStateAction<DraftDecision[]>>;
}

function SectionDecisions({ decisions, setDecisions }: SectionDecisionsProps) {
  const add = () =>
    setDecisions(l => [...l, defaultDecision()]);

  const remove = (id: string) =>
    setDecisions(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftDecision, value: string | number | boolean) =>
    setDecisions(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن مصوبه
        </button>
      </div>

      {decisions.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">مصوبه {idx + 1}</span>
            <div className="flex-1" />
            <button onClick={() => remove(item.id)} aria-label="حذف مصوبه" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <InputField id={`dec-title-${item.id}`} label="عنوان مصوبه" placeholder="عنوان مصوبه را وارد کنید" value={item.title} onChange={v => update(item.id, 'title', v)} />
            </div>
            <TextareaField id={`dec-desc-${item.id}`} label="شرح کامل" rows={3} value={item.description} onChange={v => update(item.id, 'description', v)} />
            <div className="space-y-3">
              <SelectField id={`dec-priority-${item.id}`} label="اولویت" options={PRIORITY_OPTIONS} value={item.priority} onChange={v => update(item.id, 'priority', v)} />
              <SelectField id={`dec-status-${item.id}`} label="وضعیت" options={DECISION_STATUS_OPTIONS} value={item.status} onChange={v => update(item.id, 'status', v)} />
            </div>
            <InputField id={`dec-owner-${item.id}`} label="مسئول اصلی" placeholder="" value={item.primaryOwner} onChange={v => update(item.id, 'primaryOwner', v)} />
            <InputField id={`dec-unit-${item.id}`} label="واحد مسئول" placeholder="" value={item.responsibleUnit} onChange={v => update(item.id, 'responsibleUnit', v)} />
            <InputField id={`dec-start-${item.id}`} label="تاریخ شروع" placeholder="۱۴۰۳/۰۵/۱۵" value={item.startDate} onChange={v => update(item.id, 'startDate', v)} />
            <InputField id={`dec-deadline-${item.id}`} label="مهلت انجام" placeholder="۱۴۰۳/۰۶/۱۰" value={item.deadline} onChange={v => update(item.id, 'deadline', v)} />
            <div className="sm:col-span-2">
              <label htmlFor={`dec-progress-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                درصد پیشرفت
              </label>
              <input
                id={`dec-progress-${item.id}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={item.progressPercent}
                onChange={e => update(item.id, 'progressPercent', Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <label htmlFor={`dec-followup-${item.id}`} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  id={`dec-followup-${item.id}`}
                  type="checkbox"
                  checked={item.requiresFollowup}
                  onChange={e => update(item.id, 'requiresFollowup', e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">نیازمند پیگیری</span>
              </label>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Attachments (placeholder — no state needed)
// ─────────────────────────────────────────────────────────────────────────────

function SectionAttachments() {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        پیوست‌ها
      </h2>

      {/* Drop zone */}
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">فایل را اینجا رها کنید</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">یا</p>
        <button className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 transition-colors">
          <Paperclip className="w-4 h-4" />
          انتخاب فایل
        </button>
        <p className="text-xs text-gray-400 mt-3">آپلود واقعی در این مرحله فعال نیست</p>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">هیچ فایلی پیوست نشده است.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Approvers
// ─────────────────────────────────────────────────────────────────────────────

interface SectionApproversProps {
  approvers: DraftApprover[];
  setApprovers: React.Dispatch<React.SetStateAction<DraftApprover[]>>;
}

function SectionApprovers({ approvers, setApprovers }: SectionApproversProps) {
  const add = () =>
    setApprovers(l => [...l, defaultApprover(l.length + 1)]);

  const remove = (id: string) =>
    setApprovers(l => l.filter(a => a.id !== id));

  const update = (id: string, field: keyof DraftApprover, value: string) =>
    setApprovers(l => l.map(a => (a.id === id ? { ...a, [field]: value } : a)));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">تأییدکنندگان</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" defaultChecked className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید سیستمی</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ارسال درخواست دیجیتال</p>
          </div>
        </label>
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید حضوری</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ثبت تأیید دستی</p>
          </div>
        </label>
      </div>

      <div className="space-y-3">
        {approvers.map((a, idx) => (
          <div key={a.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl items-end">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <InputField id={`ap-name-${a.id}`} label="نام" placeholder="" value={a.name} onChange={v => update(a.id, 'name', v)} />
            </div>
            <InputField id={`ap-pos-${a.id}`} label="سمت" placeholder="" value={a.position} onChange={v => update(a.id, 'position', v)} />
            <InputField id={`ap-unit-${a.id}`} label="واحد" placeholder="" value={a.unit} onChange={v => update(a.id, 'unit', v)} />
            <div className="flex items-end gap-2">
              <SelectField id={`ap-method-${a.id}`} label="نوع تأیید" options={[{ value: 'digital', label: 'سیستمی' }, { value: 'in_person', label: 'حضوری' }]} value={a.method} onChange={v => update(a.id, 'method', v)} />
              <button onClick={() => remove(a.id)} aria-label="حذف تأییدکننده" className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Final version & signature
// ─────────────────────────────────────────────────────────────────────────────

interface SectionFinalProps {
  finalization: DraftFinalization;
  setFinalization: React.Dispatch<React.SetStateAction<DraftFinalization>>;
}

function SectionFinal({ finalization, setFinalization }: SectionFinalProps) {
  const update = (field: keyof DraftFinalization, value: string) =>
    setFinalization(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        نسخه نهایی و امضا
      </h2>

      {/* Preview area */}
      <div className="border border-gray-200 dark:border-gray-600 rounded-2xl p-6 bg-gray-50 dark:bg-gray-700/20 min-h-48 flex flex-col items-center justify-center gap-2">
        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">پیش‌نمایش صورت‌جلسه</p>
        <button className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 transition-colors">
          <Eye className="w-4 h-4" />
          نمایش پیش‌نمایش
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بارگذاری نسخه امضاشده</label>
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-blue-400 transition-colors">
            <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
            <p className="text-xs text-gray-500 dark:text-gray-400">بارگذاری واقعی در این مرحله فعال نیست</p>
          </div>
        </div>
        <InputField id="sign-date" label="تاریخ امضا" placeholder="۱۴۰۳/۰۵/۱۸" value={finalization.signDate} onChange={v => update('signDate', v)} />
        <InputField id="version-number" label="شماره نسخه" placeholder="۱.۰" value={finalization.versionNumber} onChange={v => update('versionNumber', v)} />
        <div className="sm:col-span-2">
          <TextareaField id="version-notes" label="توضیحات نسخه" rows={2} value={finalization.versionNotes} onChange={v => update('versionNotes', v)} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel (dev only)
// ─────────────────────────────────────────────────────────────────────────────

function DebugPayloadPanel({ payload }: { payload: MinutesDraftPayload }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4" dir="ltr">
      <p className="text-xs font-semibold text-gray-400 mb-2">DEV — MinutesDraftPayload</p>
      <pre className="text-xs text-gray-600 dark:text-gray-300 overflow-x-auto max-h-80 overflow-y-auto">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading / Error / Empty state helpers
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSelect({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin" />
      {label}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-sm text-red-600 dark:text-red-400">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-4 text-sm text-gray-400">
      {message}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable controlled form elements
// ─────────────────────────────────────────────────────────────────────────────

interface InputFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

function InputField({ id, label, placeholder, value, onChange }: InputFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
      />
    </div>
  );
}

interface TextareaFieldProps {
  id: string;
  label: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
}

function TextareaField({ id, label, rows, value, onChange }: TextareaFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
      />
    </div>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

function SelectField({ id, label, options, value, onChange }: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Option constants
// ─────────────────────────────────────────────────────────────────────────────

const INVITATION_OPTIONS = [
  { value: 'invited',   label: 'دعوت‌شده' },
  { value: 'accepted',  label: 'پذیرفته' },
  { value: 'declined',  label: 'ردشده' },
  { value: 'no_response', label: 'بدون پاسخ' },
  { value: 'delegated', label: 'تفویض‌شده' },
];

const ATTENDANCE_OPTIONS_WITH_NULL = [
  { value: '',                label: '—' },
  { value: 'present',         label: 'حاضر' },
  { value: 'absent',          label: 'غایب' },
  { value: 'online',          label: 'آنلاین' },
  { value: 'late',            label: 'با تأخیر' },
  { value: 'delegate_attended', label: 'حضور جانشین' },
];

const AGENDA_RESULT_OPTIONS = [
  { value: 'discussion', label: 'بحث و بررسی' },
  { value: 'action',     label: 'اقدام اجرایی' },
  { value: 'resolution', label: 'مصوبه' },
  { value: 'deferred',   label: 'موکول‌شده' },
  { value: 'no_result',  label: 'بدون نتیجه' },
];

const PRIORITY_OPTIONS = [
  { value: 'low',       label: 'کم' },
  { value: 'normal',    label: 'عادی' },
  { value: 'important', label: 'مهم' },
  { value: 'urgent',    label: 'فوری' },
];

const DECISION_STATUS_OPTIONS = [
  { value: 'not_started',          label: 'شروع‌نشده' },
  { value: 'planned',              label: 'برنامه‌ریزی‌شده' },
  { value: 'in_progress',          label: 'در حال انجام' },
  { value: 'waiting_coordination', label: 'منتظر هماهنگی' },
  { value: 'waiting_approval',     label: 'منتظر تأیید' },
  { value: 'completed',            label: 'تکمیل‌شده' },
  { value: 'stopped',              label: 'متوقف‌شده' },
];
