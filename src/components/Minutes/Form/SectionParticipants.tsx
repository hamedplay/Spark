import { Plus, Trash2 } from 'lucide-react';
import type { DraftInternalParticipant, DraftExternalParticipant, ProfileOption, OrgUnitOption } from './types';
import { defaultInternalParticipant, defaultExternalParticipant } from './defaults';
import { InputField, SelectField, ErrorState, LoadingRow, EmptyState } from './fields';
import { INVITATION_OPTIONS, ATTENDANCE_OPTIONS_WITH_NULL } from './options';

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
              <SelectField id={`int-inv-${row.id}`} label="وضعیت دعوت" options={INVITATION_OPTIONS} value={row.invitationStatus} onChange={v => updateInternal(row.id, 'invitationStatus', v)} disabled={invitationStatusReadOnly} />
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
