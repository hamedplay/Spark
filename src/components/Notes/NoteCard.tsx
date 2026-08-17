import { Mic, Share2, Send, Archive, Trash2, Save, X, FileText, Image as ImageIcon, Download, CreditCard as Edit2 } from 'lucide-react';
import type { Note } from './types';
import { getFileIcon, formatFileSize } from './utils';

interface NoteCardProps {
  note: Note;
  colors: { bg: string; border: string; header: string };
  isExpanded: boolean;
  isEditing: boolean;
  editingNote: Note | null;
  shareMenuOpen: boolean;
  canEdit: boolean;
  canDelete: boolean;
  shareMenuRef: React.RefObject<HTMLDivElement>;
  onSetExpandedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  onSetEditingNote: React.Dispatch<React.SetStateAction<Note | null>>;
  onSetEditingNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  onHandleSaveEdit: () => void;
  onHandleEditNote: (note: Note) => void;
  onHandleArchiveNote: (noteId: string) => void;
  onSetDeleteConfirmId: React.Dispatch<React.SetStateAction<string | null>>;
  onSetAssignNote: React.Dispatch<React.SetStateAction<Note | null>>;
  onSetAssignSearch: React.Dispatch<React.SetStateAction<string>>;
  onSetShareMenuNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  onHandleShareImage: (note: Note) => void;
  onHandleShareText: (note: Note) => void;
  onHandleFileClick: (note: Note) => void;
}

export function NoteCard({
  note, colors, isExpanded, isEditing, editingNote, shareMenuOpen, canEdit, canDelete,
  shareMenuRef, onSetExpandedNoteId, onSetEditingNote, onSetEditingNoteId, onHandleSaveEdit,
  onHandleEditNote, onHandleArchiveNote, onSetDeleteConfirmId, onSetAssignNote, onSetAssignSearch,
  onSetShareMenuNoteId, onHandleShareImage, onHandleShareText, onHandleFileClick,
}: NoteCardProps) {
  return (
    <article
      id={`note-${note.id}`}
      className={`note-card relative flex min-h-[172px] flex-col overflow-visible rounded-2xl border border-slate-200 bg-white/92 p-3 shadow-[0_6px_20px_rgba(15,23,42,0.04)] transition-all hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.065)] dark:border-slate-800 dark:bg-slate-900/82 ${note.status === 'archived' ? 'opacity-70' : ''}`}
    >
      {isEditing ? (
        <div className="space-y-2.5">
          <input
            type="text"
            value={editingNote?.title || ''}
            onChange={(e) => onSetEditingNote(prev => prev ? { ...prev, title: e.target.value } : null)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <textarea
            value={editingNote?.content || ''}
            onChange={(e) => onSetEditingNote(prev => prev ? { ...prev, content: e.target.value } : null)}
            rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onHandleSaveEdit} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500">
              <Save className="h-3.5 w-3.5" /> ذخیره
            </button>
            <button onClick={() => { onSetEditingNoteId(null); onSetEditingNote(null); }} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
              <X className="h-3.5 w-3.5" /> انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors.header}`} aria-hidden="true" />
                <h3 className="truncate text-sm font-bold text-slate-800 dark:text-white">{note.title}</h3>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500">
                {note.note_type === 'voice' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-bold text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                    <Mic className="h-2.5 w-2.5" /> صوتی
                  </span>
                )}
                <span>{new Date(note.created_at).toLocaleDateString('fa-IR')}</span>
                {note.status === 'archived' && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">بایگانی</span>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              <div className="relative" ref={shareMenuOpen ? shareMenuRef : undefined}>
                <button
                  onClick={() => onSetShareMenuNoteId(v => v === note.id ? null : note.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-600 transition hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300"
                  title="اشتراک‌گذاری"
                  aria-label="اشتراک‌گذاری"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
                {shareMenuOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1.5 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800" dir="rtl">
                    <button onClick={() => onHandleShareImage(note)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs text-slate-700 transition hover:bg-violet-50 dark:text-slate-200 dark:hover:bg-violet-500/10">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"><ImageIcon className="h-3 w-3" /></span>
                      اشتراک تصویر
                    </button>
                    <button onClick={() => onHandleShareText(note)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs text-slate-700 transition hover:bg-cyan-50 dark:text-slate-200 dark:hover:bg-cyan-500/10">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300"><FileText className="h-3 w-3" /></span>
                      اشتراک متن
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => { onSetAssignNote(note); onSetAssignSearch(''); }} className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-600 transition hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300" title="ارجاع" aria-label="ارجاع">
                <Send className="h-3.5 w-3.5" />
              </button>
              {canEdit && (
                <button onClick={() => onHandleEditNote(note)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300" title="ویرایش" aria-label="ویرایش">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onHandleArchiveNote(note.id)} className="hidden h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 sm:flex" title="بایگانی" aria-label="بایگانی">
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onSetDeleteConfirmId(note.id)} className="hidden h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 sm:flex" title="حذف" aria-label="حذف">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            className="min-h-0 flex-1 cursor-pointer text-right"
            onClick={() => onSetExpandedNoteId(isExpanded ? null : note.id)}
            title={isExpanded ? 'کلیک برای جمع‌کردن' : 'کلیک برای مشاهده کامل'}
          >
            <p className={`${isExpanded ? 'whitespace-pre-wrap' : 'mobile-line-clamp-3'} text-[11px] leading-5 text-slate-600 dark:text-slate-400`}>{note.content}</p>
          </button>

          {note.file_url && (
            <button
              type="button"
              onClick={() => onHandleFileClick(note)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-right transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-800"
            >
              <span className="text-slate-500 dark:text-slate-400">{getFileIcon(note.file_type || '')}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-bold text-slate-700 dark:text-slate-300">{note.file_name}</p>
                {note.file_size && <p className="text-[9px] text-slate-400">{formatFileSize(note.file_size)}</p>}
              </div>
              <Download className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            </button>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <span className="text-[9px] text-slate-400 dark:text-slate-500">{new Date(note.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
            <div className="flex items-center gap-1.5">
              {note.content.length > 80 && (
                <button onClick={() => onSetExpandedNoteId(isExpanded ? null : note.id)} className="rounded-lg px-2 py-1 text-[9px] font-bold text-violet-600 transition hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10">
                  {isExpanded ? 'جمع کردن' : 'مشاهده کامل'}
                </button>
              )}
              {canDelete && (
                <div className="flex items-center gap-1 sm:hidden">
                  <button onClick={() => onHandleArchiveNote(note.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300" aria-label="بایگانی"><Archive className="h-3 w-3" /></button>
                  <button onClick={() => onSetDeleteConfirmId(note.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300" aria-label="حذف"><Trash2 className="h-3 w-3" /></button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </article>
  );
}
