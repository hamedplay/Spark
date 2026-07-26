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
    <div
      id={`note-${note.id}`}
      className={`rounded-2xl border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col ${colors.bg} ${colors.border} ${
        note.status === 'archived' ? 'opacity-60' : ''
      } ${isEditing || isExpanded ? '' : 'h-52'}`}
    >
      {isEditing ? (
        <div className="p-4 space-y-3">
          <input
            type="text"
            value={editingNote?.title || ''}
            onChange={(e) => onSetEditingNote(prev => prev ? {...prev, title: e.target.value} : null)}
            className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
          />
          <textarea
            value={editingNote?.content || ''}
            onChange={(e) => onSetEditingNote(prev => prev ? {...prev, content: e.target.value} : null)}
            rows={3}
            className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white resize-none"
          />
          <div className="flex gap-2">
            <button onClick={onHandleSaveEdit} className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white py-2 text-sm rounded-lg hover:bg-green-600">
              <Save className="w-3.5 h-3.5" /> ذخیره
            </button>
            <button onClick={() => { onSetEditingNoteId(null); onSetEditingNote(null); }} className="flex-1 flex items-center justify-center gap-1.5 bg-gray-400 text-white py-2 text-sm rounded-lg hover:bg-gray-500">
              <X className="w-3.5 h-3.5" /> انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Card header */}
          <div className={`flex items-start justify-between px-4 pt-3 pb-2 flex-shrink-0 ${colors.header}`}>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white leading-tight flex-1 min-w-0 truncate ml-2">{note.title}</h3>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {note.note_type === 'voice' && <Mic className="w-3.5 h-3.5 text-gray-400 ml-1" />}
              <div className="relative" ref={shareMenuOpen ? shareMenuRef : undefined}>
                <button
                  onClick={() => onSetShareMenuNoteId(v => v === note.id ? null : note.id)}
                  className="p-1 rounded-lg text-gray-400 hover:text-blue-500 transition-colors"
                  title="اشتراک‌گذاری"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
                {shareMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl">
                    <button
                      onClick={() => onHandleShareImage(note)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-200">اشتراک تصویر</span>
                    </button>
                    <div className="h-px bg-gray-100 dark:bg-gray-700 mx-3" />
                    <button
                      onClick={() => onHandleShareText(note)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-7 h-7 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-200">اشتراک متن</span>
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => { onSetAssignNote(note); onSetAssignSearch(''); }} className="p-1 rounded-lg text-gray-400 hover:text-teal-500 transition-colors" title="ارجاع">
                <Send className="w-3.5 h-3.5" />
              </button>
              {canEdit && (
                <button onClick={() => onHandleEditNote(note)} className="p-1 rounded-lg text-gray-400 hover:text-blue-500 transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onHandleArchiveNote(note.id)} className="p-1 rounded-lg text-gray-400 hover:text-amber-500 transition-colors" title="بایگانی">
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onSetDeleteConfirmId(note.id)} className="p-1 rounded-lg text-gray-400 hover:text-red-500 transition-colors" title="حذف">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Card body — fixed height, scrollable when expanded */}
          <div className="px-4 pb-3 flex flex-col flex-1 min-h-0">
            <div
              className={`flex-1 overflow-hidden cursor-pointer transition-all duration-300 ${isExpanded ? 'overflow-y-auto' : ''}`}
              onClick={() => onSetExpandedNoteId(isExpanded ? null : note.id)}
              title={isExpanded ? 'کلیک برای جمع‌کردن' : 'کلیک برای مشاهده کامل'}
            >
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{note.content}</p>
            </div>

            {note.file_url && (
              <div
                onClick={() => onHandleFileClick(note)}
                className="mt-2 p-2.5 bg-white/60 dark:bg-gray-800/40 rounded-xl cursor-pointer hover:bg-white/90 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-2 border border-white/80 dark:border-gray-600/30 flex-shrink-0"
              >
                <span className="text-gray-500 dark:text-gray-400">{getFileIcon(note.file_type || '')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{note.file_name}</p>
                  {note.file_size && <p className="text-[10px] text-gray-400">{formatFileSize(note.file_size)}</p>}
                </div>
                <Download className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              </div>
            )}

            <div className="flex items-center justify-between mt-2 flex-shrink-0">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {new Date(note.created_at).toLocaleString('fa-IR')}
              </p>
              <div className="flex items-center gap-2">
                {note.content.length > 80 && (
                  <button
                    onClick={() => onSetExpandedNoteId(isExpanded ? null : note.id)}
                    className="text-[11px] text-blue-500 hover:underline"
                  >
                    {isExpanded ? 'بستن' : 'بیشتر...'}
                  </button>
                )}
                {note.status === 'archived' && (
                  <span className="text-[10px] px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">بایگانی</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
