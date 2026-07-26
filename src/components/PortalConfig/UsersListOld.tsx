import { Users, Search, RefreshCw, Plus, CreditCard as Edit2, KeyRound, UserX, UserCheck, ShieldCheck, Activity, History, MapPin, X, Save, Shield, UserCog } from 'lucide-react';
import type { Profile, AuditEntry } from './types';
import { LoginHistoryList, VisitedUrlsList } from './AuditLists';

type UserModal = 'edit' | 'password' | 'delete' | 'access' | 'activity' | 'logins' | 'urls' | 'add' | null;

export function UsersListOld(props: {
  profiles: Profile[];
  currentUserId: string;
  userSearch: string;
  setUserSearch: React.Dispatch<React.SetStateAction<string>>;
  loadProfiles: () => void;
  setUserModal: React.Dispatch<React.SetStateAction<UserModal>>;
  userModal: UserModal;
  selectedUser: Profile | null;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<string | null>>;
  userMenuOpen: string | null;
  userMenuRef: React.RefObject<HTMLDivElement | null>;
  openUserModal: (modal: UserModal, user: Profile) => void;
  toggleAdmin: (uid: string, current: boolean | null) => void;
  editForm: { full_name: string; email: string; department: string; position: string };
  setEditForm: React.Dispatch<React.SetStateAction<{ full_name: string; email: string; department: string; position: string }>>;
  saveUserEdit: () => void;
  newPassword: string;
  setNewPassword: React.Dispatch<React.SetStateAction<string>>;
  showNewPass: boolean;
  setShowNewPass: React.Dispatch<React.SetStateAction<boolean>>;
  changeUserPassword: () => void;
  deleteUser: () => void;
  addForm: { full_name: string; email: string; password: string; department: string; position: string; is_admin: boolean };
  setAddForm: React.Dispatch<React.SetStateAction<{ full_name: string; email: string; password: string; department: string; position: string; is_admin: boolean }>>;
  addUser: () => void;
  userActivity: AuditEntry[];
}) {
  const {
    profiles, currentUserId, userSearch, setUserSearch, loadProfiles,
    setUserModal, userModal, selectedUser, setUserMenuOpen, userMenuOpen,
    userMenuRef, openUserModal, toggleAdmin, editForm, setEditForm, saveUserEdit,
    newPassword, setNewPassword, showNewPass, setShowNewPass, changeUserPassword,
    deleteUser, addForm, setAddForm, addUser, userActivity,
  } = props;

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
              className="pr-8 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
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
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
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
                        <Edit2 className="w-4 h-4" />
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
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                  <KeyRound className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  رمز جدید برای کاربر <strong>{selectedUser.full_name || selectedUser.email}</strong> تنظیم خواهد شد.
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">رمز عبور جدید</label>
                    <div className="relative">
                      <input type={showNewPass ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 pl-10" />
                      <button onClick={() => setShowNewPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {showNewPass ? <X className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
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
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.severity === 'error' || a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{a.action}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">{new Date(a.created_at).toLocaleString('fa-IR')}</span>
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
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
