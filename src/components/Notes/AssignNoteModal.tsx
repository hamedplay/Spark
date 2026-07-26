import { X, Search, Send } from 'lucide-react';
import type { OrgUserProfile } from '../../lib/useOrgUsers';
import type { Note } from './types';

export function AssignNoteModal({ assignNote, assignSearch, setAssignSearch, orgUsers, userId, onClose, onSend }: {
  assignNote: Note | null;
  assignSearch: string;
  setAssignSearch: React.Dispatch<React.SetStateAction<string>>;
  orgUsers: OrgUserProfile[];
  userId: string | null;
  onClose: () => void;
  onSend: (note: Note, toUserId: string, toName: string) => void;
}) {
  if (!assignNote) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px]" dir="rtl" onClick={onClose}>
      <div className="w-full sm:w-96 bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm">ارجاع یادداشت</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2.5 border-b border-gray-50 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">«{assignNote.title}»</p>
        </div>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={assignSearch}
              onChange={e => setAssignSearch(e.target.value)}
              placeholder="جستجوی کاربر..."
              autoFocus
              className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-400 dark:text-white"
            />
          </div>
        </div>
        <div className="overflow-y-auto max-h-60 pb-2">
          {orgUsers
            .filter(u => u.user_id !== userId && (
              (u.full_name || '').toLowerCase().includes(assignSearch.toLowerCase()) ||
              (u.email || '').toLowerCase().includes(assignSearch.toLowerCase())
            ))
            .map(u => (
              <button
                key={u.user_id}
                onClick={() => onSend(assignNote, u.user_id, u.full_name || u.email || 'کاربر')}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
              >
                <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                  {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{u.full_name || u.email}</p>
                  {u.full_name && <p className="text-[11px] text-gray-400 truncate">{u.email}</p>}
                </div>
                <Send className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          {orgUsers.filter(u => u.user_id !== userId && (
            (u.full_name || '').toLowerCase().includes(assignSearch.toLowerCase()) ||
            (u.email || '').toLowerCase().includes(assignSearch.toLowerCase())
          )).length === 0 && (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">کاربری یافت نشد</p>
          )}
        </div>
      </div>
    </div>
  );
}
