import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Calendar, Mail, Globe, CircleCheck as CheckCircle2, Users, Activity, Shield, Loader as Loader2, UserPlus, UserMinus, RefreshCw, CreditCard as Edit3 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile, GroupMembership } from './types';
import { DetailPanel } from './DetailPanel';
import { loadResolvedUserPermissions } from '../../features/permissions';
import {
  PERMISSION_REGISTRY,
  ALL_PERMISSION_ITEMS,
  getPermissionLabel,
  MINUTES_PERMISSION_KEYS,
} from '../../features/permissions/permissionRegistry';

const MODULE_ICONS: Record<string, typeof Calendar> = {
  meetings: Calendar,
  calendar: Calendar,
  chat: Mail,
  channels: Mail,
  video_conference: Globe,
  tasks: CheckCircle2,
  notes: Globe,
  contacts: Users,
  reports: Activity,
  admin_panel: Shield,
  minutes_view: ShieldCheck,
};

function getIcon(key: string): typeof Calendar {
  return MODULE_ICONS[key] || ShieldCheck;
}

function AccessPanel({ user, onBack, onNavigateToGroup }: { user: AdminProfile; onBack: () => void; onNavigateToGroup?: (groupId: string) => void }) {
  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [allGroups, setAllGroups] = useState<{ id: string; display_name: string | null; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [resolvedPermissions, setResolvedPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const { data: memberships } = await supabase
      .from('user_group_members')
      .select('group_id')
      .eq('user_id', user.user_id);
    if (!memberships || memberships.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const groupIds = memberships.map(m => m.group_id);
    const { data: groupData } = await supabase
      .from('user_groups')
      .select('id, display_name, name, permissions')
      .in('id', groupIds);
    setGroups((groupData || []).map(g => ({
      group_id: g.id,
      group_name: g.display_name || g.name,
      permissions: (g.permissions || {}) as Record<string, boolean>,
    })));
    setLoading(false);
  }, [user.user_id]);

  useEffect(() => { loadGroups(); }, [loadGroups, reloadKey]);
  useEffect(() => {
    let alive = true;
    void loadResolvedUserPermissions(user.user_id).then((permissions) => {
      if (alive) setResolvedPermissions(permissions);
    });
    return () => { alive = false; };
  }, [user.user_id, reloadKey]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('user_groups')
        .select('id, display_name, name')
        .order('display_name');
      setAllGroups(data || []);
    })();
  }, []);

  const mergedPerms = (key: string): { has: boolean; source: string; denySource?: string } => {
    if (user.is_active === false) return { has: false, source: 'کاربر غیرفعال' };
    if (user.is_admin || resolvedPermissions === null) return { has: true, source: user.is_admin ? 'ادمین' : 'دسترسی کامل' };
    if (resolvedPermissions?.[key] === true) return { has: true, source: 'دسترسی مؤثر' };

    const grantingGroups = groups.filter(g => g.permissions[key] === true);
    const denyingGroups = groups.filter(g => g.permissions[key] === false);

    if (grantingGroups.length > 0) {
      return { has: true, source: grantingGroups[0].group_name || 'گروه' };
    }
    if (denyingGroups.length > 0 && grantingGroups.length === 0) {
      return { has: false, source: 'گروه (صریح false)', denySource: denyingGroups[0].group_name || 'گروه' };
    }
    return { has: false, source: 'بدون منبع اعطا' };
  };

  const addToGroup = async (groupId: string) => {
    const { error } = await supabase
      .from('user_group_members')
      .insert({ user_id: user.user_id, group_id: groupId });
    if (error) {
      if (error.code === '23505') toast.error('کاربر قبلاً عضو این گروه است');
      else toast.error('خطا در افزودن عضویت');
    } else {
      toast.success('عضویت افزوده شد');
      setReloadKey(k => k + 1);
    }
  };

  const removeFromGroup = async (groupId: string) => {
    const { error } = await supabase
      .from('user_group_members')
      .delete()
      .eq('user_id', user.user_id)
      .eq('group_id', groupId);
    if (error) toast.error('خطا در حذف عضویت');
    else {
      toast.success('عضویت حذف شد');
      setReloadKey(k => k + 1);
    }
  };

  const memberGroupIds = new Set(groups.map(g => g.group_id));
  const availableGroups = allGroups.filter(g => !memberGroupIds.has(g.id));

  return (
    <DetailPanel title="حقوق دسترسی" icon={ShieldCheck} iconColor="text-teal-500" user={user} onBack={onBack}>
      <div className="space-y-3">
        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowGroupModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-xs font-medium transition">
            <UserPlus className="w-3.5 h-3.5" />
            مدیریت عضویت گروه‌ها
          </button>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-medium transition">
            <RefreshCw className="w-3.5 h-3.5" />
            بارگذاری مجدد دسترسی‌ها
          </button>
        </div>

        {/* Group memberships */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">عضویت در گروه‌ها</span>
            <span className="text-xs text-gray-400">{groups.length} گروه</span>
          </div>
          {loading && <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}
          {!loading && groups.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-400">عضو هیچ گروهی نیست</div>
          )}
          {!loading && groups.map(g => (
            <div key={g.group_id} className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">{g.group_name}</span>
                {onNavigateToGroup && (
                  <button onClick={() => onNavigateToGroup(g.group_id)}
                    className="flex items-center gap-1 text-xs text-teal-500 hover:text-teal-600 transition">
                    <Edit3 className="w-3 h-3" />
                    ویرایش حقوق گروه
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1 max-w-xs">
                  {g.permissions['all'] && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">همه دسترسی‌ها</span>}
                  {!g.permissions['all'] && MINUTES_PERMISSION_KEYS.filter(k => g.permissions[k]).map(k => (
                    <span key={k} className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full">{getPermissionLabel(k)}</span>
                  ))}
                  {!g.permissions['all'] && MINUTES_PERMISSION_KEYS.every(k => !g.permissions[k]) && Object.values(g.permissions).every(v => !v) && (
                    <span className="text-xs text-gray-400">بدون دسترسی خاص</span>
                  )}
                </div>
                <button onClick={() => removeFromGroup(g.group_id)}
                  className="p-1 text-red-400 hover:text-red-500 transition" title="حذف عضویت">
                  <UserMinus className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Permission list by group */}
        {PERMISSION_REGISTRY.map(group => (
          <div key={group.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{group.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">دسترسی مؤثر از ترکیب وضعیت کاربر و گروه‌های عضو</p>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {group.items.map(({ key, label }) => {
                const { has, source, denySource } = mergedPerms(key);
                const Icon = getIcon(key);
                return (
                  <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{denySource ? `رد توسط: ${denySource}` : source}</span>
                      <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${has ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${has ? 'bg-green-500' : 'bg-red-500'}`} />
                        {has ? 'دارد' : 'ندارد'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Group membership modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowGroupModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">مدیریت عضویت گروه‌ها</h3>
              <button onClick={() => setShowGroupModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              <p className="text-xs text-gray-400 mb-2">گروه‌های فعلی:</p>
              {groups.length === 0 && <p className="text-xs text-gray-400">عضو هیچ گروهی نیست</p>}
              {groups.map(g => (
                <div key={g.group_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{g.group_name}</span>
                  <button onClick={() => removeFromGroup(g.group_id)}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition">
                    <UserMinus className="w-3.5 h-3.5" /> حذف
                  </button>
                </div>
              ))}
              {availableGroups.length > 0 && (
                <>
                  <p className="text-xs text-gray-400 mt-4 mb-2">گروه‌های قابل افزودن:</p>
                  {availableGroups.map(g => (
                    <div key={g.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{g.display_name || g.name}</span>
                      <button onClick={() => addToGroup(g.id)}
                        className="flex items-center gap-1 text-xs text-teal-500 hover:text-teal-600 transition">
                        <UserPlus className="w-3.5 h-3.5" /> افزودن
                      </button>
                    </div>
                  ))}
                </>
              )}
              {availableGroups.length === 0 && groups.length > 0 && (
                <p className="text-xs text-gray-400 mt-4">کاربر در تمام گروه‌ها عضو است.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </DetailPanel>
  );
}

export { AccessPanel };
