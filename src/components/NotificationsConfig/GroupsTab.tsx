import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, Loader as Loader2, RefreshCw, Save, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

import { GroupSelector } from './GroupSelector';
import { Toggle } from './Toggle';
import type { UserGroup } from './types';
import { NOTIFICATION_TYPES, N_CATEGORIES } from './constants';

export function GroupsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('user_groups').select('id, name, display_name').order('name').then(({ data }) => {
      const g = (data || []) as UserGroup[];
      setGroups(g);
      if (g.length > 0) setSelectedGroup(g[0].id);
    });
  }, []);

  const loadRules = useCallback(async (groupId: string) => {
    setLoading(true);
    try {
      const { data } = await supabase.from('notification_group_rules').select('*').eq('group_id', groupId);
      const map: Record<string, boolean> = {};
      for (const r of (data || [])) map[r.notification_type] = r.enabled;
      setRules(map);
    } catch {
      toast.error('خطا در بارگذاری قوانین اعلان');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (selectedGroup) loadRules(selectedGroup); }, [selectedGroup, loadRules]);

  const toggleAll = (cat: string, value: boolean) => {
    const keys = NOTIFICATION_TYPES.filter(n => n.category === cat).map(n => n.key);
    setRules(r => { const next = { ...r }; keys.forEach(k => { next[k] = value; }); return next; });
  };

  const save = async () => {
    if (!selectedGroup) return;
    setSaving(true);
    for (const [type, enabled] of Object.entries(rules)) {
      await supabase.from('notification_group_rules')
        .upsert({ group_id: selectedGroup, notification_type: type, enabled }, { onConflict: 'group_id,notification_type' });
    }
    toast.success('تنظیمات اعلان ذخیره شد');
    setSaving(false);
  };

  const allEnabledForCat = (cat: string) =>
    NOTIFICATION_TYPES.filter(n => n.category === cat).every(n => rules[n.key] !== false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-2 flex-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          اعلان‌های فعال برای گروه کاربری انتخاب‌شده اعمال می‌شود.
        </div>
        <div className="flex gap-2 items-center">
          <GroupSelector groups={groups} selected={selectedGroup} onSelect={setSelectedGroup} />
          <button onClick={() => selectedGroup && loadRules(selectedGroup)}
            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!selectedGroup && <div className="py-16 text-center text-gray-400">ابتدا یک گروه کاربری انتخاب کنید</div>}
      {selectedGroup && loading && <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-300" /></div>}

      {selectedGroup && !loading && (
        <>
          <div className="space-y-3">
            {N_CATEGORIES.map(cat => {
              const items = NOTIFICATION_TYPES.filter(n => n.category === cat);
              const allOn = allEnabledForCat(cat);
              return (
                <div key={cat} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">{cat}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{allOn ? 'همه فعال' : 'برخی غیرفعال'}</span>
                      <Toggle value={allOn} onChange={v => toggleAll(cat, v)} />
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map(n => (
                      <div key={n.key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <Bell className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{n.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${rules[n.key] !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                            {rules[n.key] !== false ? 'فعال' : 'غیرفعال'}
                          </span>
                          <Toggle value={rules[n.key] !== false} onChange={v => setRules(r => ({ ...r, [n.key]: v }))} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-start pt-2">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
