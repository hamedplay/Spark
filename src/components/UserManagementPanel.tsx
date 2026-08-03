import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Plus, RefreshCw, EllipsisVertical as MoreVertical, Download, Upload, EyeOff, CircleAlert as AlertCircle, Loader as Loader2, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';
import type { AdminProfile, Panel, Props, ImportResult } from './UserManagement/types';
import { EXCEL_COLUMNS, emptyNew, menuItems } from './UserManagement/utils';
// XLSX used for export/template below; ImportResult type retained for state
import { ImportResultModal } from './UserManagement/ImportResultModal';
import { UserPreviewPanel } from './UserManagement/UserPreviewPanel';
import { UserProfileForm } from './UserManagement/UserProfileForm';
import { PasswordPanel } from './UserManagement/PasswordPanel';
import { DeactivatePanel } from './UserManagement/DeactivatePanel';
import { AccessPanel } from './UserManagement/AccessPanel';
import { ActivityPanel } from './UserManagement/ActivityPanel';
import { LoginsPanel } from './UserManagement/LoginsPanel';
import { UrlsPanel } from './UserManagement/UrlsPanel';
import { UserRelationsPanel } from './UserManagement/UserRelationsPanel';
import { PhoneSyncPanel } from './UserManagement/PhoneSyncPanel';
import { handleImportFile } from './UserManagement/importHandler';

