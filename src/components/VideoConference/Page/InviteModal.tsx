import { useState, useEffect, useRef } from 'react';
import { UserPlus, X, Link2, Copy, Check, Search, Send, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';
import type { ConferenceRoom } from '../types';
import type { InviteUserProfile } from './types';

export function InviteModal({ room, currentUserId, onClose }: {
  room: ConferenceRoom; currentUserId: string; onClose: () => void;
}) {
  const [users, setUsers] = useState<InviteUserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const joinLink = `${window.location.origin}?conference=${room.code}`;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingUsers(true);
      try {
        let query = supabase.from('profiles')
          .select('user_id, full_name, email')
          .neq('user_id', currentUserId)
          .not('is_hidden', 'eq', true)
          .limit(30);
        if (search.trim()) {
          const safe = search.replace(/[%_\\'"]/g, '');
          query = query.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        setUsers(data || []);
      } catch (e) {
        console.error('fetchUsers error:', e);
        toast.error('خطا در بارگذاری کاربران');
      } finally {
        setLoadingUsers(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, currentUserId]);

  const copyLink = () => {
    navigator.clipboard.writeText(joinLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast.success('لینک کپی شد');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = joinLink; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast.success('لینک کپی شد');
    });
  };

  const inviteUser = async (u: InviteUserProfile) => {
    if (sent.has(u.user_id)) return;
    setSending(u.user_id);
    try {
      const { error } = await supabase.rpc('create_notification', {
        p_user_id: u.user_id,
        p_title: `دعوت به ویدیو کنفرانس: ${room.name || 'جلسه ویدیویی'}`,
        p_message: `برای ورود به جلسه کد «${room.code}» را در بخش ویدیو کنفرانس وارد کنید`,
        p_type: 'meeting',
      });
      if (error) throw error;
      setSent(prev => new Set([...prev, u.user_id]));
      toast.success(`دعوتنامه به ${u.full_name || u.email} ارسال شد`);
    } catch (e: any) {
      toast.error('خطا در ارسال دعوتنامه: ' + (e.message || ''));
    } finally {
      setSending(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="دعوت از شرکت‌کنندگان"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      dir="rtl"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-teal-500" /> دعوت از شرکت‌کنندگان
          </h2>
          <button onClick={onClose} aria-label="بستن" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">لینک دعوت (بدون نیاز به لاگین)</p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <Link2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">{joinLink}</span>
              </div>
              <button
                onClick={copyLink}
                aria-label="کپی لینک"
                className="flex items-center gap-1.5 px-3 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex-shrink-0"
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {linkCopied ? 'کپی شد' : 'کپی'}
              </button>
            </div>
            <div className="mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center gap-2">
              <span className="text-xs text-blue-600 dark:text-blue-400">کد جلسه:</span>
              <span className="font-mono font-bold text-blue-700 dark:text-blue-300 text-base tracking-widest">{room.code}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">دعوت از کاربران سامانه</p>
            <div className="relative mb-3">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <label htmlFor="invite-search" className="sr-only">جستجو کاربر</label>
              <input
                id="invite-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="جستجو نام یا ایمیل..."
                className="w-full pr-9 pl-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white text-sm"
              />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-2">
              {loadingUsers ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-teal-500" /></div>
              ) : users.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">کاربری یافت نشد</p>
              ) : (
                users.map(u => (
                  <div key={u.user_id} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {(u.full_name || u.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                    </div>
                    {sent.has(u.user_id) ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                        <Check className="w-3.5 h-3.5" /> ارسال شد
                      </span>
                    ) : (
                      <button
                        onClick={() => inviteUser(u)}
                        disabled={sending === u.user_id}
                        aria-label={`دعوت ${u.full_name || u.email}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {sending === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} دعوت
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
