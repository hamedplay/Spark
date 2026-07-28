import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  DraftInternalParticipant,
  DraftExternalParticipant,
  ProfileOption,
  OrgUnitOption,
  InvitationStatus,
} from './types';
import { defaultInternalParticipant, defaultExternalParticipant } from './defaults';
import { InputField, SelectField, ErrorState, LoadingRow, EmptyState } from './fields';
import { INVITATION_OPTIONS, ATTENDANCE_OPTIONS_WITH_NULL } from './options';
import { ComboboxInput, type ComboboxOption } from './ComboboxInput';
import { normalizeName } from './normalizeName';

export interface ExternalParticipantSuggestion {
  full_name: string;
  organization: string | null;
  position: string | null;
}

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
  invitationStatusReadOnly?: boolean;
  readOnly?: boolean;
  externalSuggestions?: ExternalParticipantSuggestion[];
}

const INVITATION_LABELS: Record<InvitationStatus, string> = {
  invited: 'دعوت شده',
  accepted: 'دعوت را پذیرفته است',
  declined: 'دعوت را رد کرده است',
  no_response: 'بدون پاسخ',
  pending: 'در انتظار پاسخ',
  delegated: 'جانشین معرفی کرده است',
};

const INVITATION_BADGE_CLASSES: Record<InvitationStatus, string> = {
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  delegated: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  invited: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300',
  no_response: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

function InvitationBadge({ status }: { status: InvitationStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${INVITATION_BADGE_CLASSES[status]}`}>
      {INVITATION_LABELS[status]}
    </span>
  );
}

export function SectionParticipants({
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
  invitationStatusReadOnly = false,
  readOnly = false,
  externalSuggestions = [],
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
      nameSnapshot: p ? (p.full_name || p.username || '') : '',
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

  // Deduplicate external participant suggestions by normalized full name.
  const externalSuggestionOptions: ComboboxOption[] = useMemo(() => {
    const seen = new Set<string>();
    const opts: ComboboxOption[] = [];
    for (const s of externalSuggestions) {
      const name = (s.full_name || '').trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = [s.organization, s.position].filter(Boolean).join(' — ') || undefined;
      opts.push({ value: name, label: name, sublabel: sub });
    }
    return opts;
  }, [externalSuggestions]);

  const handleExternalNameSelect = (rowId: string, opt: ComboboxOption) => {
    // Check for duplicate by normalized name — prevent adding the same person twice.
    const key = normalizeName(opt.label);
    const exists = externalParticipants.some(r => r.id !== rowId && normalizeName(r.fullName) === key);
    if (exists) {
      toast.error('این فرد قبلاً به لیست شرکت‌کنندگان خارجی اضافه شده است.');
      return;
    }
    // Parse sublabel "organization — position" back into fields if present.
    const subParts = opt.sublabel ? opt.sublabel.split(' — ') : [];
    setExternalParticipants(l => l.map(r => r.id === rowId ? {
      ...r,
      fullName: opt.label,
      organization: subParts[0] || r.organization,
      position: subParts[1] || r.position,
    } : r));
  };

  const handleExternalNameChange = (rowId: string, value: string) => {
    // Check for duplicate when typing a name that matches an existing entry.
    const key = normalizeName(value);
    const exists = externalParticipants.some(r => r.id !== rowId && normalizeName(r.fullName) === key && value.trim().length > 0);
    if (exists) {
      toast.error('این فرد قبلاً به لیست شرکت‌کنندگان خارجی اضافه شده است.');
      return;
    }
    updateExternal(rowId, 'fullName', value);
  };

  const profileLabel = (p: ProfileOption) => p.full_name || p.username || p.user_id;

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
          {!readOnly && (
            <button
              onClick={addInternal}
              disabled={usersDisabled}
              className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> افزودن
            </button>
          )}
        </div>
        {profilesError && <ErrorState message={profilesError} />}
        {!profilesError && profilesLoading ? (
          <LoadingRow label="در حال بارگذاری کاربران..." />
        ) : !profilesError && internalParticipants.length === 0 ? (
          <EmptyState message="شرکت‌کننده داخلی برای این جلسه ثبت نشده است." />
        ) : (
        <div className="space-y-3">
          {internalParticipants.map(row => (
            <div key={row.id} className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {/* User selector */}
                <div>
                  <label htmlFor={`int-user-${row.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">کاربر</label>
                  <select
                    id={`int-user-${row.id}`}
                    value={row.userId}
                    onChange={e => handleInternalUserChange(row.id, e.target.value)}
                    disabled={readOnly}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">انتخاب کنید</option>
                    {profiles.map(p => (
                      <option key={p.user_id} value={p.user_id}>
                        {profileLabel(p)}{p.position ? ` — ${p.position}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Position snapshot */}
                <InputField id={`int-pos-${row.id}`} label="سمت" placeholder="سمت" value={row.positionSnapshot} onChange={v => updateInternal(row.id, 'positionSnapshot', v)} />
                {/* Org unit selector */}
                <div>
                  <label htmlFor={`int-unit-${row.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">واحد</label>
                  <select
                    id={`int-unit-${row.id}`}
                    value={row.orgUnitId}
                    onChange={e => handleInternalOrgUnitChange(row.id, e.target.value)}
                    disabled={orgUnitsDisabled || readOnly}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <option value="">انتخاب کنید</option>
                    {orgUnits.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                {/* Invitation status — read-only badge or disabled select */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">وضعیت دعوت</label>
                  {invitationStatusReadOnly ? (
                    <div className="px-3 py-2">
                      <InvitationBadge status={row.invitationStatus} />
                    </div>
                  ) : (
                    <SelectField id={`int-inv-${row.id}`} label="وضعیت دعوت" options={INVITATION_OPTIONS} value={row.invitationStatus} onChange={v => updateInternal(row.id, 'invitationStatus', v)} disabled={readOnly} />
                  )}
                </div>
                {/* Attendance status */}
                <SelectField id={`int-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS_WITH_NULL} value={row.attendanceStatus ?? ''} onChange={v => updateInternal(row.id, 'attendanceStatus', v)} disabled={readOnly} />
                {/* Remove */}
                {!readOnly && (
                  <div className="flex items-end">
                    <button
                      onClick={() => removeInternal(row.id)}
                      aria-label="حذف ردیف"
                      className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {/* Delegate display */}
              {row.delegateName && (
                <div className="text-xs text-orange-600 dark:text-orange-400 px-1">
                  جانشین: {row.delegateName}
                </div>
              )}
              {/* Notes */}
              <InputField id={`int-notes-${row.id}`} label="یادداشت" placeholder="یادداشت اختیاری" value={row.notes} onChange={v => updateInternal(row.id, 'notes', v)} />
            </div>
          ))}
        </div>
        )}
      </div>

      {/* External participants */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">افراد خارج از سازمان</h3>
          {!readOnly && (
            <button
              onClick={addExternal}
              className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> افزودن
            </button>
          )}
        </div>
        {externalParticipants.length === 0 ? (
          <EmptyState message="فرد خارج از سازمان برای این جلسه ثبت نشده است." />
        ) : (
        <div className="space-y-3">
          {externalParticipants.map(row => (
            <div key={row.id} className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div>
                  <label htmlFor={`ext-name-${row.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نام و نام خانوادگی</label>
                  <ComboboxInput
                    id={`ext-name-${row.id}`}
                    value={row.fullName}
                    options={externalSuggestionOptions}
                    onChange={v => handleExternalNameChange(row.id, v)}
                    onSelect={opt => handleExternalNameSelect(row.id, opt)}
                    placeholder=""
                    searchPlaceholder="جستجوی افراد خارج از سازمان..."
                    emptyText="فردی یافت نشد"
                    disabled={readOnly}
                    useLabelAsValue
                  />
                </div>
                <InputField id={`ext-org-${row.id}`} label="سازمان" placeholder="" value={row.organization} onChange={v => updateExternal(row.id, 'organization', v)} />
                <InputField id={`ext-pos-${row.id}`} label="سمت" placeholder="" value={row.position} onChange={v => updateExternal(row.id, 'position', v)} />
                <SelectField id={`ext-inv-${row.id}`} label="وضعیت دعوت" options={INVITATION_OPTIONS} value={row.invitationStatus} onChange={v => updateExternal(row.id, 'invitationStatus', v)} disabled={readOnly} />
                <SelectField id={`ext-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS_WITH_NULL} value={row.attendanceStatus ?? ''} onChange={v => updateExternal(row.id, 'attendanceStatus', v)} disabled={readOnly} />
                <div className="lg:col-span-5">
                  <InputField id={`ext-notes-${row.id}`} label="یادداشت" placeholder="یادداشت اختیاری" value={row.notes} onChange={v => updateExternal(row.id, 'notes', v)} />
                </div>
                {!readOnly && (
                  <div className="flex items-end">
                    <button
                      onClick={() => removeExternal(row.id)}
                      aria-label="حذف ردیف"
                      className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
