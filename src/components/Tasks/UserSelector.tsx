import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Building2 } from 'lucide-react';
import { type UserProfile } from './types';
import { type OrgUserProfile } from '../../lib/useOrgUsers';

function UserSelector({ users, groups, value, onChange, placeholder, disabled }: {
  users: UserProfile[];
  groups?: { label: string; users: OrgUserProfile[] }[];
  value: string;
  onChange: (userId: string, displayName: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const groupedUsers = groups?.flatMap(g => g.users) ?? [];
  const allUsers: (UserProfile | OrgUserProfile)[] = groupedUsers.length > 0 ? groupedUsers : users;

  const selected = allUsers.find(u => u.user_id === value);
  const trimmed = search.trim();
  const isSearching = trimmed.length > 0;
  const query = trimmed.toLowerCase();

  const filteredFlat = allUsers.filter(u =>
    (u.full_name || u.email || '').toLowerCase().includes(query)
  );

  const subtitle = (u: UserProfile | OrgUserProfile): string => {
    const pos = (u as OrgUserProfile).position_title || (u as UserProfile).position || '';
    const unit = (u as OrgUserProfile).unit_name || (u as UserProfile).unit_name || '';
    return [pos, unit].filter(Boolean).join(' • ');
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => { if (disabled) return; setOpen(v => !v); }}
        className="w-full flex items-center justify-between p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed">
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? (selected.full_name || selected.email) : (placeholder || 'انتخاب کاربر')}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input type="text" autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="جستجو..." className="w-full p-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {isSearching || !groups?.length ? (
              filteredFlat.length === 0
                ? <p className="px-3 py-3 text-gray-400 text-sm text-center">نتیجه‌ای یافت نشد</p>
                : filteredFlat.map(u => (
                  <button key={u.user_id} type="button"
                    onClick={() => { onChange(u.user_id, u.full_name || u.email || ''); setOpen(false); setSearch(''); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                    <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(u.full_name || u.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="text-right">
                      <p className="text-gray-800 dark:text-gray-100 font-medium">{u.full_name || '—'}</p>
                      <p className="text-gray-400 text-xs">{subtitle(u) || u.email}</p>
                    </div>
                  </button>
                ))
            ) : (
              groups.map(group => {
                if (group.users.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="px-3 py-1.5 flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/60 sticky top-0 z-10">
                      <Building2 className="w-3 h-3 text-teal-500 flex-shrink-0" />
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide truncate">{group.label}</span>
                    </div>
                    {group.users.map(u => (
                      <button key={u.user_id} type="button"
                        onClick={() => { onChange(u.user_id, u.full_name || u.email || ''); setOpen(false); setSearch(''); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                        <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {(u.full_name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="text-right min-w-0">
                          <p className="text-gray-800 dark:text-gray-100 font-medium truncate">{u.full_name || '—'}</p>
                          <p className="text-gray-400 text-xs truncate">{subtitle(u) || u.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { UserSelector };
