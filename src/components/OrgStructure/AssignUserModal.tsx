import { useState } from 'react';
import { UserCheck, X, Check, Search, User, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { OrgPosition, Profile, PositionMember, LevelDef } from './types';
import { getLevelInfo } from './utils';
import { Spinner } from '../Spinner';

function AssignUserModal({
  position, allProfiles, currentMembers, levelDefs, onAssign, onRemove, onClose, onRefreshProfiles,
}: {
  position: OrgPosition;
  allProfiles: Profile[];
  currentMembers: PositionMember[];
  levelDefs: LevelDef[];
  onAssign: (userId: string, isPrimary: boolean) => Promise<void>;
  onRemove: (memberId: string, userId: string) => Promise<void>;
  onClose: () => void;
  onRefreshProfiles: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '' });
  const [creatingUser, setCreatingUser] = useState(false);
  const lvl = getLevelInfo(position.level, levelDefs);
  const color = position.color || lvl.color;

  const handleCreateUser = async () => {
    if (!newUser.email.trim() || !newUser.password.trim()) {
      toast.error('ایمیل و رمز عبور الزامی است');
      return;
    }
    setCreatingUser(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: newUser.email.trim(),
        password: newUser.password.trim(),
        options: { data: { full_name: newUser.full_name } },
      });
      if (error) { toast.error(error.message); return; }
      if (data.user) {
        await supabase.from('profiles').upsert({
          user_id: data.user.id,
          email: newUser.email.trim(),
          full_name: newUser.full_name || null,
          is_active: true,
          is_admin: false,
        }, { onConflict: 'user_id' });
        toast.success('کاربر جدید ایجاد شد');
        setNewUser({ full_name: '', email: '', password: '' });
        setShowAddForm(false);
        await onRefreshProfiles();
        await onAssign(data.user.id, currentMembers.length === 0);
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const assignedUserIds = new Set(currentMembers.map(m => m.user_id));
  const filtered = allProfiles.filter(p => {
    const q = search.toLowerCase();
    return p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5" style={{ color }} />
            مدیریت کاربران: {position.title}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {currentMembers.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">کاربران فعلی این سمت:</p>
            <div className="flex flex-wrap gap-2">
              {currentMembers.map(m => (
                <div key={m.id}
                  className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-sm"
                  style={{ borderColor: color + '60', backgroundColor: color + '10' }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: color }}>
                    {(m.profile?.full_name || 'U').charAt(0)}
                  </div>
                  <span className="text-xs text-gray-700 dark:text-gray-200">{m.profile?.full_name || m.profile?.email}</span>
                  {m.is_primary && <span className="text-[9px] text-amber-500 font-bold">★</span>}
                  <button
                    onClick={async () => { setSaving(m.id); try { await onRemove(m.id, m.user_id); } finally { setSaving(null); } }}
                    disabled={saving === m.id}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    {saving === m.id ? <Spinner className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-3 flex-shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="جستجو در کاربران..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
          {filtered.map(p => {
            const isAssigned = assignedUserIds.has(p.user_id);
            return (
              <div key={p.user_id}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${isAssigned ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-200 dark:hover:border-blue-700'}`}
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-blue-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{p.full_name || p.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {[p.position, p.department].filter(Boolean).join(' — ') || p.email}
                  </p>
                </div>
                {isAssigned ? (
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex-shrink-0">
                    <Check className="w-3.5 h-3.5" /> تخصیص یافته
                  </div>
                ) : (
                  <button
                    onClick={async () => { setSaving(p.user_id); try { await onAssign(p.user_id, currentMembers.length === 0); } finally { setSaving(null); } }}
                    disabled={saving === p.user_id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors flex-shrink-0"
                  >
                    {saving === p.user_id ? <Spinner className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    انتخاب
                  </button>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && !showAddForm && (
            <div className="flex flex-col items-center py-8 gap-3 text-gray-400">
              <User className="w-8 h-8 opacity-30" />
              <p className="text-sm">{search ? `کاربری با عبارت «${search}» یافت نشد` : 'هیچ کاربری وجود ندارد'}</p>
              <button
                onClick={() => { setShowAddForm(true); if (search) setNewUser(u => ({ ...u, full_name: search })); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> افزودن کاربر جدید
              </button>
            </div>
          )}

          {showAddForm && (
            <div className="border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> افزودن کاربر جدید
                </p>
                <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="نام و نام خانوادگی"
                value={newUser.full_name}
                onChange={e => setNewUser(u => ({ ...u, full_name: e.target.value }))}
              />
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="ایمیل *" type="email" dir="ltr"
                value={newUser.email}
                onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))}
              />
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="رمز عبور *" type="password" dir="ltr"
                value={newUser.password}
                onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
              />
              <div className="flex gap-2">
                <button onClick={handleCreateUser} disabled={creatingUser}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {creatingUser ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  ایجاد و تخصیص به سمت
                </button>
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm"
                >
                  انصراف
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { AssignUserModal };
