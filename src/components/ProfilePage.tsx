import { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, Building, MapPin, Camera, Loader as Loader2, Save, Briefcase, Hash, Users, CreditCard, ChevronDown, ChevronUp, CircleCheck as CheckCircle2, Crown, Building2, Link2, MessageCircle, AtSign, Unlink, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';

const JALAALI_MONTHS_FA = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

function getJalaaliMonthDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return moment.jIsLeapYear(jy) ? 30 : 29;
}

function isoToJalali(iso: string): { jy: number; jm: number; jd: number } | null {
  if (!iso) return null;
  try {
    const m = moment(iso, 'YYYY-MM-DD');
    if (!m.isValid()) return null;
    return { jy: m.jYear(), jm: m.jMonth() + 1, jd: m.jDate() };
  } catch { return null; }
}

function jalaliToIso(jy: number, jm: number, jd: number): string {
  try {
    const d = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD');
    if (!d.isValid()) return '';
    return d.format('YYYY-MM-DD');
  } catch { return ''; }
}

function JalaaliDateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const parsed = isoToJalali(value);
  const currentJYear = moment().jYear();
  const [jy, setJy] = useState(parsed?.jy ?? 0);
  const [jm, setJm] = useState(parsed?.jm ?? 0);
  const [jd, setJd] = useState(parsed?.jd ?? 0);

  useEffect(() => {
    const p = isoToJalali(value);
    if (p) { setJy(p.jy); setJm(p.jm); setJd(p.jd); }
    else { setJy(0); setJm(0); setJd(0); }
  }, [value]);

  const handleChange = (newJy: number, newJm: number, newJd: number) => {
    if (!newJy || !newJm || !newJd) { onChange(''); return; }
    const iso = jalaliToIso(newJy, newJm, newJd);
    onChange(iso);
  };

  const daysInMonth = jy && jm ? getJalaaliMonthDays(jy, jm) : 31;
  const years = Array.from({ length: 120 }, (_, i) => currentJYear - i);

  return (
    <div className={`flex gap-1 ${className || ''}`} dir="rtl">
      <select
        value={jy || ''}
        onChange={e => { const v = Number(e.target.value); setJy(v); handleChange(v, jm, jd); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={jm || ''}
        onChange={e => { const v = Number(e.target.value); setJm(v); handleChange(jy, v, jd); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">ماه</option>
        {JALAALI_MONTHS_FA.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select
        value={jd || ''}
        onChange={e => { const v = Number(e.target.value); setJd(v); handleChange(jy, jm, v); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">روز</option>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

interface OrgPositionInfo {
  id: string;
  title: string;
  level: number;
  color: string;
  icon: string;
  unit_name?: string;
  parent_title?: string;
}

interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  username: string;
  phone: string;
  organization: string;
  position: string;
  location: string;
  bio: string;
  avatar_url: string;
  national_id: string;
  birth_date: string;
  gender: string;
  city: string;
  department: string;
  employee_id: string;
  hire_date: string;
  bale_chat_id: string;
  primary_position_id: string | null;
  primary_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

const empty: Omit<Profile, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  full_name: '', email: '', username: '', phone: '', organization: '', position: '',
  location: '', bio: '', avatar_url: '', national_id: '', birth_date: '',
  gender: '', city: '', department: '', employee_id: '', hire_date: '',
  bale_chat_id: '',
  primary_position_id: null, primary_unit_id: null,
};

const LEVEL_LABELS: Record<number, string> = {
  1: 'مدیرعامل', 2: 'معاون', 3: 'مدیر', 4: 'کارشناس', 5: 'کارمند',
};

function Field({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">{label}</label>
      <div className="relative">
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <Icon className="w-4 h-4" />
        </div>
        {children}
      </div>
    </div>
  );
}

const inp = 'w-full pr-9 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';
const inpDisabled = inp + ' bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed';

// ─── Bale Deep-Link Connect Section ──────────────────────────────────────────
function BaleConnectSection() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const checkConnection = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('user_bale_mapping')
      .select('bale_chat_id')
      .eq('user_id', user.id)
      .maybeSingle();
    return !!data;
  };

  useEffect(() => {
    checkConnection().then(setConnected);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
  };

  const startPolling = () => {
    stopPolling();
    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      // Stop after 2 minutes (40 × 3s)
      if (pollCountRef.current > 40) {
        stopPolling();
        return;
      }
      const isConnected = await checkConnection();
      if (isConnected) {
        stopPolling();
        setConnected(true);
        setConnecting(false);
        toast.success('اتصال به بله با موفقیت انجام شد!');
      }
    }, 3000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('احراز هویت لازم است');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bale-link-generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const data = await res.json();
      if (!data.ok || !data.url) throw new Error(data.error || 'خطا در تولید لینک');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      startPolling();
    } catch (err: any) {
      toast.error(err.message || 'خطا در اتصال به بله');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('احراز هویت لازم است');
      const { error } = await supabase
        .from('user_bale_mapping')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
      setConnected(false);
      toast.success('اتصال بله قطع شد');
    } catch (err: any) {
      toast.error(err.message || 'خطا در قطع اتصال');
    } finally {
      setDisconnecting(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-teal-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <div>
          <p className="font-semibold text-teal-800 dark:text-teal-200 text-sm">پیام‌رسان بله</p>
          <p className="text-xs text-teal-600 dark:text-teal-400">برای دریافت اعلان‌های جلسه در بله</p>
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-teal-100 dark:bg-teal-900/30 rounded-xl">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-500 flex-shrink-0" />
            <span className="text-sm text-teal-700 dark:text-teal-300 font-medium flex-1">
              به بله متصل هستید
            </span>
            <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            اعلان‌های جلسه به طور خودکار در بله برای شما ارسال می‌شوند.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-sm transition disabled:opacity-60"
          >
            {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            قطع اتصال
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm"
          >
            {connecting
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> در انتظار اتصال...</>
              : <><Link2 className="w-4 h-4" /> اتصال به بله</>
            }
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed text-center">
            روی دکمه بزنید، بات بله باز می‌شود، فقط دکمه «شروع» را بزنید.
          </p>
          {connecting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                پس از زدن «شروع» در بله، اتصال به صورت خودکار تأیید می‌شود...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Telegram Deep-Link Connect Section ──────────────────────────────────────
function TelegramConnectSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const checkConnection = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('user_id', user.id)
      .maybeSingle();
    return !!(data as any)?.telegram_chat_id;
  };

  useEffect(() => {
    checkConnection().then(setConnected);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
  };

  const startPolling = () => {
    stopPolling();
    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current > 40) { stopPolling(); return; }
      const isConnected = await checkConnection();
      if (isConnected) {
        stopPolling();
        setConnected(true);
        setConnecting(false);
        toast.success('اتصال به تلگرام با موفقیت انجام شد!');
      }
    }, 3000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('احراز هویت لازم است');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-link-generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const data = await res.json();
      if (!data.ok || !data.url) throw new Error(data.error || 'خطا در تولید لینک');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      startPolling();
    } catch (err: any) {
      toast.error(err.message || 'خطا در اتصال به تلگرام');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('احراز هویت لازم است');
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('user_id', user.id);
      if (error) throw error;
      setConnected(false);
      toast.success('اتصال تلگرام قطع شد');
    } catch (err: any) {
      toast.error(err.message || 'خطا در قطع اتصال');
    } finally {
      setDisconnecting(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <div>
          <p className="font-semibold text-blue-800 dark:text-blue-200 text-sm">تلگرام</p>
          <p className="text-xs text-blue-600 dark:text-blue-400">برای دریافت اعلان‌های جلسه در تلگرام</p>
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-sm text-blue-700 dark:text-blue-300 font-medium flex-1">
              به تلگرام متصل هستید
            </span>
            <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            اعلان‌های جلسه به طور خودکار در تلگرام برای شما ارسال می‌شوند.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-sm transition disabled:opacity-60"
          >
            {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            قطع اتصال
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm"
          >
            {connecting
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> در انتظار اتصال...</>
              : <><Link2 className="w-4 h-4" /> اتصال به تلگرام</>
            }
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed text-center">
            روی دکمه بزنید، بات تلگرام باز می‌شود، فقط دکمه «Start» را بزنید.
          </p>
          {connecting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                پس از زدن «Start» در تلگرام، اتصال به صورت خودکار تأیید می‌شود...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openSection, setOpenSection] = useState<'personal' | 'work' | 'social' | 'calendar'>('personal');
  const [saved, setSaved] = useState(false);
  const [orgPositionInfo, setOrgPositionInfo] = useState<OrgPositionInfo | null>(null);

  useEffect(() => { fetchProfile(); }, []);

  const fetchOrgInfo = async (positionId: string | null) => {
    const [{ data: posData }, { data: allPos }, { data: allUnits }, { data: orgData }] = await Promise.all([
      positionId
        ? supabase.from('org_positions').select('id,title,level,color,icon,unit_id,parent_position_id').eq('id', positionId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('org_positions').select('id,title,level,color,icon,unit_id').order('level'),
      supabase.from('org_units').select('id,name').order('name'),
      supabase.from('org_organizations').select('name').maybeSingle(),
    ]);
    if (posData) {
      const unit = (allUnits || []).find((u: any) => u.id === posData.unit_id);
      const parent = posData.parent_position_id
        ? (allPos || []).find((p: any) => p.id === posData.parent_position_id)
        : null;
      setOrgPositionInfo({
        id: posData.id, title: posData.title, level: posData.level,
        color: posData.color, icon: posData.icon,
        unit_name: unit?.name, parent_title: parent?.title,
      });
      // Auto-fill organization from org_organizations (the company name), not the unit name
      if (orgData?.name) {
        setProfile(p => p ? { ...p, organization: orgData.name } : p);
      }
    } else {
      setOrgPositionInfo(null);
    }
  };

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('کاربر احراز هویت نشده است');

      const { data, error } = await supabase
        .from('profiles').select('*').eq('user_id', user.id).maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setProfile({ ...empty, ...data } as unknown as Profile);
        fetchOrgInfo(data.primary_position_id || null);
      } else {
        const newProfile = { ...empty, user_id: user.id, email: user.email ?? '' };
        const { data: created, error: ce } = await supabase
          .from('profiles').insert([newProfile]).select().single();
        if (ce) throw ce;
        setProfile(created as unknown as Profile);
      }
    } catch (error: any) {
      toast.error(error.message || 'خطا در دریافت پروفایل');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      // date fields: send null instead of empty string to avoid Postgres date parse error
      const payload: any = {
        ...profile,
        birth_date: profile.birth_date ?? null,
        hire_date: profile.hire_date ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id);
      if (error) throw error;
      toast.success('پروفایل با موفقیت ذخیره شد');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error: any) {
      toast.error(error.message || 'خطا در ذخیره پروفایل');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `${profile.user_id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from('profiles').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('profiles').getPublicUrl(filePath);
      const urlWithCacheBust = `${publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: urlWithCacheBust }).eq('id', profile.id);
      if (updateError) throw updateError;
      setProfile(p => p ? { ...p, avatar_url: urlWithCacheBust } : p);
      toast.success('تصویر پروفایل به‌روزرسانی شد');
    } catch (error: any) {
      toast.error(error.message || 'خطا در آپلود تصویر');
    } finally {
      setUploading(false);
    }
  };

  const set = (field: keyof typeof empty, value: string) =>
    setProfile(p => p ? { ...p, [field]: value } : p);

  const SectionHeader = ({ id, title, subtitle }: { id: 'personal' | 'work' | 'social' | 'calendar'; title: string; subtitle: string }) => (
    <button
      type="button"
      onClick={() => setOpenSection(id)}
      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition"
    >
      <div className="text-right">
        <p className="font-semibold text-gray-800 dark:text-white text-sm">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      {openSection === id
        ? <ChevronUp className="w-4 h-4 text-gray-400" />
        : <ChevronDown className="w-4 h-4 text-gray-400" />}
    </button>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
      </div>
    );
  }

  if (!profile) return null;

  const initials = profile.full_name
    ? profile.full_name.split(' ').map(w => w[0]).slice(0, 2).join('')
    : profile.email[0]?.toUpperCase() || '?';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">پروفایل کاربری</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">اطلاعات حساب و سازمانی خود را مدیریت کنید</p>
      </div>

      {/* Avatar card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-4">
        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">{initials}</span>
                </div>
              )}
            </div>
            <label className="absolute -bottom-2 -left-2 w-8 h-8 bg-teal-500 hover:bg-teal-600 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition">
              {uploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" disabled={uploading} />
            </label>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {profile.full_name || 'نام تعریف نشده'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{profile.email}</p>
            {profile.position && profile.organization && (
              <p className="text-sm text-teal-600 dark:text-teal-400 mt-1">
                {profile.position} — {profile.organization}
              </p>
            )}
            {profile.updated_at && (
              <p className="text-xs text-gray-400 mt-1">
                آخرین به‌روزرسانی: {new Date(profile.updated_at).toLocaleString('fa-IR')}
              </p>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">

        {/* Personal info */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="personal" title="اطلاعات شخصی" subtitle="نام، مشخصات فردی، ارتباطی" />
          {openSection === 'personal' && (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="نام و نام خانوادگی" icon={User}>
                <input type="text" value={profile.full_name} onChange={e => set('full_name', e.target.value)}
                  className={inp} placeholder="نام کامل" />
              </Field>

              <Field label="نام کاربری" icon={AtSign}>
                <input type="text" value={profile.username || ''} disabled
                  className={inpDisabled} placeholder="username_123" dir="ltr" />
                <p className="text-xs text-gray-400 mt-1">نام کاربری توسط مدیر تعیین می‌شود و قابل تغییر نیست</p>
              </Field>

              <Field label="ایمیل" icon={Mail}>
                <input type="email" value={profile.email} disabled className={inpDisabled} />
              </Field>

              <Field label="شماره موبایل" icon={Phone}>
                <input type="tel" value={profile.phone} onChange={e => set('phone', e.target.value)}
                  className={inp} placeholder="09xxxxxxxxx" dir="ltr" />
              </Field>

              <Field label="کد ملی" icon={CreditCard}>
                <input type="text" value={profile.national_id} onChange={e => set('national_id', e.target.value)}
                  className={inp} placeholder="کد ملی ۱۰ رقمی" dir="ltr" maxLength={10} />
              </Field>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                  تاریخ تولد (شمسی)
                </label>
                <JalaaliDateInput value={profile.birth_date || ''} onChange={v => set('birth_date', v)} className="w-full" />
              </div>

              <Field label="جنسیت" icon={Users}>
                <select value={profile.gender} onChange={e => set('gender', e.target.value)} className={inp}>
                  <option value="">انتخاب کنید</option>
                  <option value="male">مرد</option>
                  <option value="female">زن</option>
                  <option value="other">سایر</option>
                </select>
              </Field>

              <Field label="شهر" icon={MapPin}>
                <input type="text" value={profile.city} onChange={e => set('city', e.target.value)}
                  className={inp} placeholder="شهر محل سکونت" />
              </Field>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">درباره من</label>
                <textarea value={profile.bio} onChange={e => set('bio', e.target.value)} rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm resize-none"
                  placeholder="چند جمله درباره خودتان بنویسید..." />
              </div>
            </div>
          )}
        </div>

        {/* Work/org section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="work" title="اطلاعات سازمانی" subtitle="سازمان، سمت، واحد و مشخصات شغلی" />
          {openSection === 'work' && (
            <div className="p-6 space-y-5">

              {/* Org chart card */}
              {orgPositionInfo ? (
                <div className="flex items-center gap-4 p-4 rounded-2xl border-2"
                  style={{ borderColor: orgPositionInfo.color + '60', backgroundColor: orgPositionInfo.color + '0d' }}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ backgroundColor: orgPositionInfo.color + '20' }}>
                    {orgPositionInfo.icon || '💼'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 dark:text-white">{orgPositionInfo.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                        style={{ backgroundColor: orgPositionInfo.color }}>
                        {LEVEL_LABELS[orgPositionInfo.level] || `سطح ${orgPositionInfo.level}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                      {orgPositionInfo.unit_name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" />{orgPositionInfo.unit_name}
                        </span>
                      )}
                      {orgPositionInfo.parent_title && (
                        <span className="flex items-center gap-1">
                          <Crown className="w-3 h-3" />گزارش به: {orgPositionInfo.parent_title}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
                    <Link2 className="w-3 h-3" /> از چارت سازمانی
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 rounded-2xl border border-dashed border-gray-200 dark:border-gray-600 text-sm text-gray-400 dark:text-gray-500">
                  <Building2 className="w-5 h-5 flex-shrink-0" />
                  <span>سمت سازمانی از طریق ساختار سازمانی تخصیص نیافته است. ادمین می‌تواند از پنل پیکربندی → ساختار سازمانی سمت تخصیص دهد.</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="نام سازمان / شرکت" icon={Building}>
                  <input type="text" value={profile.organization}
                    onChange={e => set('organization', e.target.value)}
                    className={(orgPositionInfo || profile.primary_position_id) ? inpDisabled : inp}
                    readOnly={!!(orgPositionInfo || profile.primary_position_id)}
                    title={(orgPositionInfo || profile.primary_position_id) ? 'این فیلد از ساختار سازمانی تکمیل می‌شود' : ''}
                    placeholder="نام سازمان یا شرکت" />
                </Field>

                <Field label="سمت / عنوان شغلی" icon={Briefcase}>
                  <input type="text" value={profile.position} disabled className={inpDisabled}
                    title="این فیلد توسط ساختار سازمانی مدیریت می‌شود" />
                </Field>

                <Field label="واحد / دپارتمان" icon={Users}>
                  <input type="text" value={profile.department} disabled className={inpDisabled}
                    title="این فیلد توسط ساختار سازمانی مدیریت می‌شود" />
                </Field>

                <Field label="کد پرسنلی" icon={Hash}>
                  <input type="text" value={profile.employee_id} onChange={e => set('employee_id', e.target.value)}
                    className={inp} placeholder="شماره پرسنلی" dir="ltr" />
                </Field>

                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    تاریخ استخدام (شمسی)
                  </label>
                  <JalaaliDateInput value={profile.hire_date || ''} onChange={v => set('hire_date', v)} className="w-full" />
                </div>

                <Field label="موقعیت مکانی (دفتر)" icon={MapPin}>
                  <input type="text" value={profile.location} onChange={e => set('location', e.target.value)}
                    className={inp} placeholder="آدرس دفتر یا محل کار" />
                </Field>
              </div>

              {(profile.position || profile.department) && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
                  <Building2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  فیلدهای سمت و واحد توسط ادمین از طریق ساختار سازمانی تنظیم می‌شوند و قابل ویرایش نیستند.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Social / links */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="social" title="شبکه‌های اجتماعی و پیام‌رسان" subtitle="اتصال به پیام‌رسان‌های بله و تلگرام" />
          {openSection === 'social' && (
            <div className="p-6 space-y-5">
              <BaleConnectSection />
              <TelegramConnectSection />
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end pb-4">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-8 py-2.5 rounded-xl font-medium transition disabled:opacity-60 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : saved ? <CheckCircle2 className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : saved ? 'ذخیره شد' : 'ذخیره تغییرات'}
          </button>
        </div>
      </form>
    </div>
  );
}
