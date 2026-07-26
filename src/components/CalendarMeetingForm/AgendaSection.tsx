import { ClipboardList, UserCheck, Clock, Pencil, Trash2, Check, Plus } from 'lucide-react';
import type { AgendaItem } from '../../types';

export function AgendaSection(props: {
  agendaEnabled: boolean;
  setAgendaEnabled: (fn: (v: boolean) => boolean) => void;
  agendaItems: AgendaItem[];
  setAgendaItems: React.Dispatch<React.SetStateAction<AgendaItem[]>>;
  showAgendaForm: boolean;
  setShowAgendaForm: (v: boolean) => void;
  agendaForm: { title: string; presenter: string; duration_minutes: string };
  setAgendaForm: React.Dispatch<React.SetStateAction<{ title: string; presenter: string; duration_minutes: string }>>;
  editingAgendaIdx: number | null;
  setEditingAgendaIdx: (v: number | null) => void;
  prefillMeetingId: string | null;
  participantDisplayItems: { id: string; name: string }[];
  selectedExternal: string[];
}) {
  const {
    agendaEnabled, setAgendaEnabled, agendaItems, setAgendaItems,
    showAgendaForm, setShowAgendaForm, agendaForm, setAgendaForm,
    editingAgendaIdx, setEditingAgendaIdx, prefillMeetingId,
    participantDisplayItems, selectedExternal,
  } = props;

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600">
      <div className="flex items-center gap-2 mb-2">
        <input type="checkbox" id="calAgenda" checked={agendaEnabled} onChange={e => setAgendaEnabled(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
        <label htmlFor="calAgenda" className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />دستور جلسه
        </label>
      </div>
      {agendaEnabled && (
        <div className="space-y-2 mt-3">
          {agendaItems.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
              <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {item.presenter && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <UserCheck className="w-3 h-3" />{item.presenter}
                    </span>
                  )}
                  {item.duration_minutes && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <Clock className="w-3 h-3" />{item.duration_minutes} دقیقه
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button type="button" onClick={() => { setAgendaForm({ title: item.title, presenter: item.presenter || '', duration_minutes: item.duration_minutes ? String(item.duration_minutes) : '' }); setEditingAgendaIdx(idx); setShowAgendaForm(true); }}
                  className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setAgendaItems(prev => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {showAgendaForm ? (
            <div className="p-3 bg-white dark:bg-gray-700 rounded-lg border border-blue-200 dark:border-blue-700 space-y-2">
              <input type="text" value={agendaForm.title} onChange={e => setAgendaForm(f => ({ ...f, title: e.target.value }))}
                placeholder="عنوان آیتم دستور جلسه *"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">ارائه‌دهنده</label>
                  <select value={agendaForm.presenter} onChange={e => setAgendaForm(f => ({ ...f, presenter: e.target.value }))}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm">
                    <option value="">بدون ارائه‌دهنده</option>
                    {participantDisplayItems.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                    {selectedExternal.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">مدت (دقیقه)</label>
                  <input type="number" min="1" value={agendaForm.duration_minutes} onChange={e => setAgendaForm(f => ({ ...f, duration_minutes: e.target.value }))}
                    placeholder="مثلاً ۱۵"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => {
                    if (!agendaForm.title.trim()) return;
                    const newItem: AgendaItem = {
                      id: crypto.randomUUID(),
                      meeting_id: prefillMeetingId || '',
                      title: agendaForm.title.trim(),
                      presenter: agendaForm.presenter || null,
                      duration_minutes: agendaForm.duration_minutes ? Number(agendaForm.duration_minutes) : null,
                      sort_order: editingAgendaIdx !== null ? editingAgendaIdx : agendaItems.length,
                    };
                    if (editingAgendaIdx !== null) {
                      setAgendaItems(prev => prev.map((it, i) => i === editingAgendaIdx ? newItem : it));
                    } else {
                      setAgendaItems(prev => [...prev, newItem]);
                    }
                    setAgendaForm({ title: '', presenter: '', duration_minutes: '' });
                    setEditingAgendaIdx(null);
                    setShowAgendaForm(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors">
                  <Check className="w-3.5 h-3.5" />{editingAgendaIdx !== null ? 'ویرایش' : 'افزودن'}
                </button>
                <button type="button" onClick={() => { setShowAgendaForm(false); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); setEditingAgendaIdx(null); }}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                  انصراف
                </button>
              </div>
            </div>
          ) : (
            <button type="button"
              onClick={() => { setShowAgendaForm(true); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
              <Plus className="w-4 h-4" />افزودن آیتم دستور جلسه
            </button>
          )}
        </div>
      )}
    </div>
  );
}
