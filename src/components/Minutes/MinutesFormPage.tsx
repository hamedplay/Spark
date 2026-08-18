import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import {
  getMeetingIdFromUrl,
  getMinuteIdFromUrl,
  setMinuteIdInUrl,
} from '../../lib/minutesNavigation';
import { loadMinutesPrefill } from '../../lib/minutesPrefill';
import { checkSystemApproverEligibility } from '../../lib/minutesApprovalEligibility';
import { fetchMinutesConfig } from './fetchMinutesConfig';
import type { MinutesLayoutConfig } from './MinutesDocumentData';
import type {
  ApprovalMode,
  AttendanceStatus,
  ConfidentialityLevel,
  AgendaResultType,
  DecisionPriority,
  InvitationStatus,
  MinutesStatus,
} from './types';
import type {
  DraftAgendaItem,
  DraftDecision,
  DraftExternalParticipant,
  DraftFinalization,
  DraftInternalParticipant,
  DraftMeetingInfo,
  MinutesDraftPayload,
  OrgUnitOption,
  ProfileOption,
} from './Form/types';
import {
  defaultAgendaItem,
  defaultDecision,
  defaultExternalParticipant,
  defaultFinalization,
  defaultInfo,
  defaultInternalParticipant,
  uid,
} from './Form/defaults';
import type { ExternalParticipantSuggestion } from './Form/SectionParticipants';
import {
  MINUTES_RPC_ERROR_MESSAGES,
  MINUTES_SUBMIT_ERROR_MESSAGES,
} from './MinutesFormConfig';
import {
  buildDecisionsPayload,
  buildMinutesDraftPayload,
  validateMinutesForm,
} from './MinutesFormPayload';
import { MinutesFormView } from './MinutesFormView';

interface Props {
  mode: 'new' | 'edit';
  onNavigate: (page: string) => void;
  minuteId?: string;
}

interface WorkingMinuteResult {
  minuteId: string;
  updatedAt: string;
}

const isDev = import.meta.env.DEV;

