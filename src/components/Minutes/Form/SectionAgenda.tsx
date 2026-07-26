import { Plus, Trash2, GripVertical } from 'lucide-react';
import type { DraftAgendaItem, DraftInternalParticipant, DraftExternalParticipant } from './types';
import { defaultAgendaItem } from './defaults';
import { InputField, TextareaField, LoadingRow, EmptyState } from './fields';
import { SearchableSelect, type SearchableOption } from './SearchableSelect';

interface SectionAgendaProps {
  agendaItems: DraftAgendaItem[];
  setAgendaItems: React.Dispatch<React.SetStateAction<DraftAgendaItem[]>>;
  agendaLoading: boolean;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
}

export function SectionAgenda({
  agendaItems, setAgendaItems, agendaLoading,
  internalParticipants, externalParticipants,
}: SectionAgendaProps) {
  const add = () =>
    setAgendaItems(l => [...l, defaultAgendaItem(l.length + 1)]);

  const remove = (id: string) =>
    setAgendaItems(l => l.filter(r => r.id !== id));

  const update = (id: string, field: keyof DraftAgendaItem, value: string) =>
    setAgendaItems(l => l.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  // Presenter options: internal participants (by name snapshot) + external participants
  const presenterOptions: SearchableOption[] = [
    ...internalParticipants
      .filter(p => !!p.nameSnapshot)
      .map(p => ({
        value: p.nameSnapshot,
        label: p.nameSnapshot,
        sublabel: [p.positionSnapshot, p.orgUnitNameSnapshot].filter(Boolean).join(' — '),
      })),
    ...externalParticipants
      .filter(p => !!p.fullName)
      .map(p => ({
        value: p.fullName,
        label: p.fullName,
        sublabel: [p.organization, p.position].filter(Boolean).join(' — '),
      })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">دستور جلسات</h2>
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
              <div>
                <label htmlFor={`ag-presenter-${item.id}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ارائه‌دهنده</label>
                <SearchableSelect
                  id={`ag-presenter-${item.id}`}
                  value={item.presenter}
                  options={presenterOptions}
                  onChange={v => update(item.id, 'presenter', v)}
                  placeholder="انتخاب ارائه‌دهنده"
                  searchPlaceholder="جستجو بر اساس نام..."
                  emptyText="موردی یافت نشد"
                />
              </div>
              <InputField id={`ag-time-${item.id}`} label="زمان اختصاص‌یافته (دقیقه)" placeholder="30" value={item.allocatedTime} onChange={v => update(item.id, 'allocatedTime', v)} />
            </div>
          </div>
        </div>
      ))
      )}
    </div>
  );
}
