import { CircleAlert as AlertCircle, Loader as Loader2, Lock } from 'lucide-react';
import { ConfidentialityBadge } from '../MinutesShared';
import type { ConfidentialityLevel, ApprovalMode } from '../types';
import type { DraftMeetingInfo, ProfileOption, OrgUnitOption, DraftInternalParticipant } from './types';
import { LoadingSelect, ErrorState, EmptyState } from './fields';
import { SearchableSelect } from './SearchableSelect';

interface SectionInfoProps {
  info: DraftMeetingInfo;
  setInfo: React.Dispatch<React.SetStateAction<DraftMeetingInfo>>;
  profiles: ProfileOption[];
  profilesLoading: boolean;
  profilesError: string | null;
  orgUnits: OrgUnitOption[];
  orgUnitsLoading: boolean;
  orgUnitsError: string | null;
  prefillLoading: boolean;
  prefillError: string | null;
  isMeetingPrefilled: boolean;
  agendaLoading: boolean;
  internalParticipants: DraftInternalParticipant[];
}

export function SectionInfo({
  info, setInfo,
  profiles, profilesLoading, profilesError,
  orgUnits, orgUnitsLoading, orgUnitsError,
  prefillLoading, prefillError, isMeetingPrefilled, agendaLoading,
  internalParticipants,
}: SectionInfoProps) {
  const update = (field: keyof DraftMeetingInfo, value: string) =>
    setInfo(prev => ({ ...prev, [field]: value }));

  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;

  // Build secretary/chair options limited to internal participants of this meeting
  const participantProfileOptions = internalParticipants
    .filter(p => !!p.userId)
    .map(p => {
      const profile = profiles.find(x => x.user_id === p.userId);
      const label = profile ? profileLabel(profile) : (p.nameSnapshot || p.userId);
      const sublabelParts: string[] = [];
      if (profile?.position) sublabelParts.push(profile.position);
      if (p.orgUnitNameSnapshot) sublabelParts.push(p.orgUnitNameSnapshot);
      return { value: p.userId, label, sublabel: sublabelParts.join(' — ') };
    });

  const handleSecretaryChange = (userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    const part = internalParticipants.find(x => x.userId === userId);
    setInfo(prev => ({
      ...prev,
      secretaryUserId: userId,
      secretaryNameSnapshot: p ? profileLabel(p) : (part?.nameSnapshot || ''),
    }));
  };

  const handleChairChange = (userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    const part = internalParticipants.find(x => x.userId === userId);
    setInfo(prev => ({
      ...prev,
      chairUserId: userId,
      chairNameSnapshot: p ? profileLabel(p) : (part?.nameSnapshot || ''),
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

  // Prefilled meeting fields (title, date, times, location) are read-only in new mode
  const readOnly = isMeetingPrefilled;
  const readOnlyClass = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:text-gray-300 cursor-not-allowed';

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        اطلاعات جلسه
      </h2>

      {/* Prefill status hint */}
      {prefillLoading && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-700 dark:text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          در حال بارگذاری اطلاعات جلسه از تقویم...
        </div>
      )}
      {prefillError && (
        <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {prefillError}
        </div>
      )}
      {readOnly && !prefillLoading && !prefillError && (
        <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-sm text-emerald-700 dark:text-emerald-300">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          اطلاعات این جلسه از تقویم بارگذاری شده و فقط‌خواندنی است. موضوع، تاریخ، ساعت‌ها و محل برگزاری در صورت‌جلسه ذخیره می‌شوند.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            عنوان جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="meeting-title"
            type="text"
            value={info.meetingTitle}
            onChange={readOnly ? undefined : e => update('meetingTitle', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? readOnlyClass : 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white'}
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
            onChange={readOnly ? undefined : e => update('meetingDate', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? readOnlyClass : 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white'}
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
            onChange={readOnly ? undefined : e => update('startTime', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? readOnlyClass : 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white'}
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
            onChange={readOnly ? undefined : e => update('endTime', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? readOnlyClass : 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white'}
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
            onChange={readOnly ? undefined : e => update('location', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? readOnlyClass : 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white'}
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

        {/* Secretary selector — limited to internal participants */}
        <div>
          <label htmlFor="secretary" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            دبیر جلسه <span className="text-red-500">*</span>
          </label>
          {profilesLoading ? (
            <LoadingSelect label="در حال بارگذاری کاربران..." />
          ) : profilesError ? (
            <ErrorState message={profilesError} />
          ) : participantProfileOptions.length === 0 ? (
            <EmptyState message="ابتدا شرکت‌کنندگان داخلی را اضافه کنید." />
          ) : (
            <SearchableSelect
              id="secretary"
              value={info.secretaryUserId}
              options={participantProfileOptions}
              onChange={handleSecretaryChange}
              placeholder="انتخاب دبیر از شرکت‌کنندگان"
              searchPlaceholder="جستجو بر اساس نام، سمت یا واحد..."
              emptyText="شرکت‌کننده‌ای یافت نشد"
            />
          )}
        </div>

        {/* Chair selector — limited to internal participants */}
        <div>
          <label htmlFor="chair" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            رئیس جلسه <span className="text-red-500">*</span>
          </label>
          {profilesLoading ? (
            <LoadingSelect label="در حال بارگذاری کاربران..." />
          ) : profilesError ? (
            <ErrorState message={profilesError} />
          ) : participantProfileOptions.length === 0 ? (
            <EmptyState message="ابتدا شرکت‌کنندگان داخلی را اضافه کنید." />
          ) : (
            <SearchableSelect
              id="chair"
              value={info.chairUserId}
              options={participantProfileOptions}
              onChange={handleChairChange}
              placeholder="انتخاب رئیس از شرکت‌کنندگان"
              searchPlaceholder="جستجو بر اساس نام، سمت یا واحد..."
              emptyText="شرکت‌کننده‌ای یافت نشد"
            />
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

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            مدل تأیید
          </label>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <select
                value={info.approvalMode}
                disabled={!!info.submittedAt || info.status !== 'draft'}
                onChange={e => setInfo(prev => ({ ...prev, approvalMode: e.target.value as ApprovalMode | '' }))}
                className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">انتخاب کنید</option>
                <option value="system">تأیید سیستمی</option>
                <option value="in_person">تأیید حضوری</option>
              </select>
              {(!!info.submittedAt || info.status !== 'draft') && (
                <span className="text-xs text-gray-400">غیرقابل تغییر پس از ارسال</span>
              )}
            </div>
            {info.approvalMode === 'system' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                در تأیید سیستمی، صورت‌جلسه برای تمام شرکت‌کنندگان داخلی دارای حساب سامانه به‌صورت خودکار ارسال می‌شود. حضور در جلسه شرط افزودن به تأییدکنندگان نیست. پس از تأیید همه، تأیید دبیر و سپس رئیس جلسه برای انتشار لازم است.
              </p>
            )}
            {info.approvalMode === 'in_person' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                در تأیید حضوری، تأیید شرکت‌کنندگان سیستمی وجود ندارد. دبیر تأیید می‌کند که صورت‌جلسه در جلسه حضوری تأیید شده، سپس رئیس جلسه آن را منتشر می‌کند.
              </p>
            )}
          </div>
        </div>
      </div>
      {agendaLoading && (
        <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          در حال بارگذاری دستور جلسات...
        </p>
      )}
    </div>
  );
}
