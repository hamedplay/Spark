import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Upload, Trash2, Eye, FileText, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';
import { MinutesDocumentLayout } from './MinutesDocumentLayout';
import { MinutesPreviewFrame } from './Shared/MinutesPreviewFrame';
import type { MinutesDocumentData, MinutesLayoutConfig } from './MinutesDocumentData';
import { FALLBACK_LOGO } from './MinutesDocumentData';
import {
  normalizeMinutesLayoutConfig,
  resolveMinutesLogoUrl,
  validateMinutesConfigValue,
} from './fetchMinutesConfig';
import type { ConfigEntry } from '../PortalConfig/types';

const FONT_SIZE_MAP: Record<string, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
};

const CONFIDENTIALITY_OPTIONS = [
  { value: 'public', label: 'عمومی' },
  { value: 'organizational', label: 'سازمانی' },
  { value: 'restricted', label: 'دسترسی محدود' },
  { value: 'confidential', label: 'محرمانه' },
];

const APPROVAL_MODE_OPTIONS = [
  { value: 'system', label: 'سیستمی' },
  { value: 'in_person', label: 'حضوری' },
];

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'کوچک (۱۲px)' },
  { value: 'medium', label: 'متوسط (۱۴px)' },
  { value: 'large', label: 'بزرگ (۱۶px)' },
];

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

const LOGO_STORAGE_BUCKET = 'portal-assets';
const LOGO_STORAGE_PREFIX = 'minutes/logo/';

interface MinutesConfigPanelProps {
  currentUserId: string;
}

