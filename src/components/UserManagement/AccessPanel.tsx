import { useState, useEffect } from 'react';
import { ShieldCheck, Calendar, Mail, Globe, CircleCheck as CheckCircle2, Users, Activity, Shield, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminProfile, GroupMembership } from './types';
import { DetailPanel } from './DetailPanel';

function AccessPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const MODULES = [
    { key: 'meetings', label: 'جلسات', icon: Calendar },
    { key: 'meetings_create', label: 'ایجاد جلسه', icon: Calendar },
    { key: 'meetings_edit', label: 'ویرایش جلسه', icon: Calendar },
    { key: 'meetings_delete', label: 'حذف جلسه', icon: Calendar },
    { key: 'calendar', label: 'تقویم', icon: Calendar },
    { key: 'calendar_create_event', label: 'ایجاد رویداد تقویم', icon: Calendar },
    { key: 'chat', label: 'چت سازمانی', icon: Mail },
    { key: 'chat_send_urgent', label: 'ارسال پیام اورژانسی', icon: Mail },
    { key: 'chat_send_confidential', label: 'ارسال پیام محرمانه', icon: Mail },
    { key: 'video_conference', label: 'ویدیو کنفرانس', icon: Globe },
    { key: 'tasks', label: 'اقدامات', icon: CheckCircle2 },
    { key: 'tasks_create', label: 'ایجاد اقدام', icon: CheckCircle2 },
    { key: 'tasks_edit', label: 'ویرایش اقدام', icon: CheckCircle2 },
    { key: 'notes', label: 'یادداشت‌ها', icon: Globe },
    { key: 'notes_create', label: 'ایجاد یادداشت', icon: Globe },
    { key: 'notes_edit', label: 'ویرایش یادداشت', icon: Globe },
    { key: 'contacts', label: 'مخاطبین', icon: Users },
    { key: 'contacts_create', label: 'ایجاد مخاطب', icon: Users },
    { key: 'contacts_edit', label: 'ویرایش مخاطب', icon: Users },
    { key: 'reports', label: 'گزارشات', icon: Activity },
    { key: 'reports_export', label: 'خروجی گزارش', icon: Activity },
    { key: 'admin_panel', label: 'پنل مدیریت', icon: Shield },
  ];

  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: memberships } = await supabase
        .from('user_group_members')
        .select('group_id')
        .eq('user_id', user.user_id);
      if (!memberships || memberships.length === 0) { setLoading(false); return; }
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
    })();
  }, [user.user_id]);

  const mergedPerms = (key: string): { has: boolean; source: string } => {
    if (user.is_active === false) return { has: false, source: 'کاربر غیرفعال' };
    if (key === 'admin_panel') return { has: !!user.is_admin, source: user.is_admin ? 'ادمین' : 'بدون دسترسی' };
    if (user.is_admin) return { has: true, source: 'ادمین' };
    for (const g of groups) {
      if (g.permissions['all'] || g.permissions[key]) return { has: true, source: g.group_name || 'گروه' };
    }
    return { has: false, source: 'بدون گروه' };
  };

  return (
    <DetailPanel title="حقوق دسترسی" icon={ShieldCheck} iconColor="text-teal-500" user={user} onBack={onBack}>
      <div className="space-y-3">
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
              <span className="text-sm text-gray-700 dark:text-gray-300">{g.group_name}</span>
              <div className="flex flex-wrap gap-1">
                {g.permissions['all'] && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">همه دسترسی‌ها</span>}
                {!g.permissions['all'] && Object.entries(g.permissions).filter(([, v]) => v).map(([k]) => (
                  <span key={k} className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full">{k}</span>
                ))}
                {!g.permissions['all'] && Object.values(g.permissions).every(v => !v) && (
                  <span className="text-xs text-gray-400">بدون دسترسی خاص</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">دسترسی به ماژول‌ها</p>
            <p className="text-xs text-gray-400 mt-0.5">دسترسی از ترکیب وضعیت کاربر و گروه‌های عضو محاسبه شده</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {MODULES.map(({ key, label, icon: Icon }) => {
              const { has, source } = mergedPerms(key);
              return (
                <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{source}</span>
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
      </div>
    </DetailPanel>
  );
}

export { AccessPanel };
