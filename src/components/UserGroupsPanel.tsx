import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Plus, RefreshCw, EllipsisVertical as MoreVertical, CreditCard as Edit2, Trash2, ShieldCheck, Check, X, Group as GroupIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

import { GroupForm } from './UserGroups/GroupForm';
import { DeletePanel } from './UserGroups/DeletePanel';
import { MembersPanel } from './UserGroups/MembersPanel';
import { AccessPanel } from './UserGroups/AccessPanel';
import { GroupEventsPanel } from './UserGroups/GroupEventsPanel';
import type { UserGroup, Panel, Props } from './UserGroups/types';
import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';
import { usePermissions } from '../context/PermissionsContext';
import { AccessDenied } from '../features/permissions';

export { GroupEventsPanel };

export function UserGroupsPanel({}: Props) {
  const { hasPermission } = usePermissions();
  const canManageAccess = hasPermission('config_users.user_groups.permissions');
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [panel, setPanel] = useState<Panel>('list');
  const [selected, setSelected] = useState<UserGroup | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('user_groups').select('*').order('name');
    if (!data) return;
    const withCounts = await Promise.all(data.map(async g => {
      const { count } = await supabase.from('user_group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id);
      return { ...g, permissions: (g.permissions || {}) as Record<string, boolean>, member_count: count ?? 0 };
    }));
    setGroups(withCounts);
  }, []);

  useEffect(() => { load(); }, [load]);

  useDismissOnOutsideClick(menuOpen !== null, menuRef, setMenuOpen);

  const openPanel = (p: Panel, group: UserGroup) => {
    setSelected(group);
    setPanel(p);
    setMenuOpen(null);
  };

  const goBack = () => { setPanel('list'); setSelected(null); };
  const doneAndBack = () => { load(); goBack(); };

  const filtered = groups.filter(g =>
    !search || (g.display_name || '').includes(search) || g.name.includes(search) || (g.description || '').includes(search)
  );

  const menuItems = (g: UserGroup) => [
    { icon: Edit2, label: 'ویرایش گروه', panel: 'edit' as Panel, color: 'text-blue-500' },
    { icon: Users, label: 'مدیریت اعضا', panel: 'members' as Panel, color: 'text-teal-500' },
    ...(canManageAccess ? [{ icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' }] : []),
    { icon: Trash2, label: 'حذف گروه', panel: 'delete' as Panel, color: g.is_system ? 'text-gray-300' : 'text-red-500' },
  ];

  // ── non-list panels ────────────────────────────────────────────────────────
  if (panel === 'add') return <GroupForm group={null} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'edit' && selected) return <GroupForm group={selected} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'delete' && selected) return <DeletePanel group={selected} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'members' && selected) return <MembersPanel group={selected} onBack={goBack} />;
  if (panel === 'access' && selected) return canManageAccess ? <AccessPanel group={selected} onBack={goBack} /> : <AccessDenied onReturn={goBack} />;

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <GroupIcon className="w-5 h-5 text-blue-500" />گروه‌های کاربری
          <span className="text-sm font-normal text-gray-400">({groups.length})</span>
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40" />
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setPanel('add')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />گروه جدید
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-right">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">گروه</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">اعضا</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">سیستمی</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عمومی</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(g => (
                <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                        <GroupIcon className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 dark:text-white">{g.display_name || g.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{g.name}</div>
                        {g.description && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{g.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                      <Users className="w-3.5 h-3.5" />{g.member_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.is_system
                      ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30"><Check className="w-3 h-3 text-amber-600 dark:text-amber-400" /></span>
                      : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700"><X className="w-3 h-3 text-gray-400" /></span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.is_public
                      ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30"><Check className="w-3 h-3 text-green-600 dark:text-green-400" /></span>
                      : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700"><X className="w-3 h-3 text-gray-400" /></span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-block" ref={menuOpen === g.id ? menuRef : undefined}>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === g.id ? null : g.id); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuOpen === g.id && (
                        <div
                          className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1"
                          onClick={e => e.stopPropagation()}>
                          {menuItems(g).map(({ icon: Icon, label, panel: target, color }) => (
                            <button key={target} onClick={() => openPanel(target, g)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right">
                              <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                              <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-14 text-gray-400">گروهی یافت نشد</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