export function MinutesFormPage({ mode, onNavigate, minuteId }: Props) {
  const [activeSection, setActiveSection] = useState(0);
  const [info, setInfo] = useState<DraftMeetingInfo>(defaultInfo);
  const [internalParticipants, setInternalParticipants] = useState<DraftInternalParticipant[]>([defaultInternalParticipant()]);
  const [externalParticipants, setExternalParticipants] = useState<DraftExternalParticipant[]>([defaultExternalParticipant()]);
  const [agendaItems, setAgendaItems] = useState<DraftAgendaItem[]>([defaultAgendaItem(1)]);
  const [decisions, setDecisions] = useState<DraftDecision[]>([defaultDecision()]);
  const [deletedDecisionIds, setDeletedDecisionIds] = useState<string[]>([]);
  const [deletedExternalParticipantIds, setDeletedExternalParticipantIds] = useState<string[]>([]);
  const [finalization, setFinalization] = useState<DraftFinalization>(defaultFinalization);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [docConfig, setDocConfig] = useState<MinutesLayoutConfig | null>(null);

  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [orgUnitsError, setOrgUnitsError] = useState<string | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [externalSuggestions, setExternalSuggestions] = useState<ExternalParticipantSuggestion[]>([]);

  const [prefillLoading, setPrefillLoading] = useState(mode === 'new');
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillAttempt, setPrefillAttempt] = useState(0);

  const [editMinuteId, setEditMinuteId] = useState<string | null>(null);
  const [workingMinuteId, setWorkingMinuteId] = useState<string | null>(null);
  const [editUpdatedAt, setEditUpdatedAt] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(mode === 'edit');
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotFound, setEditNotFound] = useState(false);
  const [decisionsLoadFailed, setDecisionsLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = mode === 'new' ? 'ایجاد صورت‌جلسه' : 'ویرایش صورت‌جلسه';

  useEffect(() => {
    if (mode !== 'edit') return;
    const targetId = minuteId || getMinuteIdFromUrl();
    if (!targetId) {
      setEditNotFound(true);
      setEditLoading(false);
      return;
    }

    void (async () => {
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
        if (!minData) {
          setEditNotFound(true);
          setEditLoading(false);
          return;
        }

        const minute = minData as Record<string, unknown>;
        setEditMinuteId(minute.id as string);
        setEditUpdatedAt(minute.updated_at as string);
        setInfo({
          meetingId: minute.meeting_id as string,
          meetingTitle: (minute.meeting_title_snapshot as string) || '',
          meetingDate: (minute.meeting_date_snapshot as string) || '',
          meetingType: (minute.meeting_type as string) || '',
          startTime: (minute.meeting_start_time_snapshot as string) || '',
          endTime: (minute.meeting_end_time_snapshot as string) || '',
          location: (minute.meeting_location_snapshot as string) || '',
          orgUnitId: (minute.org_unit_id as string) || '',
          orgUnitNameSnapshot: (minute.org_unit_name_snapshot as string) || '',
          secretaryUserId: (minute.secretary_user_id as string) || '',
          secretaryNameSnapshot: (minute.secretary_name_snapshot as string) || '',
          chairUserId: (minute.chair_user_id as string) || '',
          chairNameSnapshot: (minute.chair_name_snapshot as string) || '',
          notes: (minute.notes as string) || '',
          confidentiality: (minute.confidentiality as ConfidentialityLevel) || 'organizational',
          status: (minute.status as MinutesStatus) || 'draft',
          approvalMode: (minute.approval_mode as ApprovalMode) || '',
          revisionNumber: (minute.revision_number as number) || 1,
          submittedAt: (minute.submitted_at as string) || null,
        });

        const [internalResult, externalResult, agendaResult] = await Promise.all([
          supabase
            .from('minutes_participants')
            .select('id, user_id, name_snapshot, position_snapshot, org_unit_id, org_unit_name_snapshot, invitation_status, attendance_status, delegate_name, notes')
            .eq('minute_id', targetId)
            .order('created_at', { ascending: true }),
          supabase
            .from('minutes_external_participants')
            .select('id, full_name, organization, position, mobile, email, invitation_status, attendance_status, notes')
            .eq('minute_id', targetId)
            .order('created_at', { ascending: true }),
          supabase
            .from('minutes_agenda_results')
            .select('id, meeting_agenda_item_id, sort_order_snapshot, agenda_title_snapshot, agenda_description_snapshot, presenter_snapshot, allocated_minutes_snapshot, discussion_result, result_type, additional_notes')
            .eq('minute_id', targetId)
            .order('sort_order_snapshot', { ascending: true }),
        ]);

        if (internalResult.error) {
          console.error('[Minutes edit] minutes_participants query error:', internalResult.error);
          setEditError('خطا در بارگذاری شرکت‌کنندگان داخلی');
          setEditLoading(false);
          return;
        }
        if (internalResult.data) {
          const rows = internalResult.data as unknown as Record<string, unknown>[];
          setInternalParticipants(rows.length > 0 ? rows.map(row => ({
            id: uid(),
            participantId: (row.id as string) || null,
            userId: (row.user_id as string) || '',
            nameSnapshot: (row.name_snapshot as string) || '',
            positionSnapshot: (row.position_snapshot as string) || '',
            orgUnitId: (row.org_unit_id as string) || '',
            orgUnitNameSnapshot: (row.org_unit_name_snapshot as string) || '',
            invitationStatus: (row.invitation_status as InvitationStatus) || 'invited',
            attendanceStatus: (row.attendance_status as AttendanceStatus | null) ?? null,
            delegate: (row.delegate_name as string) || '',
            delegateUserId: null,
            delegateName: (row.delegate_name as string) || '',
            notes: (row.notes as string) || '',
            source: 'saved' as const,
          })) : [defaultInternalParticipant()]);
        }

        if (externalResult.error) {
          console.error('[Minutes edit] minutes_external_participants query error:', externalResult.error);
          setEditError('خطا در بارگذاری شرکت‌کنندگان خارجی');
          setEditLoading(false);
          return;
        }
        if (externalResult.data) {
          const rows = externalResult.data as unknown as Record<string, unknown>[];
          setExternalParticipants(rows.length > 0 ? rows.map(row => ({
            id: uid(),
            participantId: (row.id as string) || null,
            fullName: (row.full_name as string) || '',
            organization: (row.organization as string) || '',
            position: (row.position as string) || '',
            mobile: (row.mobile as string) || '',
            email: (row.email as string) || '',
            invitationStatus: (row.invitation_status as InvitationStatus) || 'invited',
            attendanceStatus: (row.attendance_status as AttendanceStatus | null) ?? null,
            notes: (row.notes as string) || '',
            source: 'saved' as const,
          })) : [defaultExternalParticipant()]);
        }

        if (agendaResult.error) {
          console.error('[Minutes edit] minutes_agenda_results query error:', agendaResult.error);
          setEditError('خطا در بارگذاری دستور جلسات');
          setEditLoading(false);
          return;
        }
        if (agendaResult.data) {
          const rows = agendaResult.data as unknown as Record<string, unknown>[];
          setAgendaItems(rows.length > 0 ? rows.map((row, index) => ({
            id: uid(),
            meetingAgendaItemId: (row.meeting_agenda_item_id as string) || '',
            order: index + 1,
            title: (row.agenda_title_snapshot as string) || '',
            description: (row.agenda_description_snapshot as string) || '',
            presenter: (row.presenter_snapshot as string) || '',
            allocatedTime: row.allocated_minutes_snapshot != null ? String(row.allocated_minutes_snapshot) : '',
            discussionResult: (row.discussion_result as string) || '',
            resultType: (row.result_type as AgendaResultType) || 'discussion',
            additionalNotes: (row.additional_notes as string) || '',
          })) : [defaultAgendaItem(1)]);
        }

        const { data: decisionData, error: decisionError } = await supabase.rpc(
          'get_minutes_decisions_for_edit',
          { p_minute_id: targetId },
        );
        if (decisionError) {
          console.error('[Minutes edit] get_minutes_decisions_for_edit RPC error:', decisionError);
          setEditError('خطا در بارگذاری مصوبات');
          setDecisionsLoadFailed(true);
          setEditLoading(false);
          return;
        }
        if (decisionData) {
          const rows = decisionData as unknown as Record<string, unknown>[];
          const agendaResultMap = new Map<string, string>();
          if (agendaResult.data) {
            for (const agendaRow of agendaResult.data as unknown as Record<string, unknown>[]) {
              const resultId = (agendaRow.id as string) || '';
              const agendaItemId = (agendaRow.meeting_agenda_item_id as string) || '';
              if (resultId && agendaItemId) agendaResultMap.set(resultId, agendaItemId);
            }
          }
          setDecisions(rows.length > 0 ? rows.map(row => ({
            id: uid(),
            decisionId: (row.id as string) || null,
            parentDecisionId: (row.parent_decision_id as string) || null,
            clauseOrder: row.clause_order != null ? Number(row.clause_order) : null,
            agendaResultId: (row.agenda_result_id as string) || null,
            meetingAgendaItemId: (row.agenda_result_id as string)
              ? (agendaResultMap.get(row.agenda_result_id as string) || '')
              : '',
            title: (row.title as string) || '',
            description: (row.description as string) || '',
            primaryOwnerUserId: (row.primary_owner_user_id as string) || '',
            responsibleUnitId: (row.responsible_unit_id as string) || null,
            responsibleUnitNameSnapshot: (row.responsible_unit_name_snapshot as string) || '',
            priority: (row.priority as DecisionPriority) || 'normal',
            startDate: (row.start_date as string) || '',
            dueDate: (row.due_date as string) || '',
            requiresFollowup: (row.requires_followup as boolean) ?? true,
            latestUpdate: (row.latest_update as string) || '',
            discussionResult: (row.discussion_result as string) || '',
            resultType: (row.result_type as AgendaResultType) || 'discussion',
            additionalNotes: (row.additional_notes as string) || '',
            responsiblePartyType: ((row.responsible_party_type as string) || 'internal') as 'internal' | 'external',
            externalResponsibleParticipantId: (row.external_responsible_participant_id as string) || null,
            externalResponsibleNameSnapshot: (row.external_responsible_name_snapshot as string) || '',
            externalResponsibleOrganizationSnapshot: (row.external_responsible_organization_snapshot as string) || '',
            externalResponsiblePositionSnapshot: (row.external_responsible_position_snapshot as string) || '',
          })) : [defaultDecision()]);
        }
      } catch (error) {
        setEditError(error instanceof Error ? error.message : 'خطا در بارگذاری صورت‌جلسه');
      } finally {
        setEditLoading(false);
      }
    })();
  }, [mode, minuteId]);

  useEffect(() => {
    if (mode !== 'new') return;
    const meetingId = getMeetingIdFromUrl();
    if (!meetingId) {
      setPrefillLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPrefillLoading(true);
      setPrefillError(null);
      try {
        const result = await loadMinutesPrefill(supabase, meetingId);
        if (cancelled) return;
        if (!result.allowed || !result.data) {
          if (result.errorCode === 'MEETING_NO_PERMISSION') {
            setPrefillError('شما اجازه ثبت صورت‌جلسه برای این جلسه را ندارید.');
          } else if (result.errorCode === 'MEETING_NOT_FOUND') {
            setPrefillError('جلسه موردنظر یافت نشد.');
          } else {
            setPrefillError('دریافت اطلاعات جلسه ناموفق بود.');
          }
          setPrefillLoading(false);
          return;
        }

        const {
          info: prefillInfo,
          internalParticipants: loadedInternalParticipants,
          externalParticipants: loadedExternalParticipants,
          agendaItems: loadedAgendaItems,
          profiles: loadedProfiles,
          orgUnits: loadedOrgUnits,
        } = result.data;
        setInfo(previous => ({ ...previous, ...prefillInfo }));
        setInternalParticipants(loadedInternalParticipants);
        setExternalParticipants(loadedExternalParticipants);
        setAgendaItems(loadedAgendaItems);
        setAgendaLoading(false);
        if (loadedProfiles.length > 0) {
          setProfiles(previous => {
            const byId = new Map(previous.map(profile => [profile.user_id, profile]));
            for (const profile of loadedProfiles) {
              if (!byId.has(profile.user_id)) byId.set(profile.user_id, profile);
            }
            return Array.from(byId.values());
          });
        }
        if (loadedOrgUnits.length > 0) {
          setOrgUnits(previous => {
            const byId = new Map(previous.map(unit => [unit.id, unit]));
            for (const unit of loadedOrgUnits) {
              if (!byId.has(unit.id)) byId.set(unit.id, unit);
            }
            return Array.from(byId.values());
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPrefillError(error instanceof Error ? error.message : 'خطا در بارگذاری اطلاعات جلسه');
        }
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [mode, prefillAttempt]);

  useEffect(() => {
    void (async () => {
      setProfilesLoading(true);
      setProfilesError(null);
      try {
        const { data, error } = await supabase
          .from('profiles_public')
          .select('user_id, full_name, username, position, primary_unit_id')
          .order('full_name');
        if (error) throw error;
        setProfiles((data || []) as unknown as ProfileOption[]);
      } catch (error) {
        setProfilesError(error instanceof Error ? error.message : 'خطا در بارگذاری کاربران');
      } finally {
        setProfilesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      setOrgUnitsLoading(true);
      setOrgUnitsError(null);
      try {
        const { data, error } = await supabase
          .from('org_units')
          .select('id, name')
          .order('name');
        if (error) throw error;
        setOrgUnits((data || []) as unknown as OrgUnitOption[]);
      } catch (error) {
        setOrgUnitsError(error instanceof Error ? error.message : 'خطا در بارگذاری واحدها');
      } finally {
        setOrgUnitsLoading(false);
      }
    })();
  }, []);

  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    void (async () => {
      const { logoUrl: logo, config, rawMap } = await fetchMinutesConfig();
      setLogoUrl(logo);
      setDocConfig(config);
      if (mode === 'new' && !defaultsAppliedRef.current) {
        defaultsAppliedRef.current = true;
        const defaultConfidentiality = rawMap.get('minutes.minutes_default_confidentiality') || 'organizational';
        const defaultApprovalMode = rawMap.get('minutes.minutes_default_approval_mode') || 'system';
        setInfo(previous => ({
          ...previous,
          confidentiality: (
            ['public', 'organizational', 'restricted', 'confidential'].includes(defaultConfidentiality)
              ? defaultConfidentiality
              : 'organizational'
          ) as ConfidentialityLevel,
          approvalMode: (
            ['system', 'in_person'].includes(defaultApprovalMode)
              ? defaultApprovalMode
              : 'system'
          ) as ApprovalMode,
        }));
      }
    })();
  }, [mode]);

  useEffect(() => {
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('contacts_email')
          .select('id, name, company, position, phone, email')
          .order('name');
        if (error) throw error;
        setExternalSuggestions((data || []) as ExternalParticipantSuggestion[]);
      } catch {
        setExternalSuggestions([]);
      }
    })();
  }, []);

  const payload: MinutesDraftPayload = useMemo(() => ({
    info,
    internalParticipants,
    externalParticipants,
    agendaItems,
    decisions,
    finalization,
  }), [info, internalParticipants, externalParticipants, agendaItems, decisions, finalization]);

  const makeDraftPayload = () => buildMinutesDraftPayload({
    info,
    internalParticipants,
    externalParticipants,
    agendaItems,
    decisions,
    profiles,
  });
  const makeDecisionsPayload = () => buildDecisionsPayload(decisions);
  const validate = () => validateMinutesForm({ info, decisions, prefillLoading, prefillError });

  const persistMinuteRef = useRef<Promise<WorkingMinuteResult | null> | null>(null);
  const minutesActionRef = useRef<Promise<void> | null>(null);

  const runExclusiveMinutesAction = (action: () => Promise<void>): Promise<void> => {
    if (minutesActionRef.current) return minutesActionRef.current;
    const operation = action().finally(() => { minutesActionRef.current = null; });
    minutesActionRef.current = operation;
    return operation;
  };

  const ensureWorkingMinute = async (options: { saveCurrentValues: boolean }): Promise<WorkingMinuteResult | null> => {
    if (persistMinuteRef.current) return persistMinuteRef.current;

    const sourceMeetingId = getMeetingIdFromUrl();
    const existingMinuteId = workingMinuteId ?? (mode === 'edit' ? editMinuteId : null);

    if (!existingMinuteId) {
      if (mode !== 'new') return null;
      if (!sourceMeetingId) {
        toast.error('برای ثبت صورت‌جلسه باید از جزئیات یک جلسه تقویمی وارد شوید.');
        return null;
      }
      const validationError = validate();
      if (validationError) {
        toast.error(validationError);
        return null;
      }

      const creation = (async (): Promise<WorkingMinuteResult | null> => {
        setSavingDraft(true);
        try {
          const createPayload = { meeting_id: sourceMeetingId, ...makeDraftPayload() };
          if (isDev) console.log('[MinutesDraftRPCPayload]', createPayload);
          const { data, error: rpcError } = await supabase.rpc('create_minutes_draft', {
            p_payload: createPayload,
            p_decisions: makeDecisionsPayload(),
          });
          if (rpcError) {
            console.error('[MinutesDraftRPC] create failed', {
              code: rpcError?.code,
              message: rpcError?.message,
              details: rpcError?.details,
            });
            toast.error('ذخیره پیش‌نویس صورت‌جلسه ناموفق بود.');
            return null;
          }
          if (data && data.success === false) {
            const code: string = data.code || data.error_code || 'INTERNAL_ERROR';
            if (code === 'MINUTES_ALREADY_EXISTS') {
              const { data: existing } = await supabase
                .from('minutes')
                .select('id')
                .eq('meeting_id', sourceMeetingId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              const existingId = (existing as { id: string } | null)?.id ?? null;
              toast.error('برای این جلسه قبلاً صورت‌جلسه ثبت شده است.');
              if (existingId) {
                setMinuteIdInUrl(existingId);
                onNavigate('minutes-detail');
              }
              return null;
            }
            console.error('[MinutesDraftRPC] business failure', {
              errorCode: data.error_code || code,
              message: data.message,
            });
            toast.error(MINUTES_RPC_ERROR_MESSAGES[code] || 'ذخیره پیش‌نویس صورت‌جلسه ناموفق بود.');
            return null;
          }
          if (data && data.success === true && data.minute_id) {
            const newId = data.minute_id as string;
            let realUpdatedAt = (data.updated_at as string | undefined) ?? null;
            if (!realUpdatedAt) {
              const { data: minuteRow } = await supabase
                .from('minutes')
                .select('updated_at')
                .eq('id', newId)
                .maybeSingle();
              realUpdatedAt = (minuteRow as { updated_at: string } | null)?.updated_at ?? null;
            }
            if (!realUpdatedAt) {
              toast.error('ذخیره پیش‌نویس صورت‌جلسه ناموفق بود.');
              return null;
            }
            setEditUpdatedAt(realUpdatedAt);
            setWorkingMinuteId(newId);
            setMinuteIdInUrl(newId);
            if (isDev) await verifyStoredDraft(newId, createPayload);
            return { minuteId: newId, updatedAt: realUpdatedAt };
          }
          if (isDev) console.error('[MinutesDraftRPC] Unexpected response:', data);
          toast.error('پاسخ نامعتبر از سرور دریافت شد.');
          return null;
        } catch (error) {
          if (isDev) console.error('[MinutesDraftRPC] Exception:', error);
          toast.error('خطای غیرمنتظره رخ داد. فرم حفظ شد؛ لطفاً دوباره تلاش کنید.');
          return null;
        } finally {
          setSavingDraft(false);
          persistMinuteRef.current = null;
        }
      })();

      persistMinuteRef.current = creation;
      return creation;
    }

    if (!options.saveCurrentValues) {
      if (!editUpdatedAt) {
        toast.error('ذخیره آخرین تغییرات صورت‌جلسه ناموفق بود.');
        return null;
      }
      return { minuteId: existingMinuteId, updatedAt: editUpdatedAt };
    }

    if (!editUpdatedAt) {
      toast.error('ذخیره آخرین تغییرات صورت‌جلسه ناموفق بود.');
      return null;
    }

    const update = (async (): Promise<WorkingMinuteResult | null> => {
      setSavingDraft(true);
      try {
        const updatePayload = makeDraftPayload();
        const { data, error: rpcError } = await supabase.rpc('update_minutes_draft', {
          p_minute_id: existingMinuteId,
          p_expected_updated_at: editUpdatedAt,
          p_payload: updatePayload,
          p_decisions: makeDecisionsPayload(),
          p_deleted_decision_ids: deletedDecisionIds,
          p_deleted_external_participant_ids: deletedExternalParticipantIds,
        });
        if (rpcError) {
          console.error('[MinutesUpdateRPC] update failed', {
            code: rpcError?.code,
            message: rpcError?.message,
            details: rpcError?.details,
          });
          toast.error('ذخیره آخرین تغییرات صورت‌جلسه ناموفق بود.');
          return null;
        }
        if (data && data.success === false) {
          const code: string = data.code || data.error_code || 'INTERNAL_ERROR';
          console.error('[MinutesUpdateRPC] business failure', {
            errorCode: data.error_code || code,
            message: data.message,
          });
          if (code === 'MINUTES_VERSION_CONFLICT') {
            toast.error('این صورت‌جلسه توسط کاربر دیگری تغییر کرده است. اطلاعات را دوباره بارگذاری کنید.');
          } else if (code === 'MINUTES_NO_PERMISSION') {
            toast.error('شما اجازه ویرایش این صورت‌جلسه را ندارید.');
          } else if (code === 'MINUTE_NOT_FOUND') {
            toast.error('صورت‌جلسه یافت نشد.');
          } else {
            toast.error(MINUTES_RPC_ERROR_MESSAGES[code] || 'ذخیره آخرین تغییرات صورت‌جلسه ناموفق بود.');
          }
          return null;
        }
        if (data && data.success === true) {
          const returnedUpdatedAt = data.updated_at as string | undefined;
          if (!returnedUpdatedAt) {
            toast.error('ذخیره آخرین تغییرات صورت‌جلسه ناموفق بود.');
            return null;
          }
          if (isDev) console.log('[MinutesUpdateRPC] Updated:', data.minute_id, returnedUpdatedAt);
          setEditUpdatedAt(returnedUpdatedAt);
          setWorkingMinuteId(existingMinuteId);
          setMinuteIdInUrl(existingMinuteId);
          if (isDev) await verifyStoredDraft(existingMinuteId, updatePayload);
          return { minuteId: existingMinuteId, updatedAt: returnedUpdatedAt };
        }
        if (isDev) console.error('[MinutesUpdateRPC] Unexpected response:', data);
        toast.error('پاسخ نامعتبر از سرور دریافت شد.');
        return null;
      } catch (error) {
        if (isDev) console.error('[MinutesUpdateRPC] Exception:', error);
        toast.error('خطای غیرمنتظره رخ داد. فرم حفظ شد؛ لطفاً دوباره تلاش کنید.');
        return null;
      } finally {
        setSavingDraft(false);
        persistMinuteRef.current = null;
      }
    })();

    persistMinuteRef.current = update;
    return update;
  };

  const verifyStoredDraft = async (storedMinuteId: string, draftPayload: ReturnType<typeof makeDraftPayload>) => {
    const [{ count: participantCount }, { count: externalCount }, { count: agendaCount }, { data: minuteCheck }] = await Promise.all([
      supabase.from('minutes_participants').select('*', { count: 'exact', head: true }).eq('minute_id', storedMinuteId),
      supabase.from('minutes_external_participants').select('*', { count: 'exact', head: true }).eq('minute_id', storedMinuteId),
      supabase.from('minutes_agenda_results').select('*', { count: 'exact', head: true }).eq('minute_id', storedMinuteId),
      supabase.from('minutes').select('approval_mode, status').eq('id', storedMinuteId).maybeSingle(),
    ]);
    console.log('[MinutesDraftRPC] Verification:', {
      minuteId: storedMinuteId,
      approvalMode: (minuteCheck as { approval_mode: string | null } | null)?.approval_mode,
      status: (minuteCheck as { status: string } | null)?.status,
      participantsStored: participantCount,
      externalStored: externalCount,
      agendaStored: agendaCount,
      participantsInPayload: draftPayload.internal_participants?.length ?? 0,
      externalInPayload: draftPayload.external_participants?.length ?? 0,
      agendaInPayload: draftPayload.agenda_results?.length ?? 0,
    });
    const expectedParticipants = draftPayload.internal_participants?.length ?? 0;
    if (participantCount !== expectedParticipants) {
      console.error('[MinutesDraftRPC] Participant count mismatch:', {
        stored: participantCount,
        expected: expectedParticipants,
      });
      toast.error('تعداد شرکت‌کنندگان ذخیره‌شده با payload همخوانی ندارد.');
    }
  };

  const handleSaveDraft = () => {
    void runExclusiveMinutesAction(async () => {
      if (savingDraft || submitting) return;
      const validationError = validate();
      if (validationError) {
        toast.error(validationError);
        return;
      }
      setSavingDraft(true);
      try {
        const saved = await ensureWorkingMinute({ saveCurrentValues: true });
        if (!saved) return;
        toast.success('پیش‌نویس صورت‌جلسه با موفقیت ذخیره شد.');
        setMinuteIdInUrl(saved.minuteId);
        onNavigate('minutes-detail');
      } catch (error) {
        if (isDev) console.error('[SaveDraft] Exception:', error);
        toast.error('خطای غیرمنتظره رخ داد. فرم حفظ شد؛ لطفاً دوباره تلاش کنید.');
      } finally {
        setSavingDraft(false);
      }
    });
  };

  const handleSubmitForApproval = () => {
    void runExclusiveMinutesAction(async () => {
      if (submitting || savingDraft) return;
      if (!info.approvalMode) {
        toast.error('لطفاً مدل تأیید را انتخاب کنید.');
        return;
      }
      if (info.approvalMode === 'system') {
        const eligibility = checkSystemApproverEligibility(info.approvalMode, internalParticipants);
        if (!eligibility.canSubmit) {
          toast.error(eligibility.errorMessage || 'در مدل سیستمی حداقل یک شرکت‌کننده داخلی با حساب کاربری لازم است.');
          return;
        }
      }

      setSubmitting(true);
      try {
        const saved = await ensureWorkingMinute({ saveCurrentValues: true });
        if (!saved) return;
        const { data, error: rpcError } = await supabase.rpc('submit_minutes_for_approval', {
          p_minute_id: saved.minuteId,
          p_expected_updated_at: saved.updatedAt,
          p_approval_mode: info.approvalMode,
        });
        if (rpcError) {
          console.error('[submit_minutes_for_approval]', {
            code: rpcError?.code,
            message: rpcError?.message,
            details: rpcError?.details,
            hint: rpcError?.hint,
          });
          toast.error('ارسال صورت‌جلسه برای تأیید ناموفق بود.');
          return;
        }
        if (data && data.success === false) {
          const code: string = data.error_code || 'INTERNAL_ERROR';
          toast.error(MINUTES_SUBMIT_ERROR_MESSAGES[code] || 'ارسال صورت‌جلسه برای تأیید ناموفق بود.');
          return;
        }
        if (data && data.success === true) {
          toast.success('صورت‌جلسه برای تأیید ارسال شد.');
          if (data.minute_id) setMinuteIdInUrl(data.minute_id as string);
          onNavigate('minutes-detail');
          return;
        }
        toast.error('پاسخ نامعتبر از سرور دریافت شد.');
      } catch {
        toast.error('خطای غیرمنتظره رخ داد.');
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <MinutesFormView
      mode={mode}
      onNavigate={onNavigate}
      title={title}
      activeSection={activeSection}
      setActiveSection={setActiveSection}
      info={info}
      setInfo={setInfo}
      internalParticipants={internalParticipants}
      setInternalParticipants={setInternalParticipants}
      externalParticipants={externalParticipants}
      setExternalParticipants={setExternalParticipants}
      agendaItems={agendaItems}
      setAgendaItems={setAgendaItems}
      decisions={decisions}
      setDecisions={setDecisions}
      deletedDecisionIds={deletedDecisionIds}
      setDeletedDecisionIds={setDeletedDecisionIds}
      deletedExternalParticipantIds={deletedExternalParticipantIds}
      setDeletedExternalParticipantIds={setDeletedExternalParticipantIds}
      finalization={finalization}
      setFinalization={setFinalization}
      profiles={profiles}
      orgUnits={orgUnits}
      profilesLoading={profilesLoading}
      orgUnitsLoading={orgUnitsLoading}
      profilesError={profilesError}
      orgUnitsError={orgUnitsError}
      agendaLoading={agendaLoading}
      savingDraft={savingDraft}
      externalSuggestions={externalSuggestions}
      prefillLoading={prefillLoading}
      prefillError={prefillError}
      setPrefillAttempt={setPrefillAttempt}
      editMinuteId={editMinuteId}
      workingMinuteId={workingMinuteId}
      editLoading={editLoading}
      editError={editError}
      editNotFound={editNotFound}
      decisionsLoadFailed={decisionsLoadFailed}
      logoUrl={logoUrl}
      docConfig={docConfig}
      submitting={submitting}
      handleSaveDraft={handleSaveDraft}
      handleSubmitForApproval={handleSubmitForApproval}
      payload={payload}
      isDev={isDev}
    />
  );
}