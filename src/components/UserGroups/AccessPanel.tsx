import { useState } from 'react';
import { ShieldCheck, Save, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader, GroupBadge } from './Shared';
import type { UserGroup } from './types';
import {
  PERMISSION_REGISTRY,
  MINUTES_SUB_PERMISSIONS,
  MINUTES_SENSITIVE_PERMISSIONS,
} from '../../features/permissions/permissionRegistry';

export function AccessPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
  const [perms, setPerms] = useState<Record<string, boolean>>(group.permissions || {});
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }));

  const toggleModule = (moduleKey: string) => {
    const newVal = !perms[moduleKey];
    setPerms(p => {
      const updated: Record<string, boolean> = { ...p, [moduleKey]: newVal };
      if (!newVal) {
        if (moduleKey === 'minutes_view') {
          MINUTES_SUB_PERMISSIONS.forEach(k => { updated[k] = false; });
        } else {
          const subGroup = PERMISSION_REGISTRY.find(g => g.moduleKey === moduleKey);
          if (subGroup) {
            subGroup.items.forEach(item => {
              if (item.key !== moduleKey) updated[item.key] = false;
            });
          }
        }
      }
      return updated;
    });
  };

  const mainModuleKeys = new Set(PERMISSION_REGISTRY[0].items.map(i => i.key));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('user_groups')
      .update({ permissions: perms })
      .eq('id', group.id)
      .select('permissions')
      .single();
    if (error) {
      toast.error('خطا در ذخیره');
    } else if (data?.permissions) {
      setPerms(data.permissions as Record<string, boolean>);
      toast.success('دسترسی‌ها ذخیره شد');
    } else {
      toast.success('دسترسی‌ها ذخیره شد');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حقوق دسترسی گروه" icon={ShieldCheck} color="text-teal-500" onBack={onBack} />
      <GroupBadge group={group} />
      <div className="space-y-3">
        {PERMISSION_REGISTRY.map(group => (
          <div key={group.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${group.color}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${group.color}`}>{group.label}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {group.items.map(({ key, label, description }) => {
                const isMain = mainModuleKeys.has(key) || key === 'minutes_view';
                const isSensitive = MINUTES_SENSITIVE_PERMISSIONS.includes(key);
                return (
                  <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {label}
                        {isSensitive && (
                          <span className="mr-2 inline-block px-1.5 py-0.5 text-[10px] rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-normal">حساس</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{description}</p>
                    </div>
                    <button
                      onClick={() => isMain ? toggleModule(key) : toggle(key)}
                      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${perms[key] ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${perms[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 pt-2 pb-4">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition w-full justify-center sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
        </button>
      </div>
    </div>
  );
}

export { PERMISSION_REGISTRY as PERMISSION_GROUPS };
