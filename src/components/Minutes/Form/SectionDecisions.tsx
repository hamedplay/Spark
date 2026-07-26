import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, MoreVertical, FilePlus, ArrowRightFromLine } from 'lucide-react';
import type { DraftDecision, ProfileOption, OrgUnitOption, DraftAgendaItem } from './types';
import { defaultDecision } from './defaults';
import { InputField, TextareaField, SelectField } from './fields';
import { PRIORITY_OPTIONS } from './options';
import { SearchableSelect } from './SearchableSelect';
import { JalaliDateField } from './JalaliDateField';

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
  const addIndependent = () =>
    setDecisions(l => [...l, defaultDecision()]);

  const addFromAgenda = (agenda: DraftAgendaItem) =>
    setDecisions(l => [...l, {
      ...defaultDecision(),
      title: agenda.title,
      agendaResultId: agenda.id,
    }]);

  const remove = (id: string) =>
    setDecisions(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftDecision, value: string | number | boolean | null) =>
    setDecisions(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const usersDisabled = profilesLoading || profiles.length === 0 || !!readOnly;
  const orgUnitsDisabled = orgUnitsLoading || orgUnits.length === 0 || !!readOnly;

  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;
  const ownerOptions = profiles.map(p => ({
    value: p.user_id,
    label: profileLabel(p),
    sublabel: p.position || undefined,
  }));

  const agendaOptions = agendaItems.filter(a => a.title.trim());

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        مصوبات و اقدامات
      </h2>
      {readOnly && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
          این صورت‌جلسه در وضعیت قابل ویرایش نیست؛ بخش مصوبات فقط خواندنی است.
        </div>
      )}
      <DecisionsForm
        decisions={decisions}
        setDecisions={setDecisions}
        profiles={profiles}
        profilesLoading={profilesLoading}
        orgUnits={orgUnits}
        orgUnitsLoading={orgUnitsLoading}
        agendaItems={agendaItems}
        readOnly={readOnly}
        addIndependent={addIndependent}
        addFromAgenda={addFromAgenda}
        remove={remove}
        update={update}
        usersDisabled={usersDisabled}
        orgUnitsDisabled={orgUnitsDisabled}
        ownerOptions={ownerOptions}
        agendaOptions={agendaOptions}
      />
    </div>
  );
}

interface DecisionsFormProps extends SectionDecisionsProps {
  addIndependent: () => void;
  addFromAgenda: (agenda: DraftAgendaItem) => void;
  remove: (id: string) => void;
  update: (id: string, field: keyof DraftDecision, value: string | number | boolean | null) => void;
  usersDisabled: boolean;
  orgUnitsDisabled: boolean;
  ownerOptions: { value: string; label: string; sublabel?: string }[];
  agendaOptions: DraftAgendaItem[];
}

function DecisionsForm({
  decisions,
  readOnly,
  addIndependent,
  addFromAgenda,
  remove,
  update,
  orgUnits,
  orgUnitsDisabled,
  usersDisabled,
  ownerOptions,
  agendaOptions,
}: DecisionsFormProps) {
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [showAgendaPicker, setShowAgendaPicker] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuFor) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuFor(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuFor]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        {!readOnly && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpenMenuFor(openMenuFor ? null : 'add')}
              className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Plus className="w-4 h-4" /> افزودن مصوبه
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {openMenuFor === 'add' && (
              <div className="absolute z-30 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg w-56 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setOpenMenuFor(null); setShowAgendaPicker('add'); }}
                  className="w-full text-right px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 dark:text-white"
                >
                  <ArrowRightFromLine className="w-4 h-4 text-blue-500" />
                  تبدیل دستور جلسه به مصوبه
                </button>
                <button
                  type="button"
                  onClick={() => { setOpenMenuFor(null); addIndependent(); }}
                  className="w-full text-right px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 dark:text-white border-t border-gray-100 dark:border-gray-700"
                >
                  <FilePlus className="w-4 h-4 text-green-500" />
                  ثبت مصوبه مستقل
                </button>
              </div>
            )}
            {showAgendaPicker === 'add' && (
              <div className="absolute z-30 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg w-72 max-h-64 overflow-y-auto">
                <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">انتخاب دستور جلسه</div>
                {agendaOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-400 text-center">دستور جلسه‌ای موجود نیست</div>
                ) : (
                  agendaOptions.map((a, idx) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => { setShowAgendaPicker(null); addFromAgenda(a); }}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:text-white truncate"
                    >
                      {idx + 1}. {a.title}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setShowAgendaPicker(null)}
                  className="w-full text-center px-3 py-2 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  بستن
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {decisions.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
          هیچ مصوبه‌ای ثبت نشده است. {!readOnly && 'برای افزودن روی «افزودن مصوبه» کلیک کنید.'}
        </div>
      )}

      {decisions.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">مصوبه {idx + 1}</span>
            {item.agendaResultId && (
              <span className="text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">از دستور جلسه</span>
            )}
            <div className="flex-1" />
            {!readOnly && (
              <button onClick={() => remove(item.id)} aria-label="حذف مصوبه" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <InputField id={`dec-title-${item.id}`} label="عنوان مصوبه" placeholder="عنوان مصوبه را وارد کنید" value={item.title} onChange={v => update(item.id, 'title', v)} />
            </div>
            <div className="sm:col-span-2">
              <TextareaField id={`dec-desc-${item.id}`} label="متن مصوبه" rows={3} value={item.description} onChange={v => update(item.id, 'description', v)} />
            </div>
            {/* Field order: responsible unit → primary owner → start date → due date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">واحد مسئول</label>
              <select
                value={item.responsibleUnitId || ''}
                onChange={e => {
                  const unitId = e.target.value || null;
                  const unit = orgUnits.find(u => u.id === unitId);
                  update(item.id, 'responsibleUnitId', unitId);
                  update(item.id, 'responsibleUnitNameSnapshot', unit?.name || '');
                }}
                disabled={orgUnitsDisabled}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                <option value="">— بدون واحد —</option>
                {orgUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
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
            <div>
              <label htmlFor={`dec-start-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ شروع</label>
              <JalaliDateField
                id={`dec-start-${item.id}`}
                value={item.startDate}
                onChange={v => update(item.id, 'startDate', v)}
                disabled={!!readOnly}
              />
            </div>
            <div>
              <label htmlFor={`dec-due-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مهلت انجام</label>
              <JalaliDateField
                id={`dec-due-${item.id}`}
                value={item.dueDate}
                onChange={v => update(item.id, 'dueDate', v)}
                disabled={!!readOnly}
              />
            </div>
            <SelectField id={`dec-priority-${item.id}`} label="اولویت" options={PRIORITY_OPTIONS} value={item.priority} onChange={v => update(item.id, 'priority', v)} />
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
