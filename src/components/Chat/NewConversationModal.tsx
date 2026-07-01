import { useState } from 'react';
import { X, Search, ChevronDown, ChevronRight, Building2, Users } from 'lucide-react';
import type { UserProfile } from './types';
import { UserAvatar } from './ChatConversationItem';
import { useOrgUsers } from '../../lib/useOrgUsers';

interface Props {
  currentUserId: string | null;
  onSelect: (user: UserProfile) => void;
  onClose: () => void;
}

export function NewConversationModal({ currentUserId, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set(['__all__']));
  const { groups, allUsers, loading } = useOrgUsers(currentUserId);

  const toggleUnit = (key: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const isSearching = search.trim().length > 0;

  const filteredAll = isSearching
    ? allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const unitTypeLabel = (type: string | null) => {
    const map: Record<string, string> = {
      division: 'معاونت',
      department: 'اداره',
      office: 'دفتر',
      unit: 'واحد',
    };
    return type ? (map[type] || type) : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h3 className="font-bold text-gray-900 dark:text-white">گفتگوی جدید</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی نام یا ایمیل..."
              className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-hidden focus:ring-2 focus:ring-blue-500 dark:text-white"
            />
          </div>
        </div>

        {/* User list */}
        <div className="overflow-y-auto flex-1 px-2 pb-3">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">در حال بارگذاری...</div>
          ) : isSearching ? (
            // حالت جستجو — بدون گروه‌بندی
            <div className="space-y-0.5 px-2 pt-1">
              {filteredAll.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">کاربری یافت نشد</p>
              ) : filteredAll.map(u => (
                <UserButton key={u.user_id} user={u} onSelect={onSelect} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">کاربری یافت نشد</p>
          ) : (
            // حالت عادی — گروه‌بندی بر اساس واحد
            <div className="pt-1 space-y-1">
              {groups.map(group => {
                const key = group.unit_id || '__no_unit__';
                const isOpen = expandedUnits.has(key);
                const typeLabel = unitTypeLabel(group.unit_type);
                return (
                  <div key={key} className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700">
                    {/* عنوان گروه */}
                    <button
                      onClick={() => toggleUnit(key)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      {group.unit_id ? (
                        <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
                      ) : (
                        <Users className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      <span className="flex-1 text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">
                        {typeLabel ? `${typeLabel} ` : ''}{group.unit_name}
                      </span>
                      <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded-full shrink-0">
                        {group.users.length}
                      </span>
                    </button>
                    {/* اعضا */}
                    {isOpen && (
                      <div className="divide-y divide-gray-50 dark:divide-gray-700/50 bg-white dark:bg-gray-800">
                        {group.users.map(u => (
                          <UserButton key={u.user_id} user={u} onSelect={onSelect} showUnit={false} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserButton({
  user,
  onSelect,
  showUnit = true,
}: {
  user: { user_id: string; full_name: string | null; email: string | null; unit_name: string | null; position_title: string | null };
  onSelect: (u: UserProfile) => void;
  showUnit?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect({ user_id: user.user_id, full_name: user.full_name, email: user.email })}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
    >
      <UserAvatar name={user.full_name || user.email || 'U'} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {user.full_name || user.email}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {user.position_title
            ? user.position_title
            : showUnit && user.unit_name
              ? user.unit_name
              : user.email}
        </p>
      </div>
    </button>
  );
}
