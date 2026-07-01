import { useState } from 'react';
import { X, Crown, Shield, UserPlus, Trash2, User, Building2, ChevronDown, ChevronRight } from 'lucide-react';
import { ChannelMember, ChannelProfile, MemberRole } from './types';
import { useOrgUsers } from '../../lib/useOrgUsers';

interface Props {
  members: (ChannelMember & { profile: ChannelProfile | null })[];
  allProfiles: ChannelProfile[];
  currentUserId: string | null;
  myRole: MemberRole | null;
  onClose: () => void;
  onAdd: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, role: MemberRole) => Promise<void>;
}

export function ChannelMembersModal({ members, currentUserId, myRole, onClose, onAdd, onRemove, onChangeRole }: Props) {
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const { groups: orgGroups, allUsers: orgAllUsers } = useOrgUsers(currentUserId);

  const memberIds = new Set(members.map(m => m.user_id));

  const isAdmin = myRole === 'admin';

  const handleAdd = async (userId: string) => {
    setLoading(userId);
    try { await onAdd(userId); } finally { setLoading(null); }
  };
  const handleRemove = async (userId: string) => {
    setLoading(userId);
    try { await onRemove(userId); } finally { setLoading(null); }
  };
  const handleRole = async (userId: string, role: MemberRole) => {
    setLoading(userId);
    try { await onChangeRole(userId, role); } finally { setLoading(null); }
  };

  const toggleUnit = (key: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // non-members for picker
  const filteredNonMembers = orgAllUsers.filter(p => !memberIds.has(p.user_id) &&
    (search ? (p.full_name || '').toLowerCase().includes(search.toLowerCase()) || (p.email || '').toLowerCase().includes(search.toLowerCase()) : true));

  // grouped for picker (no search)
  const unitGroups = orgGroups.map(g => ({
    key: g.unit_id || '__no_unit__',
    label: g.unit_name,
    users: g.users.filter(u => !memberIds.has(u.user_id)),
  })).filter(g => g.users.length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose}>
      <div className="absolute inset-y-0 right-0 w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold dark:text-white">اعضا</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">{members.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={() => { setShowPicker(v => !v); setSearch(''); setExpandedUnits(new Set(unitGroups.map(g => g.key))); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 text-white text-xs rounded-lg hover:bg-teal-600">
                <UserPlus className="w-3.5 h-3.5" />افزودن
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {showPicker && (
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0 bg-teal-50 dark:bg-teal-900/10">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی کاربر..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/40"
              dir="rtl"
            />
            <div className="mt-2 max-h-52 overflow-y-auto">
              {search ? (
                filteredNonMembers.slice(0, 20).map(p => (
                  <button key={p.user_id} onClick={() => handleAdd(p.user_id)} disabled={loading === p.user_id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white dark:hover:bg-gray-700 rounded-xl text-sm text-right disabled:opacity-50">
                    {p.avatar_url
                      ? <img src={p.avatar_url} className="w-7 h-7 rounded-full object-cover" alt="" />
                      : <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center"><User className="w-3.5 h-3.5 text-gray-500" /></div>}
                    <div className="flex-1 min-w-0 text-right">
                      <div className="truncate dark:text-white">{p.full_name || p.email || 'کاربر'}</div>
                      {p.position_title && <div className="text-xs text-gray-400 truncate">{p.position_title}</div>}
                    </div>
                    {loading === p.user_id && <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                  </button>
                ))
              ) : (
                unitGroups.map(({ key, label, users }) => {
                  const expanded = expandedUnits.has(key);
                  return (
                    <div key={key}>
                      <button onClick={() => toggleUnit(key)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-right hover:bg-teal-100/50 dark:hover:bg-teal-900/20 rounded-lg">
                        <Building2 className="w-3 h-3 text-teal-500 shrink-0" />
                        <span className="flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">{label}</span>
                        <span className="text-xs text-gray-400">{users.length}</span>
                        {expanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                      </button>
                      {expanded && users.map(p => (
                        <button key={p.user_id} onClick={() => handleAdd(p.user_id)} disabled={loading === p.user_id}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white dark:hover:bg-gray-700 rounded-xl text-sm text-right disabled:opacity-50 pr-6">
                          {p.avatar_url
                            ? <img src={p.avatar_url} className="w-7 h-7 rounded-full object-cover" alt="" />
                            : <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center"><User className="w-3.5 h-3.5 text-gray-500" /></div>}
                          <div className="flex-1 min-w-0 text-right">
                            <div className="truncate dark:text-white">{p.full_name || p.email || 'کاربر'}</div>
                            {p.position_title && <div className="text-xs text-gray-400 truncate">{p.position_title}</div>}
                          </div>
                          {loading === p.user_id && <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
              {(search ? filteredNonMembers : unitGroups).length === 0 && <p className="text-center text-xs text-gray-400 py-3">موردی یافت نشد</p>}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {members.map(m => {
            const p = m.profile;
            const isMe = m.user_id === currentUserId;
            return (
              <div key={m.user_id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">
                {p?.avatar_url
                  ? <img src={p.avatar_url} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
                  : <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-gray-500" /></div>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium dark:text-white truncate">{p?.full_name || p?.email || 'کاربر'}</p>
                  <p className="text-xs text-gray-400 truncate">{p?.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {m.role === 'admin'
                    ? <Crown className="w-4 h-4 text-amber-500" title="مدیر" />
                    : <Shield className="w-4 h-4 text-gray-400" title="عضو" />}
                  {isAdmin && !isMe && (
                    <>
                      <button onClick={() => handleRole(m.user_id, m.role === 'admin' ? 'member' : 'admin')} disabled={loading === m.user_id}
                        className="text-[10px] px-2 py-0.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                        {m.role === 'admin' ? 'عضو' : 'مدیر'}
                      </button>
                      <button onClick={() => handleRemove(m.user_id)} disabled={loading === m.user_id}
                        className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
