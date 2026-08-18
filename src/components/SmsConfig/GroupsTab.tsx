import { useState, useEffect, useCallback } from 'react';
import { Group as GroupIcon, Check, ChevronDown, Loader as Loader2, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import {
  TEMPLATE_CATEGORIES as SMS_CATEGORIES,
} from '../../config/templateCatalog';
import type { SmsProvider, UserGroup } from './types';
import { CATEGORY_COLORS, inp } from './types';
import { SmsToggle as Toggle } from '../ConfigToggle';

function GroupSelector({ groups, selected, onSelect }: { groups: UserGroup[]; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = groups.find(g => g.id === selected);
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-green-400 transition-colors min-w-52">
        <GroupIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
        <span className="flex-1 text-right truncate">{current ? (current.display_name || current.name) : 'انتخاب گروه کاربری'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
          {groups.map(g => (
            <button key={g.id} onClick={() => { onSelect(g.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${selected === g.id ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
              <GroupIcon className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-200">{g.display_name || g.name}</span>
              {selected === g.id && <Check className="w-3.5 h-3.5 text-green-500 mr-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GroupsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [rules, setRules] = useState<Record<string, { enabled: boolean; provider_id: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('user_groups').select('id, name, display_name').order('name').then(({ data }) => {
      const g = (data || []) as UserGroup[];
      setGroups(g);
      if (g.length > 0) setSelectedGroup(g[0].id);
    });
    supabase.from('sms_providers').select('id, title, is_active, provider_type').eq('is_active', true).then(({ data }) => {
      setProviders((data || []) as SmsProvider[]);
    });
  }, []);

  const loadRules = useCallback(async (groupId: string) => {
    setLoading(true);
    const { data } = await supabase.from('sms_group_rules').select('*').eq('group_id', groupId);
    const map: Record<string, { enabled: boolean; provider_id: string | null }> = {};
    for (const r of (data || [])) map[r.sms_category] = { enabled: r.enabled, provider_id: r.provider_id };
    setRules(map);
    setLoading(false);
  }, []);

  useEffect(() => { if (selectedGroup) loadRules(selectedGroup); }, [selectedGroup, loadRules]);

  const save = async () => {
    if (!selectedGroup) return;
    setSaving(true);
    for (const [cat, val] of Object.entries(rules)) {
      await supabase.from('sms_group_rules').upsert(
        { group_id: selectedGroup, sms_category: cat, enabled: val.enabled, provider_id: val.provider_id || null },
        { onConflict: 'group_id,sms_category' }
      );
    }
    toast.success('تنظیمات پیامک ذخیره شد');
    setSaving(false);
  };

  const getRuleFor = (cat: string) => rules[cat] ?? { enabled: false, provider_id: null };
  const setRule = (cat: string, k: 'enabled' | 'provider_id', v: any) =>
    setRules(r => ({ ...r, [cat]: { ...getRuleFor(cat), [k]: v } }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">برای هر گروه کاربری مشخص کنید چه دسته پیامک‌هایی ارسال شود</p>
        <GroupSelector groups={groups} selected={selectedGroup} onSelect={setSelectedGroup} />
      </div>

      {!selectedGroup && <div className="py-16 text-center text-gray-400">ابتدا یک گروه کاربری انتخاب کنید</div>}
      {selectedGroup && loading && <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {selectedGroup && !loading && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="grid grid-cols-3 px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
              <span>دسته پیامک</span>
              <span className="text-center">فعال</span>
              <span className="text-center">سرویس‌دهنده</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {SMS_CATEGORIES.map(cat => {
                const rule = getRuleFor(cat.key);
                return (
                  <div key={cat.key} className="grid grid-cols-3 items-center px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors gap-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[cat.key] || ''}`}>{cat.label}</span>
                    </div>
                    <div className="flex justify-center">
                      <Toggle value={rule.enabled} onChange={v => setRule(cat.key, 'enabled', v)} />
                    </div>
                    <div className="flex justify-center">
                      {rule.enabled ? (
                        <div className="relative">
                          <select
                            value={rule.provider_id || ''}
                            onChange={e => setRule(cat.key, 'provider_id', e.target.value || null)}
                            className="appearance-none text-xs pr-2 pl-6 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-202 focus:outline-none focus:ring-1 focus:ring-green-500 max-w-36 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-700 dark:[&>option]:text-white"
                          >
                            <option value="">پیش‌فرض (سرویس‌دهنده اصلی)</option>
                            {providers.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.title}{p.provider_type === 'rahyab' ? ' (SOAP)' : p.provider_type === 'rahyab_rest' ? ' (REST)' : ''}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-start">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
