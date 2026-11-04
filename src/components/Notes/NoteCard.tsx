import { Bell, CalendarDays, Clock3, UsersRound, Mic, Share2, Send, Archive, Trash2, Save, X, FileText, Image as ImageIcon, Download, CreditCard as Edit2 } from 'lucide-react';
import { quickNoteReminder } from './reminderTime';
import type { Note } from './types';
import { ReminderField, type ReminderUser } from './ReminderField';
import { getFileIcon, formatFileSize } from './utils';

interface NoteCardProps {
  note: Note;
  reminderUsers?: ReminderUser[];
  usersLoading?: boolean;
  usersError?: boolean;
  colors: { bg: string; border: string; header: string };
  isEditing: boolean;
  editingNote: Note | null;
  shareMenuOpen: boolean;
  canEdit: boolean;
  canDelete: boolean;
  shareMenuRef: React.RefObject<HTMLDivElement>;
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
  note, reminderUsers, usersLoading, usersError, colors, isEditing, editingNote, shareMenuOpen, canEdit, canDelete,
  shareMenuRef, onSetEditingNote, onSetEditingNoteId, onHandleSaveEdit,
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
          <ReminderField noteId={note.id} ownerId={note.user_id} value={editingNote?.remind_at ?? null} disabled={note.status === 'archived'}
            recipientIds={editingNote?.reminder_user_ids ?? []}
            onRecipientsChange={ids => onSetEditingNote(prev => prev ? { ...prev, reminder_user_ids: ids } : null)}
            users={reminderUsers} usersLoading={usersLoading} usersError={usersError}
            onChange={value => onSetEditingNote(prev => prev ? { ...prev, remind_at: value, reminder_user_ids: value ? prev.reminder_user_ids : [] } : null)} />
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
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-end gap-1 border-b border-slate-100 pb-2 dark:border-slate-800">
              {canEdit && note.status === 'active' && <button type="button"
                onClick={() => onHandleEditNote({ ...note, remind_at: note.remind_at ?? quickNoteReminder(2) })}
                className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                <Bell className="h-3.5 w-3.5" />{note.remind_at ? 'ویرایش یادآوری' : 'تعیین یادآوری'}
              </button>}
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
                <button onClick={() => onHandleArchiveNote(note.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300" title="بایگانی" aria-label="بایگانی">
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onSetDeleteConfirmId(note.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300" title="حذف" aria-label="حذف">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-start gap-1.5">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors.header}`} aria-hidden="true" />
                <h3 className="min-w-0 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-800 dark:text-white">{note.title}</h3>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                {note.note_type === 'voice' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-bold text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                    <Mic className="h-2.5 w-2.5" /> صوتی
                  </span>
                )}
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(note.created_at).toLocaleDateString('fa-IR')}</span>
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(note.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
                {!!note.reminder_user_ids?.length && <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" />شما و {note.reminder_user_ids.length.toLocaleString('fa-IR')} نفر دیگر</span>}
                {note.status === 'archived' && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">بایگانی</span>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words text-[11px] leading-6 text-slate-600 dark:text-slate-400">{note.content}</p>
          </div>

          {note.remind_at && (
            <p className="mt-2 flex items-center gap-1 text-[10px] leading-5 text-amber-700 dark:text-amber-300">
              <Bell className="h-3 w-3 flex-shrink-0" />
              {note.reminder_sent_at ? 'اعلان یادآوری ثبت شد: ' : 'یادآوری: '}
              {new Date(note.remind_at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          )}

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


        </>
      )}
    </article>
  );
}
