import { Plus, Trash2 } from 'lucide-react';
import type { DraftDecision, ProfileOption, OrgUnitOption, DraftAgendaItem } from './types';
import { defaultDecision } from './defaults';
import { InputField, TextareaField, SelectField } from './fields';
import { PRIORITY_OPTIONS } from './options';

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
      />
    </div>
  );
}

function DecisionsForm({
  decisions, setDecisions,
  profiles, profilesLoading,
  orgUnits, orgUnitsLoading,
  agendaItems, readOnly,
}: SectionDecisionsProps) {
  const add = () =>
    setDecisions(l => [...l, defaultDecision()]);

  const remove = (id: string) =>
    setDecisions(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftDecision, value: string | number | boolean | null) =>
    setDecisions(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const usersDisabled = profilesLoading || profiles.length === 0 || !!readOnly;
  const orgUnitsDisabled = orgUnitsLoading || orgUnits.length === 0 || !!readOnly;

  // Agenda results available for linking (only those with a saved title)
  const agendaOptions = agendaItems
    .filter((a) => a.title.trim())
    .map((a, idx) => ({
      value: a.id,
      label: `${idx + 1}. ${a.title}`,
    }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        {!readOnly && (
          <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            <Plus className="w-4 h-4" /> افزودن مصوبه
          </button>
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
              <TextareaField id={`dec-desc-${item.id}`} label="شرح کامل" rows={3} value={item.description} onChange={v => update(item.id, 'description', v)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بند مرتبط</label>
              <select
                value={item.agendaResultId || ''}
                onChange={e => update(item.id, 'agendaResultId', e.target.value || null)}
                disabled={!!readOnly}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                <option value="">— بدون بند —</option>
                {agendaOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <SelectField id={`dec-priority-${item.id}`} label="اولویت" options={PRIORITY_OPTIONS} value={item.priority} onChange={v => update(item.id, 'priority', v)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مسئول اصلی</label>
              <select
                value={item.primaryOwnerUserId}
                onChange={e => update(item.id, 'primaryOwnerUserId', e.target.value)}
                disabled={usersDisabled}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                <option value="">— انتخاب —</option>
                {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
              </select>
            </div>
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
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                <option value="">— بدون واحد —</option>
                {orgUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <InputField id={`dec-start-${item.id}`} label="تاریخ شروع" placeholder="۱۴۰۳/۰۵/۱۵" value={item.startDate} onChange={v => update(item.id, 'startDate', v)} />
            <InputField id={`dec-due-${item.id}`} label="مهلت انجام" placeholder="۱۴۰۳/۰۶/۱۰" value={item.dueDate} onChange={v => update(item.id, 'dueDate', v)} />
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
