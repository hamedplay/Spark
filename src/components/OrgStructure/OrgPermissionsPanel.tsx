import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { OrgPosition, LevelDef, LevelPermState } from './types';
import { getLevelInfo, ALL_PERMISSION_GROUPS } from './utils';

function OrgPermissionsPanel({
  positions,
  levelDefs,
}: {
  positions: OrgPosition[];
  levelDefs: LevelDef[];
}) {
  const [mode, setMode] = useState<'level' | 'position'>('level');
  const [selectedLevel, setSelectedLevel] = useState<number>(1);
  const [selectedPositionId, setSelectedPositionId] = useState<string>('');
  const [perms, setPerms] = useState<LevelPermState>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const levels = [...levelDefs].sort((a, b) => a.level - b.level);

  const loadLevelPerms = async (level: number) => {
    setLoading(true);
    const { data } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', level);
    const map: LevelPermState = {};
    for (const p of (data || [])) map[p.permission_key] = p.granted;
    setPerms(map);
    setLoading(false);
  };

  const loadPositionPerms = async (positionId: string) => {
    if (!positionId) return;
    setLoading(true);
    // ابتدا دسترسی‌های سطح پایه را بگیر
    const pos = positions.find(p => p.id === positionId);
    const levelMap: LevelPermState = {};
    if (pos) {
      const { data: ld } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', pos.level);
      for (const p of (ld || [])) levelMap[p.permission_key] = p.granted;
    }
    // سپس override های پست خاص
    const { data: pd } = await supabase.from('org_position_permissions').select('permission_key, granted').eq('position_id', positionId);
    const overrideMap: LevelPermState = {};
    for (const p of (pd || [])) overrideMap[p.permission_key] = p.granted;
    setPerms({ ...levelMap, ...overrideMap });
    setLoading(false);
  };

  useEffect(() => {
    if (mode === 'level') loadLevelPerms(selectedLevel);
  }, [mode, selectedLevel]);

  useEffect(() => {
    if (mode === 'position' && selectedPositionId) loadPositionPerms(selectedPositionId);
  }, [mode, selectedPositionId]);

  const togglePerm = (key: string) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'level') {
        for (const [key, granted] of Object.entries(perms)) {
          await supabase.from('org_level_permissions')
            .upsert({ level: selectedLevel, permission_key: key, granted }, { onConflict: 'level,permission_key' });
        }
        // حذف کلیدهایی که کاملاً نیستند
        const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
        for (const key of allKeys) {
          if (!(key in perms)) {
            await supabase.from('org_level_permissions')
              .delete().eq('level', selectedLevel).eq('permission_key', key);
          }
        }
        toast.success('دسترسی‌های سطح ذخیره شد');
      } else if (selectedPositionId) {
        // فقط override ها را ذخیره کن (تفاوت با سطح پایه)
        const pos = positions.find(p => p.id === selectedPositionId);
        const levelMap: LevelPermState = {};
        if (pos) {
          const { data: ld } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', pos.level);
          for (const p of (ld || [])) levelMap[p.permission_key] = p.granted;
        }
        // ابتدا همه override های قبلی را پاک کن
        await supabase.from('org_position_permissions').delete().eq('position_id', selectedPositionId);
        // فقط تفاوت‌ها را بنویس
        const overrides: { position_id: string; permission_key: string; granted: boolean }[] = [];
        for (const [key, granted] of Object.entries(perms)) {
          if (levelMap[key] !== granted) {
            overrides.push({ position_id: selectedPositionId, permission_key: key, granted });
          }
        }
        if (overrides.length > 0) {
          await supabase.from('org_position_permissions').insert(overrides);
        }
        toast.success('دسترسی‌های پست ذخیره شد');
      }
    } catch {
      toast.error('خطا در ذخیره');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {/* حالت انتخاب */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('level')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'level' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            دسترسی بر اساس سطح
          </button>
          <button
            onClick={() => setMode('position')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'position' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            override برای پست خاص
          </button>
        </div>

        {mode === 'level' ? (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">انتخاب سطح سازمانی:</p>
            <div className="flex flex-wrap gap-2">
              {levels.map(l => (
                <button
                  key={l.level}
                  onClick={() => setSelectedLevel(l.level)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${selectedLevel === l.level ? 'border-transparent text-white shadow-sm' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'}`}
                  style={selectedLevel === l.level ? { backgroundColor: l.color } : {}}
                >
                  <span>{l.icon}</span> {l.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">انتخاب پست سازمانی:</p>
            <select
              value={selectedPositionId}
              onChange={e => setSelectedPositionId(e.target.value)}
              className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="">— پست را انتخاب کنید —</option>
              {[...positions].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title)).map(p => {
                const lvl = getLevelInfo(p.level, levelDefs);
                return <option key={p.id} value={p.id}>{lvl.icon} {p.title} (سطح {p.level})</option>;
              })}
            </select>
            {selectedPositionId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                تغییرات این بخش فقط روی این پست اعمال می‌شود و سطح پایه را تغییر نمی‌دهد.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ماتریس دسترسی‌ها */}
      {(mode === 'level' || selectedPositionId) && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">در حال بارگذاری...</div>
          ) : (
            <>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {ALL_PERMISSION_GROUPS.map(group => {
                  const groupKeys = group.keys.map(k => k.key);
                  const allGranted = groupKeys.every(k => !!perms[k]);
                  const someGranted = groupKeys.some(k => !!perms[k]);
                  return (
                    <div key={group.group} className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                      <div
                        className="px-3 py-2 flex items-center justify-between"
                        style={{ backgroundColor: group.color + '18', borderBottom: `2px solid ${group.color}33` }}
                      >
                        <span className="text-xs font-bold" style={{ color: group.color }}>{group.group}</span>
                        <button
                          onClick={() => {
                            const next = !allGranted;
                            setPerms(prev => {
                              const updated = { ...prev };
                              groupKeys.forEach(k => { updated[k] = next; });
                              return updated;
                            });
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                          style={{
                            backgroundColor: allGranted ? group.color : someGranted ? group.color + '40' : '#e5e7eb',
                            color: allGranted ? '#fff' : someGranted ? group.color : '#9ca3af',
                          }}
                        >
                          {allGranted ? 'همه فعال' : someGranted ? 'ناقص' : 'همه غیرفعال'}
                        </button>
                      </div>
                      <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {group.keys.map(item => (
                          <label key={item.key} className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                            <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                            <div
                              onClick={() => togglePerm(item.key)}
                              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${!perms[item.key] ? 'bg-gray-300 dark:bg-gray-600' : ''}`}
                              style={perms[item.key] ? { backgroundColor: group.color } : {}}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms[item.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 pb-4 flex gap-3 justify-end">
                <button
                  onClick={() => {
                    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
                    setPerms(Object.fromEntries(allKeys.map(k => [k, true])));
                  }}
                  className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 rounded-xl transition-colors"
                >
                  فعال‌سازی همه
                </button>
                <button
                  onClick={() => {
                    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
                    setPerms(Object.fromEntries(allKeys.map(k => [k, false])));
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 rounded-xl transition-colors"
                >
                  غیرفعال‌سازی همه
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {saving ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { OrgPermissionsPanel };