export function MinutesConfigPanel({ currentUserId }: MinutesConfigPanelProps) {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [logoUrl, setLogoUrl] = useState<string>(FALLBACK_LOGO);
  const [rawMap, setRawMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_config')
        .select('*')
        .or('section.eq.minutes,section.eq.appearance.and.key.eq.logo_url')
        .order('section')
        .order('key');
      if (error) throw error;
      const rows = (data || []) as ConfigEntry[];
      setConfigs(rows.filter(r => r.section === 'minutes'));

      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(`${r.section}.${r.key}`, r.value ?? '');
      }
      setRawMap(map);
      setLogoUrl(resolveMinutesLogoUrl(map));
      setLogoError(false);
    } catch {
      toast.error('بارگذاری تنظیمات صورت‌جلسات ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const cfg = (key: string): ConfigEntry | undefined => configs.find(c => c.key === key);
  const cfgVal = (key: string, fallback: string): string => {
    const e = cfg(key);
    return e?.value ?? fallback;
  };
  const cfgBool = (key: string, fallback: boolean): boolean => {
    const e = cfg(key);
    if (!e) return fallback;
    return e.value === 'true';
  };

  const layoutConfig: MinutesLayoutConfig = normalizeMinutesLayoutConfig(rawMap);

  const saveConfig = async (key: string, value: string) => {
    if (!validateMinutesConfigValue(key, value)) {
      toast.error('مقدار واردشده معتبر نیست');
      return;
    }
    const entry = cfg(key);
    if (!entry) return;
    if (savingKey) return;
    setSavingKey(key);
    try {
      const { error } = await supabase
        .from('system_config')
        .update({ value, updated_by: currentUserId, updated_at: new Date().toISOString() })
        .eq('id', entry.id);
      if (error) throw error;
      setConfigs(prev => prev.map(c => c.id === entry.id ? { ...c, value } : c));
      setRawMap(prev => { const m = new Map(prev); m.set(`minutes.${key}`, value); return m; });
      toast.success('ذخیره شد');
      logAudit({ module: 'system_config', action: 'config_updated', entity_name: `minutes.${key}`, details: `مقدار جدید: ${value}`, severity: 'info' });
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setSavingKey(null);
    }
  };

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'فرمت فایل مجاز نیست. فقط PNG، JPEG یا WebP';
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return 'پسوند فایل مجاز نیست. فقط PNG، JPG، JPEG یا WebP';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'حجم فایل نباید بیش از ۲ مگابایت باشد';
    }
    return null;
  };

  const extractStoragePath = (url: string): string | null => {
    try {
      const u = new URL(url);
      const prefix = `/object/public/${LOGO_STORAGE_BUCKET}/`;
      const idx = u.pathname.indexOf(prefix);
      if (idx === -1) return null;
      const path = u.pathname.slice(idx + prefix.length);
      if (!path.startsWith(LOGO_STORAGE_PREFIX)) return null;
      return path;
    } catch {
      return null;
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (uploading) return;
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    setLogoError(false);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const normalizedExt = ext === 'jpg' ? 'jpeg' : ext;
      const path = `${LOGO_STORAGE_PREFIX}${Date.now()}.${normalizedExt}`;
      const { error: uploadError } = await supabase.storage
        .from(LOGO_STORAGE_BUCKET)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from(LOGO_STORAGE_BUCKET)
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const logoEntry = cfg('minutes_logo_url');
      if (logoEntry) {
        const { error: updateErr } = await supabase
          .from('system_config')
          .update({ value: publicUrl, updated_by: currentUserId, updated_at: new Date().toISOString() })
          .eq('id', logoEntry.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('system_config')
          .upsert({
            section: 'minutes',
            key: 'minutes_logo_url',
            value: publicUrl,
            value_type: 'string',
            label: 'لوگوی صورت‌جلسات',
          }, { onConflict: 'section,key' });
        if (insertErr) throw insertErr;
      }

      const oldUrl = rawMap.get('minutes.minutes_logo_url') || '';
      const oldPath = extractStoragePath(oldUrl);
      if (oldPath && oldPath !== path) {
        const { error: delErr } = await supabase.storage
          .from(LOGO_STORAGE_BUCKET)
          .remove([oldPath]);
        if (delErr) {
          console.warn('Failed to cleanup old logo:', delErr.message);
        }
      }

      setLogoUrl(publicUrl);
      setLogoError(false);
      toast.success('لوگو بارگذاری شد');
      logAudit({ module: 'system_config', action: 'minutes_logo_uploaded', entity_name: 'minutes.minutes_logo_url', details: 'لوگو صورت‌جلسات بارگذاری شد', severity: 'info' });
      await loadConfigs();
    } catch {
      toast.error('خطا در آپلود لوگو');
    } finally {
      setUploading(false);
    }
  };

  const handleLogoDelete = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const logoEntry = cfg('minutes_logo_url');
      if (logoEntry) {
        const { error: updateErr } = await supabase
          .from('system_config')
          .update({ value: '', updated_by: currentUserId, updated_at: new Date().toISOString() })
          .eq('id', logoEntry.id);
        if (updateErr) throw updateErr;
      }

      const oldUrl = rawMap.get('minutes.minutes_logo_url') || '';
      const oldPath = extractStoragePath(oldUrl);
      if (oldPath) {
        const { error: delErr } = await supabase.storage
          .from(LOGO_STORAGE_BUCKET)
          .remove([oldPath]);
        if (delErr) {
          console.warn('Failed to delete logo file:', delErr.message);
        }
      }

      setLogoUrl(resolveMinutesLogoUrl(new Map()));
      setLogoError(false);
      toast.success('لوگو حذف شد');
      logAudit({ module: 'system_config', action: 'minutes_logo_deleted', entity_name: 'minutes.minutes_logo_url', details: 'لوگو صورت‌جلسات حذف شد', severity: 'info' });
      await loadConfigs();
    } catch {
      toast.error('خطا در حذف لوگو');
    } finally {
      setUploading(false);
    }
  };

  const previewData: MinutesDocumentData = {
    minute: {
      meeting_title_snapshot: 'جلسه بررسی گزارش فصلی',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: '10:00',
      meeting_end_time_snapshot: '11:30',
      meeting_location_snapshot: 'سال جلسات',
      meeting_type: 'دستی',
      org_unit_name_snapshot: 'معاونت برنامه‌ریزی',
      secretary_name_snapshot: 'کارشناس دبیرخانه',
      chair_name_snapshot: 'مدیر محترم',
      notes: 'یادداشت نمونه برای پیش‌نمایش',
      confidentiality: cfgVal('minutes_default_confidentiality', 'organizational'),
      status: 'published',
      approval_mode: cfgVal('minutes_default_approval_mode', 'system'),
      revision_number: 1,
      secretary_confirmed_at: '2026-08-01T10:00:00Z',
      chair_confirmed_at: '2026-08-01T11:00:00Z',
      published_at: '2026-08-01T11:30:00Z',
    },
    internalParts: [
      { id: '1', name_snapshot: 'کارشناس الف', position_snapshot: 'کارشناس', org_unit_name_snapshot: 'واحد برنامه‌ریزی', attendance_status: 'present', delegate_name: null },
      { id: '2', name_snapshot: 'کارشناس ب', position_snapshot: 'کارشناس ارشد', org_unit_name_snapshot: 'واحد مالی', attendance_status: 'absent', delegate_name: null },
    ],
    externalParts: [
      { id: '3', full_name: 'مشاور خارجی', organization: 'شرکت مشاوران', position: 'مشاور', attendance_status: 'online' },
    ],
    agendaItems: [
      { id: 'a1', order: 1, title: 'بررسی گزارش عملکرد', description: '', presenter: 'کارشناس الف', allocatedTime: '۳۰ دقیقه' },
    ],
    decisions: [
      { id: 'd1', title: 'تصمیم نمونه', description: 'اقدام اجرایی مورد توافق', primaryOwnerName: 'کارشناس الف', responsibleUnitName: 'واحد برنامه‌ریزی', priority: 'normal', startDate: '2026-08-01', dueDate: '2026-09-01', status: 'in_progress', progressPercent: 30, latestUpdate: '', discussionResult: '', resultType: 'resolution', additionalNotes: '' },
    ],
    approvals: [
      { id: 'ap1', approver_name: 'مدیر محترم', status: 'approved', approved_at: '2026-08-01T11:00:00Z', changes_requested_at: null },
      { id: 'ap2', approver_name: 'کارشناس ارشد', status: 'pending', approved_at: null, changes_requested_at: null },
    ],
    approvalComments: [],
    logoUrl: cfgBool('minutes_show_logo', true) ? logoUrl : null,
    config: layoutConfig,
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="mr-2 text-sm text-gray-500">در حال بارگذاری...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-500" />
          لوگوی صورت‌جلسات
        </h4>
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="w-28 h-20 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl && !logoError ? (
              <img
                src={logoUrl}
                alt="لوگو صورت‌جلسات"
                className="w-full h-full object-contain p-1"
                onError={() => { setLogoError(true); }}
              />
            ) : (
              <FileText className="w-8 h-8 text-gray-400" />
            )}
          </div>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'در حال آپلود...' : logoUrl && logoUrl !== FALLBACK_LOGO ? 'تغییر لوگو' : 'بارگذاری لوگو'}
              </button>
              {logoUrl && logoUrl !== FALLBACK_LOGO && !uploading && (
                <button
                  onClick={handleLogoDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  حذف
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              فرمت‌های مجاز: PNG، JPEG، WebP — حداکثر ۲ مگابایت
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              در صورت خرابی یا حذف، لوگوی پیش‌فرض سامانه نمایش داده می‌شود.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleLogoUpload(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-500" />
          تنظیمات ظاهری سند
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">عنوان سربرگ</label>
            <input
              type="text"
              value={cfgVal('minutes_header_title', 'صورت‌جلسه')}
              onChange={e => {
                const entry = cfg('minutes_header_title');
                if (entry) setConfigs(prev => prev.map(c => c.id === entry.id ? { ...c, value: e.target.value } : c));
              }}
              onBlur={e => saveConfig('minutes_header_title', e.target.value)}
              maxLength={100}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">نام سازمان</label>
            <input
              type="text"
              value={cfgVal('minutes_org_name', '')}
              onChange={e => {
                const entry = cfg('minutes_org_name');
                if (entry) setConfigs(prev => prev.map(c => c.id === entry.id ? { ...c, value: e.target.value } : c));
              }}
              onBlur={e => saveConfig('minutes_org_name', e.target.value)}
              maxLength={200}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">زیرعنوان اختیاری</label>
            <input
              type="text"
              value={cfgVal('minutes_subtitle', '')}
              onChange={e => {
                const entry = cfg('minutes_subtitle');
                if (entry) setConfigs(prev => prev.map(c => c.id === entry.id ? { ...c, value: e.target.value } : c));
              }}
              onBlur={e => saveConfig('minutes_subtitle', e.target.value)}
              maxLength={200}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">متن پاورقی</label>
            <input
              type="text"
              value={cfgVal('minutes_footer_text', 'پایان صورت‌جلسه')}
              onChange={e => {
                const entry = cfg('minutes_footer_text');
                if (entry) setConfigs(prev => prev.map(c => c.id === entry.id ? { ...c, value: e.target.value } : c));
              }}
              onBlur={e => saveConfig('minutes_footer_text', e.target.value)}
              maxLength={200}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
          <h5 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">نمایش بخش‌های سند</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {([
              { key: 'minutes_show_logo', label: 'نمایش لوگو' },
              { key: 'minutes_show_participants', label: 'نمایش محل امضای شرکت‌کنندگان' },
              { key: 'minutes_show_approvers', label: 'نمایش سوابق تأیید سیستمی' },
              { key: 'minutes_show_confidentiality', label: 'نمایش سطح محرمانگی' },
              { key: 'minutes_show_decisions', label: 'نمایش اطلاعات مصوبات' },
              { key: 'minutes_show_notes', label: 'نمایش یادداشت‌ها' },
              { key: 'minutes_show_absentees', label: 'نمایش غایبین' },
              { key: 'minutes_show_agenda', label: 'نمایش دستور جلسات' },
            ] as const).map(({ key, label }) => {
              const val = cfgBool(key, true);
              return (
                <div key={key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                  <button
                    onClick={() => saveConfig(key, val ? 'false' : 'true')}
                    disabled={savingKey === key}
                    className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${val ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${val ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
          <h5 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">اندازه فونت</h5>
          <div className="flex flex-wrap gap-2">
            {FONT_SIZE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => saveConfig('minutes_font_size', opt.value)}
                disabled={savingKey === 'minutes_font_size'}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                  cfgVal('minutes_font_size', 'medium') === opt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-500" />
          تنظیمات پیش‌فرض
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">سطح محرمانگی پیش‌فرض</label>
            <div className="flex flex-wrap gap-2">
              {CONFIDENTIALITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => saveConfig('minutes_default_confidentiality', opt.value)}
                  disabled={savingKey === 'minutes_default_confidentiality'}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${
                    cfgVal('minutes_default_confidentiality', 'organizational') === opt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">شیوه تأیید پیش‌فرض</label>
            <div className="flex flex-wrap gap-2">
              {APPROVAL_MODE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => saveConfig('minutes_default_approval_mode', opt.value)}
                  disabled={savingKey === 'minutes_default_approval_mode'}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${
                    cfgVal('minutes_default_approval_mode', 'system') === opt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Eye className="w-4 h-4 text-green-500" />
            پیش‌نمایش قالب
          </h4>
          <button
            onClick={loadConfigs}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <MinutesPreviewFrame fontSize={FONT_SIZE_MAP[cfgVal('minutes_font_size', 'medium')] || '14px'}>
          <MinutesDocumentLayout
            data={previewData}
            variant="preview"
          />
        </MinutesPreviewFrame>
      </div>
    </div>
  );
}
