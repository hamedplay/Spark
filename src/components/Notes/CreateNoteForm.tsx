import { Save, Mic, FileText } from 'lucide-react';

export function CreateNoteForm({ newNote, setNewNote, onSubmit, isFormRecording, onToggleRecording }: {
  newNote: { title: string; content: string };
  setNewNote: React.Dispatch<React.SetStateAction<{ title: string; content: string }>>;
  onSubmit: (e: React.FormEvent) => void;
  isFormRecording: boolean;
  onToggleRecording: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="notes-create-form mb-3 rounded-xl border border-violet-100 bg-white/90 p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:border-violet-500/20 dark:bg-slate-900/80 sm:p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold text-slate-800 dark:text-white sm:text-sm">یادداشت جدید</h3>
            <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500">متن را تایپ کنید یا با میکروفن به متن تبدیل کنید</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleRecording}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-bold transition ${
            isFormRecording
              ? 'border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-500/10 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300'
              : 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/15'
          }`}
          title={isFormRecording ? 'توقف ضبط' : 'شروع ضبط صدا'}
          aria-pressed={isFormRecording}
        >
          <Mic className={`h-3.5 w-3.5 ${isFormRecording ? 'animate-pulse' : ''}`} />
          {isFormRecording ? 'در حال ضبط' : 'ورودی صوتی'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <div>
          <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">عنوان</label>
          <input
            type="text"
            value={newNote.title}
            onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">متن یادداشت</label>
          <textarea
            value={newNote.content}
            onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
            rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            required
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 px-4 text-xs font-bold text-white shadow-[0_7px_18px_rgba(79,70,229,0.16)] transition hover:from-violet-500 hover:to-indigo-500"
          >
            <Save className="h-3.5 w-3.5" />
            ذخیره یادداشت
          </button>
        </div>
      </div>
    </form>
  );
}
