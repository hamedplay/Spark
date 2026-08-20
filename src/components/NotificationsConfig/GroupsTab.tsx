import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, Loader as Loader2, RefreshCw, Save, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

import { GroupSelector } from './GroupSelector';
import { NotificationToggle as Toggle } from '../ConfigToggle';
import type { UserGroup } from './types';
import { NOTIFICATION_TYPES, N_CATEGORIES } from './constants';

interface RegistryEvent {
  event_key: string;
  category: string;
  label_fa: string;
  is_active: boolean;
  group_rule_supported: boolean;
}

const REGISTRY_CATEGORIES = ['minutes', 'decision'];
const REGISTRY_CATEGORY_LABELS = new Set(['صورت‌جلسات', 'مصوبات']);

export function GroupsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registryEvents, setRegistryEvents] = useState<RegistryEvent[]>([]);

  useEffect(() => {
    supabase.from('user_groups').select('id, name, display_name').order('name').then(({ data }) => {
      const g = (data || []) as UserGroup[];
      setGroups(g);
      if (g.length > 0) setSelectedGroup(g[0].id);
    });

    // Load minutes/decision events from registry
    supabase
      .from('notification_event_registry')
      .select('event_key, category, label_fa, is_active, group_rule_supported')
      .in('category', REGISTRY_CATEGORIES)
      .eq('is_active', true)
      .eq('group_rule_supported', true)
      .order('category')
      .order('event_key')
      .then(({ data, error }) => {
        if (error) {
          console.warn('[GroupsTab] registry query failed, falling back to constants', error);
          return;
        }
        if (data && data.length > 0) {
          setRegistryEvents(data as RegistryEvent[]);
        }
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

  // Build the display list: registry events for minutes/decision, constants for everything else
  const allTypes = (() => {
    const staticTypes = NOTIFICATION_TYPES.filter(n => !REGISTRY_CATEGORY_LABELS.has(n.category));
    const registryTypes = registryEvents.length > 0
      ? registryEvents.map(e => ({ key: e.event_key, label: e.label_fa, category: e.category === 'minutes' ? 'صورت‌جلسات' : 'مصوبات' }))
      : NOTIFICATION_TYPES.filter(n => n.category === 'صورت‌جلسات' || n.category === 'مصوبات');
    return [...staticTypes, ...registryTypes];
  })();

  const allCategories = (() => {
    const cats = new Set<string>();
    allTypes.forEach(t => cats.add(t.category));
    return Array.from(cats);
  })();

  const toggleAll = (cat: string, value: boolean) => {
    const keys = allTypes.filter(n => n.category === cat).map(n => n.key);
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
    allTypes.filter(n => n.category === cat).every(n => rules[n.key] !== false);

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
            {allCategories.map(cat => {
              const items = allTypes.filter(n => n.category === cat);
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
