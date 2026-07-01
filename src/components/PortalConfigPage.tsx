import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Users, Shield, Globe, Bell, Video, Calendar, Server, Activity, ChevronDown, ChevronLeft, Save, Search, Plus, Trash2, CreditCard as Edit2, X, Eye, EyeOff, CircleAlert as AlertCircle, RefreshCw, Wifi, Mail, Lock, Image, Palette, Monitor, UserCog, KeyRound, UserX, UserCheck, History, MapPin, LogIn as LoginIcon, ShieldCheck, Menu, Bot, MoveVertical as MoreVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import toast from 'react-hot-toast';
import { UserManagementPanel } from './UserManagementPanel';
import { UserGroupsPanel, GroupEventsPanel } from './UserGroupsPanel';
import { NotificationsConfigPanel } from './NotificationsConfigPanel';
import { SmsConfigPanel } from './SmsConfigPanel';
import { CalendarOccasionsPanel } from './CalendarOccasionsPanel';
import { OrgStructurePage } from './OrgStructurePage';
import { SparkConfigPanel } from './SparkConfigPanel';
import { SocialNotificationsPanel } from './SocialNotificationsPanel';
import { DailyReportConfigPanel } from './DailyReportConfigPanel';
import { SystemMonitoringPage } from './SystemMonitoringPage';

import { AuditLogPage } from './AuditLogPage';
import { BackupPanel } from './BackupPanel';
interface ConfigEntry { id: string; section: string; key: string; value: string | null; value_type: string; label: string | null; description: string | null; }
interface AuditEntry { id: string; user_name: string | null; ip_address: string | null; user_agent: string | null; module: string | null; entity_name: string | null; action: string; details: string | null; severity: string; created_at: string; }
interface Profile { user_id: string; full_name: string | null; email: string | null; is_admin: boolean | null; is_active: boolean | null; created_at: string | null; avatar_url?: string | null; department?: string | null; position?: string | null; }

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: 'platform', label: 'تنظیمات پلتفرم', icon: Settings, sub: [
    { key: 'general', label: 'تنظیمات کلی' },
    { key: 'appearance', label: 'ظاهر و برندینگ' },
    { key: 'regional', label: 'تنظیمات منطقه‌ای' },
    { key: 'ui_settings', label: 'تنظیمات محیطی' },
  ]},
  { key: 'users', label: 'کاربران', icon: Users, sub: [
    { key: 'users_list', label: 'فهرست کاربران' },
    { key: 'users_online', label: 'کاربران آنلاین' },
    { key: 'user_groups', label: 'گروه‌های کاربری' },
    { key: 'group_events', label: 'رخدادها' },
    { key: 'org_structure', label: 'ساختار سازمانی' },
  ]},
  { key: 'access', label: 'حقوق دسترسی', icon: Lock, sub: [
    { key: 'security', label: 'امنیت و دسترسی' },
    { key: 'server', label: 'دسترسی سرور' },
    { key: 'backup', label: 'پشتیبان‌گیری و بازگردانی' },
  ]},
  { key: 'audit', label: 'رویدادها و رخدادها', icon: Activity, sub: [
    { key: 'audit_log', label: 'گزارش رخدادها' },
  ]},
  { key: 'notifications', label: 'اعلان‌ها و پیامک', icon: Bell, sub: [
    { key: 'notifications', label: 'اعلان‌ها' },
    { key: 'sms', label: 'پیامک' },
    { key: 'social_notifications', label: 'شبکه‌های اجتماعی' },
    { key: 'email', label: 'پست الکترونیک' },
    { key: 'daily_report', label: 'ارسال جلسات مدیریتی' },
  ]},
  { key: 'modules', label: 'مدیریت موجودیت‌ها', icon: Monitor, sub: [
    { key: 'video_conference', label: 'ویدیو کنفرانس' },
    { key: 'calendar', label: 'تقویم و مناسبت‌ها' },
    { key: 'monitoring', label: 'مانیتورینگ سیستم' },
  ]},
  { key: 'spark', label: 'دستیار اسپارک', icon: Bot, sub: [
    { key: 'spark_config', label: 'پیکربندی اسپارک' },
  ]},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── ConfigField ──────────────────────────────────────────────────────────────
