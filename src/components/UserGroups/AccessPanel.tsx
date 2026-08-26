import { useState } from 'react';
import { ShieldCheck, Save, Loader as Loader2, Info, LayoutDashboard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader, GroupBadge } from './Shared';
import type { UserGroup } from './types';
import {
  PERMISSION_REGISTRY,
  MINUTES_SUB_PERMISSIONS,
  MINUTES_SENSITIVE_PERMISSIONS,
} from '../../features/permissions/permissionRegistry';

interface SavePermissionsResult {
  ok?: boolean;
  error?: string;
  permissions?: Record<string, boolean>;
  is_system?: boolean;
}

const MANAGEMENT_DASHBOARD_PERMISSION_KEY = 'management_dashboard';
const MANAGEMENT_SCOPE_PERMISSION_KEYS = [
  'management_decisions.view',
  'management_decisions.manage',
  'management_tasks.view',
  'management_tasks.manage',
] as const;

export function AccessPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
  const [perms, setPerms] = useState<Record<string, boolean>>(group.permissions || {});
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }));

  const toggleManagementDashboard = () => {
    setPerms(current => {
      const enabling = !current[MANAGEMENT_DASHBOARD_PERMISSION_KEY];
      if (!enabling) {
        return { ...current, [MANAGEMENT_DASHBOARD_PERMISSION_KEY]: false };
      }

      const next: Record<string, boolean> = {
        ...current,
        [MANAGEMENT_DASHBOARD_PERMISSION_KEY]: true,
      };
      MANAGEMENT_SCOPE_PERMISSION_KEYS.forEach(key => { next[key] = true; });
      return next;
    });
  };

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
  const managementDashboardPermission = PERMISSION_REGISTRY
    .flatMap(permissionGroup => permissionGroup.items)
    .find(item => item.key === MANAGEMENT_DASHBOARD_PERMISSION_KEY);

  // Management dashboard is rendered in its own explicit card below so an
  // administrator cannot miss it among the generic application modules.
  const visiblePermissionGroups = PERMISSION_REGISTRY
    .map(permissionGroup => ({
      ...permissionGroup,
      items: permissionGroup.items.filter(item => item.key !== MANAGEMENT_DASHBOARD_PERMISSION_KEY),
    }))
    .filter(permissionGroup => permissionGroup.items.length > 0);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('admin_update_user_group_permissions', {
        p_group_id: group.id,
        p_permissions: perms,
      });

      const result = (Array.isArray(data) ? data[0] : data) as SavePermissionsResult | null;
      if (error || result?.ok !== true) {
        const code = result?.error || error?.code || '';
        const message = code === 'AUTH_ACCESS_RESTRICTED'
          ? 'نشست شما برای این تغییر مجاز نیست. صفحه را تازه‌سازی کرده و دوباره وارد شوید.'
          : code === 'ADMIN_REQUIRED'
            ? 'فقط مدیر سامانه می‌تواند حقوق دسترسی گروه را تغییر دهد.'
            : code === 'INVALID_PERMISSIONS' || code === 'INVALID_PERMISSION_VALUE'
              ? 'ساختار دسترسی‌ها نامعتبر است.'
              : code === 'GROUP_NOT_FOUND'
                ? 'گروه کاربری یافت نشد.'
                : 'خطا در ذخیره حقوق دسترسی گروه';
        toast.error(message);
        return;
      }

      if (result.permissions) {
        setPerms(result.permissions);
      }
      toast.success(group.is_system
        ? 'دسترسی‌های گروه سیستمی با موفقیت ذخیره شد'
        : 'دسترسی‌ها با موفقیت ذخیره شد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حقوق دسترسی گروه" icon={ShieldCheck} color="text-teal-500" onBack={onBack} />
      <GroupBadge group={group} />

      {group.is_system && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            این گروه سیستمی است؛ حذف آن محافظت شده، اما حقوق دسترسی آن کاملاً قابل ویرایش است و تغییرات برای کاربران عضو گروه اعمال می‌شود.
          </span>
        </div>
      )}

      {managementDashboardPermission && (
        <div className="overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/70 dark:border-violet-800/70 dark:bg-violet-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-200/70 px-4 py-3 dark:border-violet-800/60 sm:px-5">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">دسترسی ویژه مدیریت</span>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-600 shadow-sm ring-1 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-700">
              مستقل از Admin
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {managementDashboardPermission.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {managementDashboardPermission.description}
              </p>
              <p className="mt-2 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                فعال‌کردن این مجوز، کاربر را Admin نمی‌کند؛ فقط اعضای این گروه داشبورد مدیریتی را مشاهده می‌کنند.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleManagementDashboard}
              aria-pressed={Boolean(perms[MANAGEMENT_DASHBOARD_PERMISSION_KEY])}
              aria-label={`${perms[MANAGEMENT_DASHBOARD_PERMISSION_KEY] ? 'غیرفعال کردن' : 'فعال کردن'} داشبورد مدیریتی برای این گروه`}
              className={`relative h-6 w-12 flex-shrink-0 rounded-full transition-colors ${perms[MANAGEMENT_DASHBOARD_PERMISSION_KEY] ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${perms[MANAGEMENT_DASHBOARD_PERMISSION_KEY] ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visiblePermissionGroups.map(permissionGroup => (
          <div key={permissionGroup.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${permissionGroup.color}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${permissionGroup.color}`}>{permissionGroup.label}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {permissionGroup.items.map(({ key, label, description, isSensitive: itemIsSensitive }) => {
                const isMain = mainModuleKeys.has(key) || key === 'minutes_view';
                const isSensitive = itemIsSensitive || MINUTES_SENSITIVE_PERMISSIONS.includes(key);
                return (
                  <div key={key} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {label}
                        {isSensitive && (
                          <span className="mr-2 inline-block px-1.5 py-0.5 text-[10px] rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-normal">حساس</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => isMain ? toggleModule(key) : toggle(key)}
                      aria-pressed={Boolean(perms[key])}
                      aria-label={`${perms[key] ? 'غیرفعال کردن' : 'فعال کردن'} ${label}`}
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
      <div className="sticky bottom-0 z-10 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur pt-2 pb-4">
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