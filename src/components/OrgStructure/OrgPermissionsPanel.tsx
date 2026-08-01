import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { OrgPosition, LevelDef, LevelPermState } from './types';
import { getLevelInfo, ALL_PERMISSION_GROUPS } from './utils';
import { MINUTES_PERMISSION_KEYS, MINUTES_SUB_PERMISSIONS, MINUTES_SENSITIVE_PERMISSIONS } from '../../features/permissions/permissionRegistry';

const MINUTES_GROUP_LABEL = 'صورت‌جلسات و مصوبات';

type PositionOverrideState = Record<string, boolean>;

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
  const [levelPerms, setLevelPerms] = useState<LevelPermState>({});
  const [overrides, setOverrides] = useState<PositionOverrideState>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showViewWarning, setShowViewWarning] = useState(false);

  const levels = [...levelDefs].sort((a, b) => a.level - b.level);

  const loadLevelPerms = useCallback(async (level: number) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('org_level_permissions')
      .select('permission_key, granted')
      .eq('level', level);
    if (error) {
      toast.error('خطا در بارگذاری دسترسی‌های سطح');
      setLoading(false);
      return;
    }
    const map: LevelPermState = {};
    for (const p of (data || [])) map[p.permission_key] = p.granted;
    setPerms(map);
    setLoading(false);
  }, []);

  const loadPositionPerms = useCallback(async (positionId: string) => {
    if (!positionId) return;
    setLoading(true);
    const pos = positions.find(p => p.id === positionId);
    const levelMap: LevelPermState = {};
    if (pos) {
      const { data: ld, error: ldErr } = await supabase
        .from('org_level_permissions')
        .select('permission_key, granted')
        .eq('level', pos.level);
      if (ldErr) {
        toast.error('خطا در بارگذاری دسترسی‌های سطح پایه');
        setLoading(false);
        return;
      }
      for (const p of (ld || [])) levelMap[p.permission_key] = p.granted;
    }
    const { data: pd, error: pdErr } = await supabase
      .from('org_position_permissions')
      .select('permission_key, granted')
      .eq('position_id', positionId);
    if (pdErr) {
      toast.error('خطا در بارگذاری overrideهای سمت');
      setLoading(false);
      return;
    }
    const overrideMap: PositionOverrideState = {};
    for (const p of (pd || [])) overrideMap[p.permission_key] = p.granted;
    setLevelPerms(levelMap);
    setOverrides(overrideMap);
    setPerms({ ...levelMap, ...overrideMap });
    setLoading(false);
  }, [positions]);

  useEffect(() => {
    if (mode === 'level') loadLevelPerms(selectedLevel);
  }, [mode, selectedLevel, loadLevelPerms]);

  useEffect(() => {
    if (mode === 'position' && selectedPositionId) loadPositionPerms(selectedPositionId);
  }, [mode, selectedPositionId, loadPositionPerms]);

  const togglePerm = (key: string) => {
    if (mode === 'position') {
      const baseValue = levelPerms[key] ?? false;
      const currentOverride = overrides[key];
      const currentValue = currentOverride !== undefined ? currentOverride : baseValue;
      const nextValue = !currentValue;
      if (nextValue === baseValue) {
        setOverrides(prev => {
          const updated = { ...prev };
          delete updated[key];
          return updated;
        });
      } else {
        setOverrides(prev => ({ ...prev, [key]: nextValue }));
      }
      setPerms(prev => ({ ...prev, [key]: nextValue }));
    } else {
      if (key === 'minutes_view' && perms[key]) {
        setShowViewWarning(true);
        return;
      }
      setPerms(prev => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const confirmDisableMinutesView = () => {
    setShowViewWarning(false);
    setPerms(prev => {
      const updated = { ...prev, minutes_view: false };
      for (const k of MINUTES_SUB_PERMISSIONS) updated[k] = false;
      return updated;
    });
  };

  const cancelDisableMinutesView = () => {
    setShowViewWarning(false);
  };

  const handleToggleAllInGroup = (groupLabel: string, groupKeys: string[], enable: boolean) => {
    if (groupLabel === MINUTES_GROUP_LABEL) {
      setPerms(prev => {
        const updated = { ...prev };
        groupKeys.forEach(k => { updated[k] = enable; });
        return updated;
      });
      if (mode === 'position') {
        setOverrides(prev => {
          const updated = { ...prev };
          groupKeys.forEach(k => {
            const baseValue = levelPerms[k] ?? false;
            if (enable === baseValue) {
              delete updated[k];
            } else {
              updated[k] = enable;
            }
          });
          return updated;
        });
      }
    } else {
      setPerms(prev => {
        const updated = { ...prev };
        groupKeys.forEach(k => { updated[k] = enable; });
        return updated;
      });
      if (mode === 'position') {
        setOverrides(prev => {
          const updated = { ...prev };
          groupKeys.forEach(k => {
            const baseValue = levelPerms[k] ?? false;
            if (enable === baseValue) {
              delete updated[k];
            } else {
              updated[k] = enable;
            }
          });
          return updated;
        });
      }
    }
  };

  const handleEnableAll = () => {
    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
    setPerms(Object.fromEntries(allKeys.map(k => [k, true])));
    if (mode === 'position') {
      setOverrides({});
    }
  };

  const handleDisableAll = () => {
    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
    setPerms(Object.fromEntries(allKeys.map(k => [k, false])));
    if (mode === 'position') {
      const allOverrides: PositionOverrideState = {};
      allKeys.forEach(k => {
        const baseValue = levelPerms[k] ?? false;
        if (baseValue) allOverrides[k] = false;
      });
      setOverrides(allOverrides);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'level') {
        for (const [key, granted] of Object.entries(perms)) {
          const { error } = await supabase
            .from('org_level_permissions')
            .upsert(
              { level: selectedLevel, permission_key: key, granted },
              { onConflict: 'level,permission_key' }
            );
          if (error) {
            toast.error('خطا در ذخیره دسترسی‌های سطح');
            setSaving(false);
            return;
          }
        }
        await loadLevelPerms(selectedLevel);
      } else if (selectedPositionId) {
        const pos = positions.find(p => p.id === selectedPositionId);
        if (!pos) {
          toast.error('سمت انتخاب‌شده یافت نشد');
          setSaving(false);
          return;
        }
        for (const [key, granted] of Object.entries(overrides)) {
          const { error } = await supabase
            .from('org_position_permissions')
            .upsert(
              { position_id: selectedPositionId, permission_key: key, granted },
              { onConflict: 'position_id,permission_key' }
            );
          if (error) {
            toast.error('خطا در ذخیره override سمت');
            setSaving(false);
            return;
          }
        }
        const { data: existingOverrides } = await supabase
          .from('org_position_permissions')
          .select('permission_key')
          .eq('position_id', selectedPositionId);
        const existingKeys = new Set((existingOverrides || []).map(r => r.permission_key));
        const keysToRemove = [...existingKeys].filter(k => !(k in overrides));
        for (const key of keysToRemove) {
          const { error } = await supabase
            .from('org_position_permissions')
            .delete()
            .eq('position_id', selectedPositionId)
            .eq('permission_key', key);
          if (error) {
            toast.error('خطا در حذف override');
            setSaving(false);
            return;
          }
        }
        await loadPositionPerms(selectedPositionId);
      }
    } catch {
      toast.error('خطای غیرمنتظر در ذخیره');
    } finally {
      setSaving(false);
    }
  };

  const renderPositionStatus = (key: string) => {
    if (mode !== 'position' || !selectedPositionId) return null;
    const baseValue = levelPerms[key] ?? false;
    const hasOverride = key in overrides;
    const overrideValue = hasOverride ? overrides[key] : undefined;
    const effective = overrideValue !== undefined ? overrideValue : baseValue;
    const pos = positions.find(p => p.id === selectedPositionId);
    const levelLabel = pos ? `سطح ${pos.level}` : 'سطح پایه';
    if (hasOverride) {
      return (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
          <span>ارث‌بری از {levelLabel}: {baseValue ? 'فعال' : 'غیرفعال'}</span>
          <br />
          <span>override: {overrideValue ? 'فعال' : 'غیرفعال'}</span>
          <br />
          <span className={effective ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}>
            نتیجه: {effective ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
      );
    }
    return (
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
        <span>ارث‌بری از {levelLabel}: {baseValue ? 'فعال' : 'غیرفعال'}</span>
      </div>
    );
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
            {mode === 'position' && selectedPositionId && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                دسترسی گروه‌های کاربری ممکن است نتیجه نهایی کاربر را تغییر دهد.
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
                  const isMinutesGroup = group.group === MINUTES_GROUP_LABEL;
                  return (
                    <div key={group.group} className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                      <div
                        className="px-3 py-2 flex items-center justify-between"
                        style={{ backgroundColor: group.color + '18', borderBottom: `2px solid ${group.color}33` }}
                      >
                        <span className="text-xs font-bold" style={{ color: group.color }}>{group.group}</span>
                        <button
                          onClick={() => handleToggleAllInGroup(group.group, groupKeys, !allGranted)}
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
                        {group.keys.map(item => {
                          const isSensitive = isMinutesGroup && MINUTES_SENSITIVE_PERMISSIONS.includes(item.key);
                          return (
                            <label
                              key={item.key}
                              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                                  {isSensitive && (
                                    <span
                                      className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"
                                      title="دسترسی حساس"
                                    />
                                  )}
                                </div>
                                {renderPositionStatus(item.key)}
                              </div>
                              <div
                                onClick={() => togglePerm(item.key)}
                                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${!perms[item.key] ? 'bg-gray-300 dark:bg-gray-600' : ''}`}
                                style={perms[item.key] ? { backgroundColor: group.color } : {}}
                              >
                                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms[item.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 pb-4 flex gap-3 justify-end flex-wrap">
                <button
                  onClick={handleEnableAll}
                  className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 rounded-xl transition-colors"
                >
                  فعال‌سازی همه
                </button>
                <button
                  onClick={handleDisableAll}
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

      {/* مودال تأیید خاموش‌کردن minutes_view */}
      {showViewWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">
              غیرفعال‌سازی دسترسی پایه
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
              با خاموش‌کردن «مشاهده صورت‌جلسات و مصوبات»، دسترسی پایه این ماژول غیرفعال می‌شود و تمام دسترسی‌های فرعی این کارت نیز غیرفعال خواهند شد. آیا ادامه می‌دهید؟
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDisableMinutesView}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors"
              >
                انصراف
              </button>
              <button
                onClick={confirmDisableMinutesView}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors"
              >
                بله، غیرفعال کن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { OrgPermissionsPanel };