export function UserManagementPanel({ currentUserId }: Props) {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [panel, setPanel] = useState<Panel>('list');
  const [selectedUser, setSelectedUser] = useState<AdminProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select(
      'user_id, full_name, email, username, phone, organization, position, department, employee_id, hire_date, birth_date, gender, city, location, bio, national_id, avatar_url, is_admin, is_active, is_hidden, created_at'
    ).order('created_at', { ascending: false });
    if (data) setProfiles(data as AdminProfile[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const openPanel = (p: Panel, user: AdminProfile) => {
    setSelectedUser(user);
    setPanel(p);
    setMenuOpen(null);
  };

  const goBack = () => { setPanel('list'); setSelectedUser(null); };

  const handleSaveUser = async (updated: AdminProfile, password?: string) => {
    if (password) {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: updated.email!.trim(),
            password,
            profile: {
              full_name: updated.full_name,
              username: updated.username || null,
              phone: updated.phone,
              organization: updated.organization,
              position: updated.position,
              department: updated.department,
              employee_id: updated.employee_id,
              hire_date: updated.hire_date,
              birth_date: updated.birth_date,
              gender: updated.gender,
              city: updated.city,
              location: updated.location,
              bio: updated.bio,
              national_id: updated.national_id,
              is_admin: updated.is_admin,
            },
          }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'خطا در ایجاد کاربر'); return; }
      toast.success('کاربر ایجاد شد');
      await load();
      goBack();
    } else {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (updated.phone !== selectedUser.phone) {
        if (!token) { toast.error('جلسه منقضی شده'); return; }
        const phoneRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/change-user-phone`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ user_id: updated.user_id, phone: updated.phone || '' }),
          },
        );
        const phoneResult = await phoneRes.json();
        if (!phoneRes.ok || phoneResult.error) {
          toast.error(phoneResult.error || 'خطا در همگام‌سازی شماره موبایل');
          return;
        }
      }

      const { error } = await supabase.from('profiles').update({
        full_name: updated.full_name,
        username: updated.username || null,
        organization: updated.organization,
        position: updated.position,
        department: updated.department,
        employee_id: updated.employee_id,
        hire_date: updated.hire_date,
        birth_date: updated.birth_date,
        gender: updated.gender,
        city: updated.city,
        location: updated.location,
        bio: updated.bio,
        national_id: updated.national_id,
        is_admin: updated.is_admin,
        is_active: updated.is_active,
        is_hidden: updated.is_hidden ?? false,
      }).eq('user_id', updated.user_id);
      if (error) { toast.error('خطا در ذخیره'); return; }
      toast.success('اطلاعات ذخیره شد');
      await load();
      goBack();
    }
  };

  const exportToExcel = async () => {
    const rows = profiles.map(p => {
      const row: Record<string, string> = {};
      EXCEL_COLUMNS.forEach(col => {
        const val = (p as any)[col.key];
        row[col.label] = val === null || val === undefined ? '' : String(val);
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'کاربران');
    await XLSX.writeFile(wb, `users_${new Date().toLocaleDateString('fa-IR').replace(/\//g, '-')}.xlsx`);
    toast.success(`${profiles.length} کاربر خروجی گرفته شد`);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    await handleImportFile(file, async (result) => { await load(); setImportResult(result); }, () => setImporting(false));
  };

  const downloadTemplate = async () => {
    const headers = [...EXCEL_COLUMNS.map(c => c.label), 'رمز عبور'];
    const example = [
      'علی محمدی',
      'ali@example.com',
      'ali.mohammadi',
      '09123456789',
      '1234567890',
      'P001',
      'male',
      '1370/01/01',
      'تهران',
      '',
      '',
      '',
      '',
      '',
      '',
      'false',
      'true',
      'Password@123',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قالب');
    await XLSX.writeFile(wb, 'users_template.xlsx');
    toast.success('قالب دانلود شد');
  };

  const filtered = profiles.filter(p =>
    !search || (p.full_name || '').includes(search) || (p.email || '').includes(search) || (p.department || '').includes(search)
  );

  if (panel === 'preview' && selectedUser) {
    return <UserPreviewPanel user={selectedUser} onBack={goBack} onEdit={() => setPanel('edit')} />;
  }
  if (panel === 'add') {
    return <UserProfileForm title="افزودن کاربر جدید" profile={emptyNew} isNew onSave={handleSaveUser} onBack={goBack} />;
  }
  if (panel === 'edit' && selectedUser) {
    return <UserProfileForm title="ویرایش اطلاعات کاربر" profile={selectedUser} isNew={false} onSave={handleSaveUser} onBack={goBack} />;
  }
  if (panel === 'password' && selectedUser) return <PasswordPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'deactivate' && selectedUser) return <DeactivatePanel user={selectedUser} onBack={goBack} onDone={() => { load(); goBack(); }} />;
  if (panel === 'access' && selectedUser) return <AccessPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'relations' && selectedUser) return <UserRelationsPanel user={selectedUser} onBack={goBack} allProfiles={profiles} />;
  if (panel === 'phonesync' && selectedUser) return <PhoneSyncPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'activity' && selectedUser) return <ActivityPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'logins' && selectedUser) return <LoginsPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'urls' && selectedUser) return <UrlsPanel user={selectedUser} onBack={goBack} />;

  return (
    <div className="space-y-4" dir="rtl">
      {importResult && <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />فهرست کاربران
          <span className="text-sm font-normal text-gray-400">({profiles.length})</span>
        </h3>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors" title="بارگذاری مجدد">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={exportToExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition-colors" title="خروجی اکسل">
            <Download className="w-4 h-4" />خروجی
          </button>
          <div className="relative">
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', zIndex: -1 }}
              onChange={onImportFile}
            />
            <button
              onClick={() => {
                importRef.current?.click();
              }}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition-colors" title="ورود دسته‌ای از اکسل">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? 'در حال وارد کردن...' : 'وارد کردن'}
            </button>
          </div>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors" title="دانلود قالب اکسل">
            قالب
          </button>
          <button onClick={() => setPanel('add')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />افزودن کاربر
          </button>
        </div>
      </div>
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>برای وارد کردن دسته‌ای: ابتدا «قالب» را دانلود کنید، اطلاعات کاربران را پر کنید، سپس «وارد کردن» را بزنید. تنها ستون «ایمیل» الزامی است — اگر رمز عبور خالی باشد، رمز پیش‌فرض <span className="font-mono font-semibold">Ss123456</span> تنظیم می‌شود.</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-right">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">کاربر</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">ایمیل / نام کاربری</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">واحد / سمت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">ادمین</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">وضعیت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">تاریخ ثبت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(p => (
                <tr key={p.user_id} onClick={() => openPanel('preview', p)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-teal-400 to-blue-500">
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                              {(p.full_name || p.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                            </div>}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 dark:text-white flex items-center gap-1 text-sm">
                          {p.full_name || '—'}
                          {p.user_id === currentUserId && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">شما</span>}
                          {p.is_hidden && <span className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><EyeOff className="w-2.5 h-2.5" />مخفی</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-400 text-xs font-mono">{p.email}</div>
                    {p.username && (
                      <div className="text-xs text-teal-600 dark:text-teal-400 font-medium mt-0.5">@{p.username}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {p.department && <div className="font-medium">{p.department}</div>}
                    {p.position && <div className="text-gray-400">{p.position}</div>}
                    {!p.department && !p.position && '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => supabase.from('profiles').update({ is_admin: !p.is_admin }).eq('user_id', p.user_id).then(load)}
                      className={`w-9 h-5 rounded-full relative transition-colors ${p.is_admin ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.is_admin ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${p.is_active !== false ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_active !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                      {p.is_active !== false ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString('fa-IR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-block" ref={menuOpen === p.user_id ? menuRef : undefined}>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === p.user_id ? null : p.user_id); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuOpen === p.user_id && (
                        <div
                          className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1"
                          onClick={e => e.stopPropagation()}>
                          {menuItems(p).map(({ icon: Icon, label, panel: target, color }) => (
                            <button key={target} onClick={() => openPanel(target, p)}
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
                <tr>
                  <td colSpan={7} className="py-14">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <User className="w-10 h-10 opacity-30" />
                      <p className="text-sm">
                        {search ? `کاربری با عنوان «${search}» یافت نشد` : 'هنوز کاربری ثبت نشده است'}
                      </p>
                      <button
                        onClick={() => setPanel('add')}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        {search ? `افزودن کاربر جدید` : 'افزودن اولین کاربر'}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
