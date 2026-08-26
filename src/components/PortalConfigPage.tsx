import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Settings, Shield, Globe, Video, Calendar, Server, ChevronDown, ChevronLeft, Plus, Trash2, X, RefreshCw, Wifi, Mail, Image, Palette, Monitor, Menu } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import toast from 'react-hot-toast';
const UserManagementPanel = lazy(() => import('./UserManagementPanel').then(m => ({ default: m.UserManagementPanel })));
const UserGroupsPanel = lazy(() => import('./UserGroupsPanel').then(m => ({ default: m.UserGroupsPanel })));
const GroupEventsPanel = lazy(() => import('./UserGroupsPanel').then(m => ({ default: m.GroupEventsPanel })));
const NotificationsConfigPanel = lazy(() => import('./NotificationsConfigPanel').then(m => ({ default: m.NotificationsConfigPanel })));
const SmsConfigPanel = lazy(() => import('./SmsConfigPanel').then(m => ({ default: m.SmsConfigPanel })));
const CalendarOccasionsPanel = lazy(() => import('./CalendarOccasionsPanel').then(m => ({ default: m.CalendarOccasionsPanel })));
const OrgStructurePage = lazy(() => import('./OrgStructurePage').then(m => ({ default: m.OrgStructurePage })));
const SparkConfigPanel = lazy(() => import('./SparkConfigPanel').then(m => ({ default: m.SparkConfigPanel })));
const SocialNotificationsPanel = lazy(() => import('./SocialNotificationsPanel').then(m => ({ default: m.SocialNotificationsPanel })));
const DailyReportConfigPanel = lazy(() => import('./DailyReportConfigPanel').then(m => ({ default: m.DailyReportConfigPanel })));
const SystemMonitoringPage = lazy(() => import('./SystemMonitoringPage').then(m => ({ default: m.SystemMonitoringPage })));
const MinutesConfigPanel = lazy(() => import('./Minutes/MinutesConfigPanel').then(m => ({ default: m.MinutesConfigPanel })));
const AuditLogPage = lazy(() => import('./AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const BackupPanel = lazy(() => import('./BackupPanel').then(m => ({ default: m.BackupPanel })));
const IceTesterPanel = lazy(() => import('./VideoConference/IceTesterPanel').then(m => ({ default: m.IceTesterPanel })));

import { NAV_ITEMS, VISIBLE_SECURITY_CONFIG_KEYS } from './PortalConfig/constants';
import { ConfigField } from './PortalConfig/ConfigField';
import { SectionCard } from './PortalConfig/SectionCard';
import { PhoneAuthCard } from './PortalConfig/PhoneAuthCard';
import { IdentityRepairCard } from './PortalConfig/IdentityRepairCard';
import type { ConfigEntry, Profile, Props } from './PortalConfig/types';
import { usePermissions } from '../context/PermissionsContext';
import { canAccessConfigSection, getFirstVisibleConfigSection, getVisibleConfigNavigationItems } from '../features/permissions/configPermissions';

export function PortalConfigPage({ currentUserId }: Props) {
  const { isAdmin, userPermissions } = usePermissions();
  const [activeSection, setActiveSection] = useState('general');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Profile[]>([]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const visibleNavItems = getVisibleConfigNavigationItems(NAV_ITEMS, isAdmin, userPermissions);
  const firstVisibleSection = getFirstVisibleConfigSection(visibleNavItems);
  const canAccessActiveSection = canAccessConfigSection(activeSection, isAdmin, userPermissions);

  useEffect(() => {
    if (!canAccessActiveSection && firstVisibleSection) setActiveSection(firstVisibleSection);
  }, [activeSection, canAccessActiveSection, firstVisibleSection]);

  // Load configs
  const loadConfigs = useCallback(async () => {
    const { data } = await supabase.from('system_config').select('*').order('section').order('key');
    if (data) setConfigs(data as ConfigEntry[]);
  }, []);

  // Load truly online users (last seen within 3 minutes)
  const loadOnlineUsers = useCallback(async () => {
    const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: presenceRows } = await supabase
      .from('user_presence')
      .select('user_id, last_seen, is_online')
      .gte('last_seen', threshold);
    if (!presenceRows || presenceRows.length === 0) { setOnlineUsers([]); return; }
    const onlineIds = presenceRows.map(r => r.user_id);
    const { data: pData } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', onlineIds);
    setOnlineUsers((pData || []) as Profile[]);
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);
  useEffect(() => { if (activeSection === 'users_online') loadOnlineUsers(); }, [activeSection, loadOnlineUsers]);

  const saveConfig = async (id: string, value: string) => {
    const cfg = configs.find(c => c.id === id);
    const { error } = await supabase.from('system_config').update({ value, updated_by: currentUserId, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('خطا در ذخیره تنظیمات'); return; }
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, value } : c));
    toast.success('ذخیره شد');
    logAudit({ module: 'system_config', action: 'config_updated', entity_name: cfg ? `${cfg.section}.${cfg.key}` : id, details: `مقدار جدید: ${value}`, severity: 'info' });
  };

  const cfgs = (section: string) => configs.filter(c => c.section === section);

  // Upload an image to portal-assets bucket and save the public URL to system_config
  const uploadAsset = async (configKey: string, file: File) => {
    const ext = file.name.split('.').pop();
    const path = `${configKey}-${Date.now()}.${ext}`;
    setUploadingKey(configKey);
    try {
      const { error: uploadError } = await supabase.storage.from('portal-assets').upload(path, file, { upsert: true });
      if (uploadError) { toast.error('خطا در آپلود فایل'); return; }
      const { data: urlData } = supabase.storage.from('portal-assets').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      // Find config entry by key and save
      const entry = configs.find(c => c.section === 'appearance' && c.key === configKey);
      if (entry) { await saveConfig(entry.id, publicUrl); }
      else {
        // upsert
        await supabase.from('system_config').upsert({ section: 'appearance', key: configKey, value: publicUrl, value_type: 'string', label: configKey }, { onConflict: 'section,key' });
        await loadConfigs();
      }
      toast.success('آپلود شد');
    } finally { setUploadingKey(null); }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const isOpen = prev.has(key);
      return isOpen ? new Set<string>() : new Set<string>([key]);
    });
  };

  // ── Render content ──────────────────────────────────────────────────────────
  const renderContent = () => {
    if (!canAccessActiveSection) {
      return <div className="py-20 text-center text-sm text-gray-500 dark:text-gray-400">برای این بخش مجوز دسترسی ندارید.</div>;
    }
    switch (activeSection) {
      // ── General ──────────────────────────────────────────────────────────
      case 'general':
        return (
          <div className="space-y-5">
            <SectionCard title="تنظیمات کلی سامانه" icon={Settings} color="blue">
              {cfgs('general').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
          </div>
        );

      // ── UI Settings ───────────────────────────────────────────────────────
      case 'ui_settings':
        return (
          <div className="space-y-5">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  <Menu className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-gray-800 dark:text-white">تنظیمات محیطی رابط کاربری</h3>
              </div>
              <div className="p-5 space-y-4">
                {(() => {
                  const entry = cfgs('ui').find(c => c.key === 'sidebar_default_collapsed');
                  const isCollapsed = !entry || entry.value === 'true' || entry.value === null;
                  return (
                    <div className="flex items-start justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">منوی کناری به صورت پیش‌فرض بسته باشد</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {isCollapsed
                            ? 'در ورود اولیه، منوی کناری به صورت آیکن‌تنها نمایش داده می‌شود'
                            : 'در ورود اولیه، منوی کناری کامل (با نام‌ها) نمایش داده می‌شود'}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          const newVal = isCollapsed ? 'false' : 'true';
                          if (entry) {
                            await saveConfig(entry.id, newVal);
                          } else {
                            await supabase.from('system_config').upsert({ section: 'ui', key: 'sidebar_default_collapsed', value: newVal, value_type: 'boolean', label: 'منوی کناری به صورت پیش‌فرض بسته باشد' }, { onConflict: 'section,key' });
                            await loadConfigs();
                          }
                        }}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${isCollapsed ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isCollapsed ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );

      // ── Appearance ───────────────────────────────────────────────────────
      case 'appearance':
        return (
          <div className="space-y-5">
            <SectionCard title="ظاهر و برندینگ" icon={Palette} color="teal">
              {cfgs('appearance').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>

            {/* Splash screen toggle */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
              <h4 className="font-bold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
                <Monitor className="w-4 h-4 text-teal-500" />انیمیشن ورود (Splash Screen)
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">نمایش موشن‌گرافی لوگو هنگام بارگذاری اولیه سامانه</p>
              {(() => {
                const entry = cfgs('appearance').find(c => c.key === 'splash_enabled');
                const isEnabled = !entry || entry.value === 'true' || entry.value === null;
                return (
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">فعال‌سازی انیمیشن ورود</span>
                    <button
                      onClick={async () => {
                        const newVal = isEnabled ? 'false' : 'true';
                        if (entry) {
                          await saveConfig(entry.id, newVal);
                        } else {
                          await supabase.from('system_config').upsert({ section: 'appearance', key: 'splash_enabled', value: newVal, value_type: 'boolean', label: 'انیمیشن ورود' }, { onConflict: 'section,key' });
                          await loadConfigs();
                        }
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors ${isEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isEnabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                );
              })()}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
              <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2"><Image className="w-4 h-4 text-teal-500" />آپلود لوگو و آیکن</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {([
                  { key: 'logo_url', label: 'لوگو اصلی', fmt: 'PNG, GIF, JPEG, SVG', accept: 'image/*' },
                  { key: 'favicon_url', label: 'آیکن (Favicon)', fmt: 'PNG — 32×32px', accept: 'image/png' },
                  { key: 'mobile_logo_url', label: 'لوگو موبایل', fmt: 'PNG, GIF, JPEG', accept: 'image/*' },
                  { key: 'og_image_url', label: 'تصویر معرفی', fmt: 'PNG, GIF, JPEG', accept: 'image/*' },
                ] as const).map(({ key, label, fmt, accept }) => {
                  const current = cfgs('appearance').find(c => c.key === key)?.value;
                  const isUploading = uploadingKey === key;
                  return (
                    <label key={key} className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl p-4 flex flex-col items-center gap-2 hover:border-teal-400 transition-colors cursor-pointer">
                      <input type="file" accept={accept} className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAsset(key, f); e.target.value = ''; }} />
                      <div className="w-20 h-14 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center overflow-hidden">
                        {current ? (
                          <img src={current} alt={label} className="w-full h-full object-contain p-1" />
                        ) : (
                          <Image className="w-6 h-6 text-gray-400" />
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
                      <p className="text-xs text-gray-400">انواع مجاز: {fmt}</p>
                      {isUploading ? (
                        <span className="text-xs text-teal-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />در حال آپلود...</span>
                      ) : (
                        <span className="text-xs text-teal-500 hover:text-teal-600 flex items-center gap-1"><Plus className="w-3 h-3" />{current ? 'تغییر فایل' : 'بارگذاری فایل'}</span>
                      )}
                      {current && !isUploading && (
                        <button type="button" onClick={async e => { e.preventDefault(); const entry = cfgs('appearance').find(c => c.key === key); if (entry) await saveConfig(entry.id, ''); }}
                          className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3" />حذف</button>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );

      // ── Regional ─────────────────────────────────────────────────────────
      case 'regional':
        return (
          <div className="space-y-5">
            <SectionCard title="تنظیمات منطقه‌ای" icon={Globe} color="green">
              {cfgs('regional').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
              <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2"><Calendar className="w-4 h-4 text-green-500" />روزهای کاری</h4>
              <div className="flex flex-wrap gap-2">
                {['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'].map(day => {
                  const entry = cfgs('regional').find(c => c.key === 'work_days');
                  const active = (entry?.value || '').includes(day);
                  return (
                    <button key={day} onClick={() => {
                      if (!entry) return;
                      const days = (entry.value || '').split(',').filter(Boolean);
                      const next = active ? days.filter(d => d !== day) : [...days, day];
                      saveConfig(entry.id, next.join(','));
                    }}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${active ? 'bg-green-500 text-white border-green-500' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-green-400'}`}>
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      // ── Users list ────────────────────────────────────────────────────────
      case 'users_list':
        return <UserManagementPanel currentUserId={currentUserId} />;

      // ── Online users ─────────────────────────────────────────────────────
      case 'users_online':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Wifi className="w-5 h-5 text-green-500" />کاربران آنلاین
                <span className="text-sm font-normal text-gray-400">({onlineUsers.length} نفر)</span>
              </h3>
              <button onClick={loadOnlineUsers} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
              کاربرانی نمایش داده می‌شوند که در ۳ دقیقه اخیر فعال بوده‌اند.
            </div>
            {onlineUsers.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Wifi className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">در حال حاضر کاربری آنلاین نیست</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {onlineUsers.map(p => (
                  <div key={p.user_id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
                        {(p.full_name || p.email || '?')[0].toUpperCase()}
                      </div>
                      <span className="absolute bottom-0 left-0 w-3 h-3 rounded-full bg-green-400 border-2 border-white dark:border-gray-800" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 dark:text-white text-sm truncate">{p.full_name || '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{p.email}</p>
                    </div>
                    {p.is_admin && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full flex-shrink-0">ادمین</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      // ── User groups ───────────────────────────────────────────────────────
      case 'user_groups':
        return <UserGroupsPanel currentUserId={currentUserId} />;

      // ── Group events ──────────────────────────────────────────────────────
      case 'group_events':
        return <GroupEventsPanel />;

      // ── Org structure ─────────────────────────────────────────────────────
      case 'org_structure':
        return <OrgStructurePage />;

      // ── Security ──────────────────────────────────────────────────────────
      case 'security':
        return (
          <div className="space-y-5">
            <SectionCard title="امنیت و دسترسی" icon={Shield} color="red">
              {cfgs('security').filter(c => VISIBLE_SECURITY_CONFIG_KEYS.has(c.key)).map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
            <PhoneAuthCard />
            <IdentityRepairCard />
          </div>
        );

      // ── Server ────────────────────────────────────────────────────────────
      case 'server':
        return (
          <div className="space-y-5">
            <SectionCard title="دسترسی سرور" icon={Server} color="gray">
              {cfgs('server').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
          </div>
        );

      // ── Audit log ─────────────────────────────────────────────────────────
      case 'audit_log':
        return <AuditLogPage />;

      // ── Notifications ─────────────────────────────────────────────────────
      case 'notifications':
        return <NotificationsConfigPanel />;

      // ── SMS ───────────────────────────────────────────────────────────────
      case 'sms':
        return <SmsConfigPanel />;

      // ── Social Notifications ───────────────────────────────────────────────
      case 'social_notifications':
        return <SocialNotificationsPanel />;

      // ── Email ─────────────────────────────────────────────────────────────
      case 'email':
        return (
          <div className="space-y-5">
            <SectionCard title="تنظیمات پست الکترونیک" icon={Mail} color="blue">
              {cfgs('email').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
          </div>
        );

      // ── Daily Report ──────────────────────────────────────────────────────
      case 'daily_report':
        return <DailyReportConfigPanel />;

      // ── Video conference ──────────────────────────────────────────────────
      case 'video_conference':
        return (
          <div className="space-y-5">
            <SectionCard title="تنظیمات ویدیو کنفرانس" icon={Video} color="teal">
              {cfgs('video_conference').filter(c => c.key !== 'ice_transport_policy').map(c => (
                <ConfigField key={c.id} entry={c} onSave={saveConfig} />
              ))}
              {cfgs('video_conference').filter(c => c.key === 'ice_transport_policy').map(c => (
                <div key={c.id} className="md:col-span-2">
                  <ConfigField entry={c} onSave={saveConfig} />
                </div>
              ))}
            </SectionCard>
            <IceTesterPanel configs={cfgs('video_conference')} />
          </div>
        );

      // ── Calendar ──────────────────────────────────────────────────────────
      case 'calendar':
        return (
          <div className="space-y-5">
            <SectionCard title="تنظیمات تقویم" icon={Calendar} color="green">
              {cfgs('calendar').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
            <SectionCard title="مناسبت‌های تقویم" icon={Calendar} color="blue">
              <CalendarOccasionsPanel />
            </SectionCard>
          </div>
        );

      // ── Monitoring ────────────────────────────────────────────────────────
      case 'monitoring':
        return <SystemMonitoringPage />;

      // ── Minutes config ──────────────────────────────────────────────────────
      case 'minutes_config':
        return <MinutesConfigPanel currentUserId={currentUserId} />;

      // ── Spark config ──────────────────────────────────────────────────────
      case 'spark_config':
        return <SparkConfigPanel />;

      // ── Backup ────────────────────────────────────────────────────────────
      case 'backup':
        return (
          <div className="p-6">
            <BackupPanel />
          </div>
        );

      default:
        return <div className="text-gray-400 text-center py-20">بخش در حال توسعه است</div>;

    }
  };

  // ── Breadcrumb ──────────────────────────────────────────────────────────────
  const breadcrumb = (() => {
    for (const group of visibleNavItems) {
      const sub = group.sub.find(s => s.key === activeSection);
      if (sub) return `${group.label} / ${sub.label}`;
    }
    return '';
  })();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const SidebarNav = ({ onSelect }: { onSelect?: () => void }) => (
    <nav className="flex-1 p-2 space-y-0.5">
      {visibleNavItems.map(group => {
        const Icon = group.icon;
        const isOpen = expandedGroups.has(group.key);
        return (
          <div key={group.key}>
            <button onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-colors uppercase tracking-wider">
              <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" />{group.label}</span>
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
            {isOpen && (
              <div className="mr-4 border-r border-gray-100 dark:border-gray-700 pr-2 space-y-0.5 mt-0.5">
                {group.sub.map(s => (
                  <button key={s.key} onClick={() => { setActiveSection(s.key); onSelect?.(); }}
                    className={`w-full text-right px-3 py-1.5 text-sm rounded-xl transition-colors ${activeSection === s.key ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full overflow-hidden bg-gray-50 dark:bg-gray-900" dir="rtl">
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-[200] lg:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute top-0 right-0 h-full w-64 bg-white dark:bg-gray-800 flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 text-sm">
                <Settings className="w-4 h-4 text-blue-500" /> پیکربندی
              </h2>
              <button onClick={() => setMobileSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <SidebarNav onSelect={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex w-56 flex-shrink-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 text-sm">
            <Settings className="w-4 h-4 text-blue-500" /> پیکربندی
          </h2>
        </div>
        <SidebarNav />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Breadcrumb bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile menu button */}
            <button onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 flex-shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 min-w-0">
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span className="text-gray-400 hidden sm:inline">/</span>
              <span className="text-gray-700 dark:text-gray-200 font-medium truncate">{breadcrumb}</span>
            </div>
          </div>
          <button onClick={() => { loadConfigs(); if (activeSection === 'users_online') loadOnlineUsers(); }}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors flex-shrink-0">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <Suspense fallback={(
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          )}>
            {renderContent()}
          </Suspense>
        </div>
      </div>
    </div>
  );
}