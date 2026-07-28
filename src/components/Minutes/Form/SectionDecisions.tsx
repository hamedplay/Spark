import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, Trash2, Link2, Unlink, ListChecks } from 'lucide-react';
import type { DraftDecision, ProfileOption, OrgUnitOption, DraftAgendaItem } from './types';
import { defaultDecision } from './defaults';
import { TextareaField, SelectField } from './fields';
import { PRIORITY_OPTIONS, AGENDA_RESULT_OPTIONS } from './options';
import { SearchableSelect } from './SearchableSelect';
import { ComboboxInput } from './ComboboxInput';
import { JalaliDatePicker } from './JalaliDatePicker';
import { isDueBeforeStart } from '../../../lib/minutesDate';

interface SectionDecisionsProps {
  decisions: DraftDecision[];
  setDecisions: React.Dispatch<React.SetStateAction<DraftDecision[]>>;
  profiles: ProfileOption[];
  profilesLoading: boolean;
  orgUnits: OrgUnitOption[];
  orgUnitsLoading: boolean;
  agendaItems: DraftAgendaItem[];
  readOnly?: boolean;
}

export function SectionDecisions({
  decisions, setDecisions,
  profiles, profilesLoading,
  orgUnits, orgUnitsLoading,
  agendaItems, readOnly,
}: SectionDecisionsProps) {
  const [openAgendaPickerFor, setOpenAgendaPickerFor] = useState<string | null>(null);
  const [openTitlePickerFor, setOpenTitlePickerFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const addIndependent = () =>
    setDecisions(l => [...l, defaultDecision()]);

  const remove = (id: string) =>
    setDecisions(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftDecision, value: string | number | boolean | null) =>
    setDecisions(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const usersDisabled = profilesLoading || profiles.length === 0 || !!readOnly;
  const orgUnitsDisabled = orgUnitsLoading || !!readOnly;

  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;
  const ownerOptions = profiles.map(p => ({
    value: p.user_id,
    label: profileLabel(p),
    sublabel: p.position || undefined,
  }));

  // Agenda items that have a real meeting_agenda_item_id (for linking).
  const agendaLinkOptions = useMemo(() => {
    const seen = new Set<string>();
    return agendaItems
      .filter(a => a.title.trim() && a.meetingAgendaItemId)
      .filter(a => {
        if (seen.has(a.meetingAgendaItemId)) return false;
        seen.add(a.meetingAgendaItemId);
        return true;
      })
      .map(a => ({
        value: a.meetingAgendaItemId,
        label: a.title,
        sublabel: [a.presenter, a.description].filter(Boolean).join(' — ') || undefined,
      }));
  }, [agendaItems]);

  // All agenda items with a title (for title-only picker). Preserves original order.
  const agendaTitleOptions = useMemo(() =>
    agendaItems
      .filter(a => a.title.trim())
      .map(a => ({
        value: a.id,
        label: a.title,
        sublabel: [a.presenter, a.description].filter(Boolean).join(' — ') || undefined,
      })),
  [agendaItems]);

  const linkToAgenda = (decisionId: string, meetingAgendaItemId: string) => {
    const agenda = agendaItems.find(a => a.meetingAgendaItemId === meetingAgendaItemId);
    if (!agenda) return;
    setDecisions(l => l.map(d =>
      d.id === decisionId
        ? { ...d, meetingAgendaItemId, title: d.title.trim() ? d.title : agenda.title }
        : d
    ));
    setOpenAgendaPickerFor(null);
  };

  const clearAgendaLink = (decisionId: string) =>
    setDecisions(l => l.map(d =>
      d.id === decisionId ? { ...d, meetingAgendaItemId: null } : d
    ));

  // Title-only picker: copies just the agenda title into item.title.
  // Does NOT set meetingAgendaItemId or agendaResultId.
  const pickAgendaTitle = (decisionId: string, title: string) => {
    update(decisionId, 'title', title);
    setOpenTitlePickerFor(null);
  };

  // Per-decision validation errors for the Jalali date fields.
  const dateErrors = useMemo(() => {
    const errs: Record<string, { due?: string }> = {};
    for (const d of decisions) {
      if (d.startDate && d.dueDate && isDueBeforeStart(d.startDate, d.dueDate)) {
        errs[d.id] = { due: 'مهلت انجام نمی‌تواند قبل از تاریخ شروع باشد.' };
      }
    }
    return errs;
  }, [decisions]);

  useEffect(() => {
    if (!openAgendaPickerFor && !openTitlePickerFor) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenAgendaPickerFor(null);
        setOpenTitlePickerFor(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openAgendaPickerFor, openTitlePickerFor]);

  // Responsible unit options with legacy fallback for deleted units.
  const buildResponsibleUnitOptions = (item: DraftDecision) => {
    const opts = orgUnits.map(u => ({ value: u.id, label: u.name }));
    if (item.responsibleUnitId && !orgUnits.some(u => u.id === item.responsibleUnitId)) {
      opts.push({ value: item.responsibleUnitId, label: item.responsibleUnitNameSnapshot || 'واحد حذفشده' });
    }
    return opts;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={addIndependent}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> افزودن مصوبه
          </button>
        )}
      </div>

      {readOnly && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
          این صورت‌جلسه در وضعیت قابل ویرایش نیست؛ بخش مصوبات فقط خواندنی است.
        </div>
      )}

      {decisions.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
          هیچ مصوبه‌ای ثبت نشده است. {!readOnly && 'برای افزودن روی «افزودن مصوبه» کلیک کنید.'}
        </div>
      )}

      {decisions.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 rounded-t-2xl">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">مصوبه {idx + 1}</span>
            {item.meetingAgendaItemId && (
              <span className="text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">از دستور جلسه</span>
            )}
            <div className="flex-1" />
            {!readOnly && (
              <button onClick={() => remove(item.id)} aria-label="حذف مصوبه" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-b-2xl">
            {/* 1. Title with agenda link + title-only picker */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان مصوبه</label>
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                {/* Input + title-only picker icon as one unit */}
                <div className="relative flex-1 min-w-0">
                  <input
                    id={`dec-title-${item.id}`}
                    type="text"
                    placeholder="عنوان مصوبه را وارد کنید"
                    value={item.title}
                    onChange={e => update(item.id, 'title', e.target.value)}
                    disabled={!!readOnly}
                    className="w-full px-3 py-2.5 pe-11 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setOpenTitlePickerFor(openTitlePickerFor === item.id ? null : item.id)}
                      aria-label="انتخاب عنوان از دستور جلسات"
                      title="انتخاب عنوان از دستور جلسات"
                      className="absolute inset-y-0 end-0 w-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      <ListChecks className="w-4 h-4" />
                    </button>
                  )}
                  {openTitlePickerFor === item.id && (
                    <div className="absolute z-50 mt-1 end-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg w-72 max-w-[calc(100vw-2rem)]" ref={menuRef}>
                      {agendaTitleOptions.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-400 text-center">
                          دستور جلسه‌ای برای این جلسه ثبت نشده است.
                        </div>
                      ) : (
                        <ComboboxInput
                          id={`dec-title-picker-${item.id}`}
                          value=""
                          options={agendaTitleOptions}
                          onChange={() => {}}
                          onSelect={opt => pickAgendaTitle(item.id, opt.label)}
                          searchPlaceholder="جستجوی دستور جلسه..."
                          emptyText="دستور جلسه‌ای یافت نشد"
                          useLabelAsValue
                        />
                      )}
                    </div>
                  )}
                </div>
                {/* Real agenda link button — wraps to next row on narrow screens */}
                {!readOnly && agendaLinkOptions.length > 0 && (
                  <div className="relative shrink-0">
                    {item.meetingAgendaItemId ? (
                      <button
                        type="button"
                        onClick={() => clearAgendaLink(item.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors whitespace-nowrap"
                      >
                        <Unlink className="w-4 h-4" />
                        <span className="hidden sm:inline">پاک‌کردن ارتباط</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenAgendaPickerFor(openAgendaPickerFor === item.id ? null : item.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-xl transition-colors whitespace-nowrap"
                      >
                        <Link2 className="w-4 h-4" />
                        <span className="hidden sm:inline">انتخاب از دستور جلسه</span>
                      </button>
                    )}
                    {openAgendaPickerFor === item.id && (
                      <div className="absolute z-50 mt-1 end-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg w-72 max-w-[calc(100vw-2rem)]" ref={menuRef}>
                        <SearchableSelect
                          id={`dec-agenda-${item.id}`}
                          value={item.meetingAgendaItemId || ''}
                          options={agendaLinkOptions}
                          onChange={v => linkToAgenda(item.id, v)}
                          placeholder="انتخاب دستور جلسه"
                          searchPlaceholder="جستجوی دستور جلسه..."
                          emptyText="دستور جلسه‌ای یافت نشد"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* 2. Description */}
            <div className="sm:col-span-2">
              <TextareaField id={`dec-desc-${item.id}`} label="متن مصوبه" rows={3} value={item.description} onChange={v => update(item.id, 'description', v)} />
            </div>
            {/* 3. Responsible unit — searchable select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">واحد مسئول</label>
              {orgUnitsDisabled && orgUnits.length === 0 ? (
                <div className="px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">در حال بارگذاری...</div>
              ) : (
                <SearchableSelect
                  id={`dec-unit-${item.id}`}
                  value={item.responsibleUnitId || ''}
                  options={buildResponsibleUnitOptions(item)}
                  onChange={v => {
                    const unitId = v || null;
                    const unit = orgUnits.find(u => u.id === unitId);
                    update(item.id, 'responsibleUnitId', unitId);
                    update(item.id, 'responsibleUnitNameSnapshot', unit?.name || '');
                  }}
                  placeholder="— بدون واحد —"
                  searchPlaceholder="جستجوی واحد سازمانی..."
                  emptyText="واحدی یافت نشد"
                  disabled={!!readOnly}
                />
              )}
            </div>
            {/* 4. Primary owner */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مسئول اصلی <span className="text-red-500">*</span></label>
              {usersDisabled ? (
                <div className="px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">در حال بارگذاری...</div>
              ) : (
                <SearchableSelect
                  id={`dec-owner-${item.id}`}
                  value={item.primaryOwnerUserId}
                  options={ownerOptions}
                  onChange={v => update(item.id, 'primaryOwnerUserId', v)}
                  placeholder="انتخاب مسئول اصلی"
                  searchPlaceholder="جستجو بر اساس نام یا سمت..."
                  emptyText="کاربری یافت نشد"
                />
              )}
            </div>
            {/* 5. Start date */}
            <div>
              <label htmlFor={`dec-start-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ شروع</label>
              <JalaliDatePicker
                id={`dec-start-${item.id}`}
                value={item.startDate || null}
                onChange={v => update(item.id, 'startDate', v ?? '')}
                disabled={!!readOnly}
                placeholder="انتخاب تاریخ شروع"
              />
            </div>
            {/* 6. Due date */}
            <div>
              <label htmlFor={`dec-due-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مهلت انجام</label>
              <JalaliDatePicker
                id={`dec-due-${item.id}`}
                value={item.dueDate || null}
                onChange={v => update(item.id, 'dueDate', v ?? '')}
                disabled={!!readOnly}
                minDate={item.startDate || null}
                placeholder="انتخاب مهلت انجام"
                error={dateErrors[item.id]?.due}
              />
            </div>
            {/* 7. Priority */}
            <SelectField id={`dec-priority-${item.id}`} label="اولویت" options={PRIORITY_OPTIONS} value={item.priority} onChange={v => update(item.id, 'priority', v)} disabled={!!readOnly} />
            {/* 8. Discussion result */}
            <div className="sm:col-span-2">
              <TextareaField id={`dec-discussion-${item.id}`} label="نتیجه بحث" rows={2} value={item.discussionResult} onChange={v => update(item.id, 'discussionResult', v)} />
            </div>
            {/* 9. Result type */}
            <SelectField id={`dec-result-type-${item.id}`} label="نوع نتیجه" options={AGENDA_RESULT_OPTIONS} value={item.resultType} onChange={v => update(item.id, 'resultType', v)} disabled={!!readOnly} />
            {/* 10. Additional notes */}
            <div className="sm:col-span-2">
              <TextareaField id={`dec-additional-${item.id}`} label="توضیحات تکمیلی" rows={2} value={item.additionalNotes} onChange={v => update(item.id, 'additionalNotes', v)} />
            </div>
            {/* 11. Requires followup */}
            <div className="sm:col-span-2 flex items-center gap-3">
              <label htmlFor={`dec-followup-${item.id}`} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  id={`dec-followup-${item.id}`}
                  type="checkbox"
                  checked={item.requiresFollowup}
                  onChange={e => update(item.id, 'requiresFollowup', e.target.checked)}
                  disabled={!!readOnly}
                  className="w-4 h-4 rounded accent-blue-600 disabled:opacity-60"
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