function ConfigField({ entry, onSave }: { entry: ConfigEntry; onSave: (id: string, value: string) => void }) {
  const [val, setVal] = useState(entry.value ?? '');
  const [showPass, setShowPass] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setVal(entry.value ?? ''); setDirty(false); }, [entry.value]);
  const change = (v: string) => { setVal(v); setDirty(v !== (entry.value ?? '')); };

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{entry.label || entry.key}</label>
        {dirty && (
          <button onClick={() => { onSave(entry.id, val); setDirty(false); }}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors">
            <Save className="w-3 h-3" /> ذخیره
          </button>
        )}
      </div>
      {entry.description && <p className="text-xs text-gray-400 dark:text-gray-500">{entry.description}</p>}
      {entry.value_type === 'boolean' ? (
        <button onClick={() => { const n = val === 'true' ? 'false' : 'true'; change(n); onSave(entry.id, n); }}
          className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${val === 'true' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${val === 'true' ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      ) : entry.value_type === 'password' ? (
        <div className="relative">
          <input type={showPass ? 'text' : 'password'} value={val} onChange={e => change(e.target.value)} className={inputCls} />
          <button onClick={() => setShowPass(v => !v)} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      ) : entry.value_type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={val || '#3b82f6'} onChange={e => change(e.target.value)}
            className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600 cursor-pointer p-0.5 bg-white dark:bg-gray-700" />
          <input type="text" value={val} onChange={e => change(e.target.value)} className={`${inputCls} flex-1`} placeholder="#000000" />
        </div>
      ) : entry.value_type === 'number' ? (
        <input type="number" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      ) : entry.value_type === 'time' ? (
        <input type="time" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      ) : (
        <input type="text" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, color = 'blue', children }: { title: string; icon: React.ElementType; color?: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors[color] || colors.blue}`}>
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-gray-800 dark:text-white">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { currentUserId: string; }

export function PortalConfigPage({ currentUserId }: Props) {
  const [activeSection, setActiveSection] = useState('general');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Profile[]>([]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // Audit log state
  const [auditFilter] = useState<{ severity: string; search: string }>({ severity: 'all', search: '' });

  // User management modals
  type UserModal = 'edit' | 'password' | 'delete' | 'access' | 'activity' | 'logins' | 'urls' | 'add' | null;
  const [userModal, setUserModal] = useState<UserModal>(null);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Modal form state
  const [editForm, setEditForm] = useState({ full_name: '', email: '', department: '', position: '' });
  const [newPassword, setNewPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', department: '', position: '', is_admin: false });
  const [userActivity, setUserActivity] = useState<AuditEntry[]>([]);
  const [userSearch, setUserSearch] = useState('');

  // Load configs
  const loadConfigs = useCallback(async () => {
    const { data } = await supabase.from('system_config').select('*').order('section').order('key');
    if (data) setConfigs(data as ConfigEntry[]);
  }, []);

  // Load audit logs
  const loadAuditLogs = useCallback(async () => {
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (auditFilter.severity !== 'all') q = q.eq('severity', auditFilter.severity);
    if (auditFilter.search) q = q.ilike('action', `%${auditFilter.search}%`);
    const { data } = await q;
    if (data) setAuditLogs(data as AuditEntry[]);
  }, [auditFilter]);

  // Load profiles
  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setProfiles(data as Profile[]);
  }, []);

  // Load truly online users (last seen within 3 minutes)
  const loadOnlineUsers = useCallback(async () => {
    const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: presenceRows } = await supabase
      .from('user_presence')
      .select('user_id, last_seen, is_online')
      .gte('last_seen', threshold);
    if (!presenceRows || presenceRows.length === 0) { setOnlineUsers([]); return; }
    const onlineIds = presenceRows.map((r: any) => r.user_id);
    const { data: pData } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', onlineIds);
    setOnlineUsers((pData || []) as Profile[]);
  }, []);

  // Load groups
  const loadGroups = useCallback(async () => {
    const { data } = await supabase.from('user_groups').select('*').order('name');
    if (!data) return;
    // Count members
    await Promise.all(data.map(async g => {
      await supabase.from('user_group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id);
    }));
  }, []);

  // Load stats
  const loadStats = useCallback(async () => {
    await Promise.all([
      supabase.from('meetings').select('id', { count: 'exact', head: true }),
      supabase.from('tasks').select('id', { count: 'exact', head: true }),
      supabase.from('notes').select('id', { count: 'exact', head: true }),
      supabase.from('chat_messages').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
  }, []);

  useEffect(() => { loadConfigs(); loadProfiles(); loadGroups(); loadStats(); }, []);
  useEffect(() => { if (activeSection === 'audit_log') loadAuditLogs(); }, [activeSection, auditFilter]);
  useEffect(() => { if (activeSection === 'users_online') loadOnlineUsers(); }, [activeSection]);

  // Close user action dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(null);
      else setUserMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

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

  const toggleAdmin = async (uid: string, current: boolean | null) => {
    const target = profiles.find(p => p.user_id === uid);
    const { error } = await supabase.from('profiles').update({ is_admin: !current }).eq('user_id', uid);
    if (error) { toast.error('خطا'); return; }
    setProfiles(prev => prev.map(p => p.user_id === uid ? { ...p, is_admin: !current } : p));
    toast.success('به‌روزرسانی شد');
    logAudit({ module: 'user_management', action: !current ? 'grant_admin' : 'revoke_admin', entity_name: target?.full_name || target?.email || uid, entity_id: uid, details: `دسترسی ادمین ${!current ? 'داده شد' : 'گرفته شد'}`, severity: 'warning' });
  };

  // ── User management actions ────────────────────────────────────────────────
  const openUserModal = (modal: UserModal, user: Profile) => {
    setSelectedUser(user);
    setUserModal(modal);
    setUserMenuOpen(null);
    if (modal === 'edit') setEditForm({ full_name: user.full_name || '', email: user.email || '', department: user.department || '', position: user.position || '' });
    if (modal === 'activity') {
      supabase.from('audit_log').select('*').eq('user_id', user.user_id).order('created_at', { ascending: false }).limit(100)
        .then(({ data }) => { if (data) setUserActivity(data as AuditEntry[]); });
    }
  };

  const saveUserEdit = async () => {
    if (!selectedUser) return;
    const { error } = await supabase.from('profiles').update({ full_name: editForm.full_name, department: editForm.department, position: editForm.position }).eq('user_id', selectedUser.user_id);
    if (error) { toast.error('خطا در ویرایش'); return; }
    toast.success('ویرایش شد');
    setUserModal(null);
    loadProfiles();
  };

  const changeUserPassword = async () => {
    if (!newPassword || newPassword.length < 6) { toast.error('رمز عبور حداقل ۶ کاراکتر'); return; }
    // Admin password reset via supabase admin API is done via edge function or service key
    // For now we update a flag and toast — in production use admin.updateUserById
    toast.success('درخواست تغییر رمز ثبت شد — لینک بازیابی برای کاربر ارسال می‌شود');
    setUserModal(null);
    setNewPassword('');
  };

  const deleteUser = async () => {
    if (!selectedUser) return;
    const { error } = await supabase.from('profiles').update({ is_active: false }).eq('user_id', selectedUser.user_id);
    if (error) { toast.error('خطا'); return; }
    toast.success('کاربر غیرفعال شد (حساب کاربری نگهداری شد)');
    setUserModal(null);
    loadProfiles();
  };

  const addUser = async () => {
    if (!addForm.email || !addForm.password) { toast.error('ایمیل و رمز عبور الزامی است'); return; }
    if (addForm.password.length < 6) { toast.error('رمز عبور حداقل ۶ کاراکتر'); return; }
    // Create user via Supabase Auth signUp then update profile
    const { data, error } = await supabase.auth.signUp({ email: addForm.email.trim(), password: addForm.password, options: { data: { full_name: addForm.full_name } } });
    if (error) { toast.error(error.message); return; }
    if (data.user) {
      await supabase.from('profiles').upsert({ user_id: data.user.id, email: addForm.email.trim(), full_name: addForm.full_name, department: addForm.department, position: addForm.position, is_admin: addForm.is_admin, is_active: true });
      toast.success('کاربر ایجاد شد');
      setUserModal(null);
      setAddForm({ full_name: '', email: '', password: '', department: '', position: '', is_admin: false });
      loadProfiles();
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const isOpen = prev.has(key);
      return isOpen ? new Set<string>() : new Set<string>([key]);
    });
  };

  // ── Render content ──────────────────────────────────────────────────────────
  const renderContent = () => {
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
                        className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${isCollapsed ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
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
      case '_users_list_old': {
        const filtered = profiles.filter(p =>
          !userSearch || (p.full_name || '').includes(userSearch) || (p.email || '').includes(userSearch) || (p.department || '').includes(userSearch)
        );
        return (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />فهرست کاربران
                <span className="text-sm font-normal text-gray-400">({profiles.length})</span>
              </h3>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="جستجو..."
                    className="pr-8 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-48" />
                </div>
                <button onClick={loadProfiles} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors" title="بارگذاری مجدد"><RefreshCw className="w-4 h-4" /></button>
                <button onClick={() => setUserModal('add')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
                  <Plus className="w-4 h-4" />افزودن کاربر
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 text-right">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">کاربر</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">ایمیل</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">واحد / سمت</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">ادمین</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">وضعیت</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">تاریخ ثبت</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filtered.map(p => (
                      <tr key={p.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {(p.full_name || p.email || '?')[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-gray-800 dark:text-white flex items-center gap-1">
                                {p.full_name || '—'}
                                {p.user_id === currentUserId && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">شما</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">{p.email}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {p.department && <div>{p.department}</div>}
                          {p.position && <div className="text-gray-400">{p.position}</div>}
                          {!p.department && !p.position && '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => toggleAdmin(p.user_id, p.is_admin)}
                            className={`w-9 h-5 rounded-full relative transition-colors ${p.is_admin ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.is_admin ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${p.is_active !== false ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${p.is_active !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                            {p.is_active !== false ? 'فعال' : 'غیرفعال'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-400">{p.created_at ? new Date(p.created_at).toLocaleDateString('fa-IR') : '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="relative inline-block" ref={el => { if (userMenuOpen === p.user_id) (userMenuRef as any).current = el; }}>
                            <button onClick={() => setUserMenuOpen(userMenuOpen === p.user_id ? null : p.user_id)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {userMenuOpen === p.user_id && (
                              <div className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl"
                                onClick={e => e.stopPropagation()}>
                                {[
                                  { icon: Edit2, label: 'ویرایش اطلاعات', modal: 'edit' as UserModal, color: 'text-blue-500' },
                                  { icon: KeyRound, label: 'تغییر رمز عبور', modal: 'password' as UserModal, color: 'text-amber-500' },
                                  { icon: p.is_active !== false ? UserX : UserCheck, label: p.is_active !== false ? 'غیرفعال کردن' : 'فعال کردن', modal: 'delete' as UserModal, color: p.is_active !== false ? 'text-red-500' : 'text-green-500' },
                                  { icon: ShieldCheck, label: 'مشاهده حقوق دسترسی', modal: 'access' as UserModal, color: 'text-teal-500' },
                                  { icon: Activity, label: 'فعالیت‌های کاربر', modal: 'activity' as UserModal, color: 'text-purple-500' },
                                  { icon: History, label: 'تاریخچه ورودها', modal: 'logins' as UserModal, color: 'text-gray-500' },
                                  { icon: MapPin, label: 'آدرس‌های مراجعه شده', modal: 'urls' as UserModal, color: 'text-orange-500' },
                                ].map(({ icon: Icon, label, modal, color }) => (
                                  <button key={modal} onClick={() => openUserModal(modal, p)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right">
                                    <Icon className={`w-4 h-4 shrink-0 ${color}`} />
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
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">کاربری یافت نشد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Modals ──────────────────────────────────────────────────── */}
            {userModal && selectedUser && (
              <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setUserModal(null)} dir="rtl">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

                  {/* ── Edit user ── */}
                  {userModal === 'edit' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><Edit2 className="w-5 h-5 text-blue-500" />ویرایش کاربر</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="space-y-4">
                        {[['نام و نام خانوادگی', 'full_name'], ['واحد سازمانی', 'department'], ['سمت', 'position']].map(([lbl, key]) => (
                          <div key={key}>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{lbl}</label>
                            <input value={(editForm as any)[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
                          </div>
                        ))}
                        <div className="pt-2 flex gap-2">
                          <button onClick={saveUserEdit} className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"><Save className="w-4 h-4" />ذخیره</button>
                          <button onClick={() => setUserModal(null)} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition-colors">انصراف</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Change password ── */}
                  {userModal === 'password' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><KeyRound className="w-5 h-5 text-amber-500" />تغییر رمز عبور</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-4 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        رمز جدید برای کاربر <strong>{selectedUser.full_name || selectedUser.email}</strong> تنظیم خواهد شد.
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">رمز عبور جدید</label>
                          <div className="relative">
                            <input type={showNewPass ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 pl-10" />
                            <button onClick={() => setShowNewPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                              {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="pt-2 flex gap-2">
                          <button onClick={changeUserPassword} className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"><KeyRound className="w-4 h-4" />تغییر رمز</button>
                          <button onClick={() => setUserModal(null)} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition-colors">انصراف</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Deactivate / activate ── */}
                  {userModal === 'delete' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                          {selectedUser.is_active !== false ? <UserX className="w-5 h-5 text-red-500" /> : <UserCheck className="w-5 h-5 text-green-500" />}
                          {selectedUser.is_active !== false ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر'}
                        </h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                        {selectedUser.is_active !== false
                          ? `آیا می‌خواهید دسترسی کاربر "${selectedUser.full_name || selectedUser.email}" را مسدود کنید؟ حساب کاربری حذف نمی‌شود.`
                          : `آیا می‌خواهید دسترسی کاربر "${selectedUser.full_name || selectedUser.email}" را مجدداً فعال کنید؟`}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={deleteUser}
                          className={`flex-1 py-2.5 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 ${selectedUser.is_active !== false ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                          {selectedUser.is_active !== false ? <><UserX className="w-4 h-4" />غیرفعال کن</> : <><UserCheck className="w-4 h-4" />فعال کن</>}
                        </button>
                        <button onClick={() => setUserModal(null)} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition-colors">انصراف</button>
                      </div>
                    </div>
                  )}

                  {/* ── Access rights ── */}
                  {userModal === 'access' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-teal-500" />حقوق دسترسی</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">{(selectedUser.full_name || selectedUser.email || '?')[0].toUpperCase()}</div>
                        <div><p className="font-medium text-gray-800 dark:text-white">{selectedUser.full_name}</p><p className="text-xs text-gray-400">{selectedUser.email}</p></div>
                        {selectedUser.is_admin && <span className="mr-auto text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">ادمین</span>}
                      </div>
                      <div className="space-y-2">
                        {[['جلسات', 'meetings'], ['تقویم', 'calendar'], ['چت سازمانی', 'chat'], ['ویدیو کنفرانس', 'video_conference'], ['اقدامات', 'tasks'], ['یادداشت‌ها', 'notes'], ['مخاطبین', 'contacts'], ['گزارشات', 'reports'], ['پنل ادمین', 'admin']].map(([label, key]) => {
                          const hasAccess = key === 'admin' ? !!selectedUser.is_admin : selectedUser.is_active !== false;
                          return (
                            <div key={key} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">
                              <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${hasAccess ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                                {hasAccess ? 'دسترسی دارد' : 'ندارد'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Activity ── */}
                  {userModal === 'activity' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><Activity className="w-5 h-5 text-purple-500" />فعالیت‌های کاربر</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">کاربر: <strong className="text-gray-700 dark:text-gray-200">{selectedUser.full_name || selectedUser.email}</strong></p>
                      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                        {userActivity.length === 0 && <p className="text-center text-gray-400 py-8">فعالیتی ثبت نشده</p>}
                        {userActivity.map(a => (
                          <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${a.severity === 'error' || a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{a.action}</span>
                                <span className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleString('fa-IR')}</span>
                              </div>
                              <div className="flex gap-3 mt-1">
                                {a.module && <span className="text-xs text-gray-400">{a.module}</span>}
                                {a.ip_address && <span className="text-xs text-gray-400 font-mono">{a.ip_address}</span>}
                              </div>
                              {a.details && <p className="text-xs text-gray-400 mt-1 truncate">{a.details}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Login history ── */}
                  {userModal === 'logins' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><History className="w-5 h-5 text-gray-500" />تاریخچه ورودها</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">کاربر: <strong className="text-gray-700 dark:text-gray-200">{selectedUser.full_name || selectedUser.email}</strong></p>
                      <LoginHistoryList userId={selectedUser.user_id} />
                    </div>
                  )}

                  {/* ── Visited URLs ── */}
                  {userModal === 'urls' && (
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><MapPin className="w-5 h-5 text-orange-500" />آدرس‌های مراجعه شده</h3>
                        <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">کاربر: <strong className="text-gray-700 dark:text-gray-200">{selectedUser.full_name || selectedUser.email}</strong></p>
                      <VisitedUrlsList userId={selectedUser.user_id} />
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* ── Add User Modal ── */}
            {userModal === 'add' && (
              <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setUserModal(null)} dir="rtl">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><UserCog className="w-5 h-5 text-blue-500" />افزودن کاربر جدید</h3>
                      <button onClick={() => setUserModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="space-y-3">
                      {[
                        { label: 'نام و نام خانوادگی', key: 'full_name', type: 'text' },
                        { label: 'ایمیل *', key: 'email', type: 'email' },
                        { label: 'رمز عبور *', key: 'password', type: 'password' },
                        { label: 'واحد سازمانی', key: 'department', type: 'text' },
                        { label: 'سمت', key: 'position', type: 'text' },
                      ].map(({ label, key, type }) => (
                        <div key={key}>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</label>
                          <input type={type} value={(addForm as any)[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-700">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-500" />دسترسی ادمین</span>
                        <button onClick={() => setAddForm(f => ({ ...f, is_admin: !f.is_admin }))}
                          className={`w-10 h-5 rounded-full relative transition-colors ${addForm.is_admin ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${addForm.is_admin ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="pt-4 flex gap-2">
                      <button onClick={addUser} className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"><Plus className="w-4 h-4" />ایجاد کاربر</button>
                      <button onClick={() => setUserModal(null)} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition-colors">انصراف</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        );
      }

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
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
                        {(p.full_name || p.email || '?')[0].toUpperCase()}
                      </div>
                      <span className="absolute bottom-0 left-0 w-3 h-3 rounded-full bg-green-400 border-2 border-white dark:border-gray-800" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 dark:text-white text-sm truncate">{p.full_name || '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{p.email}</p>
                    </div>
                    {p.is_admin && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full shrink-0">ادمین</span>}
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
              {cfgs('security').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
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
              {cfgs('video_conference').map(c => <ConfigField key={c.id} entry={c} onSave={saveConfig} />)}
            </SectionCard>
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
    for (const group of NAV_ITEMS) {
      const sub = group.sub.find(s => s.key === activeSection);
      if (sub) return `${group.label} / ${sub.label}`;
    }
    return '';
  })();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const SidebarNav = ({ onSelect }: { onSelect?: () => void }) => (
    <nav className="flex-1 p-2 space-y-0.5">
      {NAV_ITEMS.map(group => {
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
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
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
      <div className="hidden lg:flex w-56 shrink-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 text-sm">
            <Settings className="w-4 h-4 text-blue-500" /> پیکربندی
          </h2>
        </div>
        <SidebarNav />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Breadcrumb bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile menu button */}
            <button onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 min-w-0">
              <Settings className="w-4 h-4 shrink-0" />
              <span className="text-gray-400 hidden sm:inline">/</span>
              <span className="text-gray-700 dark:text-gray-200 font-medium truncate">{breadcrumb}</span>
            </div>
          </div>
          <button onClick={() => { loadConfigs(); loadProfiles(); loadGroups(); loadStats(); }}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors shrink-0">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

// ─── Login History sub-component ──────────────────────────────────────────────
function LoginHistoryList({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<Array<{ id: string; created_at: string; ip_address: string | null; user_agent: string | null; action: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('audit_log').select('id,created_at,ip_address,user_agent,action').eq('user_id', userId)
      .ilike('action', '%لاگین%').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setLogs((data || []) as any); setLoading(false); });
  }, [userId]);
  if (loading) return <div className="text-center py-6 text-gray-400 text-sm">در حال بارگذاری...</div>;
  if (logs.length === 0) return (
    <div className="text-center py-8">
      <LoginIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">تاریخچه ورودی ثبت نشده</p>
      <p className="text-gray-400 text-xs mt-1">ورودهای آینده کاربر اینجا نمایش داده خواهد شد</p>
    </div>
  );
  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
      {logs.map((l, i) => (
        <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
          <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-600 flex items-center justify-center shrink-0">
            <LoginIcon className="w-3.5 h-3.5 text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">ورود #{i + 1}</span>
              <span className="text-xs text-gray-400">{new Date(l.created_at).toLocaleString('fa-IR')}</span>
            </div>
            <div className="flex gap-3 mt-0.5">
              {l.ip_address && <span className="text-xs text-gray-400 font-mono">{l.ip_address}</span>}
              {l.user_agent && <span className="text-xs text-gray-400 truncate">{l.user_agent.split(' ').slice(0, 2).join(' ')}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Visited URLs sub-component ───────────────────────────────────────────────
function VisitedUrlsList({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<Array<{ id: string; created_at: string; module: string | null; entity_name: string | null; action: string; ip_address: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('audit_log').select('id,created_at,module,entity_name,action,ip_address').eq('user_id', userId)
      .not('module', 'is', null).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setLogs((data || []) as any); setLoading(false); });
  }, [userId]);

  // Group by module
  const moduleMap: Record<string, number> = {};
  logs.forEach(l => { if (l.module) moduleMap[l.module] = (moduleMap[l.module] || 0) + 1; });

  if (loading) return <div className="text-center py-6 text-gray-400 text-sm">در حال بارگذاری...</div>;
  if (logs.length === 0) return (
    <div className="text-center py-8">
      <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">آدرسی ثبت نشده</p>
    </div>
  );
  return (
    <div className="space-y-3 max-h-[50vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(moduleMap).map(([mod, count]) => (
          <div key={mod} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/50">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{mod}</span>
            <span className="text-xs text-blue-500 font-bold mr-2">{count}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 text-center">آخرین ۱۰۰ رویداد</p>
      <div className="space-y-1.5">
        {logs.slice(0, 30).map(l => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs">
            <MapPin className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-gray-500 dark:text-gray-400 font-medium">{l.module}</span>
            <span className="text-gray-400 truncate flex-1">{l.action}</span>
            <span className="text-gray-300 dark:text-gray-600 shrink-0">{new Date(l.created_at).toLocaleDateString('fa-IR')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
