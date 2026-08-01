import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, RefreshCw, Upload, Trash2, Eye, FileText, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';
import { MinutesDocumentLayout } from './MinutesDocumentLayout';
import type { MinutesDocumentData } from './MinutesDocumentData';
import { FALLBACK_LOGO } from './MinutesDocumentData';
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
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'];

interface MinutesConfigPanelProps {
  currentUserId: string;
}

export function MinutesConfigPanel({ currentUserId }: MinutesConfigPanelProps) {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
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
      const logoEntry = rows.find(r => r.section === 'appearance' && r.key === 'logo_url');
      setLogoUrl(logoEntry?.value || FALLBACK_LOGO);
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

  const saveConfig = async (key: string, value: string) => {
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
      toast.success('ذخیره شد');
      logAudit({ module: 'system_config', action: 'config_updated', entity_name: `minutes.${key}`, details: `مقدار جدید: ${value}`, severity: 'info' });
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setSavingKey(null);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (uploading) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('فرمت فایل مجاز نیست. فقط PNG، JPEG، GIF یا SVG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('حجم فایل نباید بیش از ۲ مگابایت باشد');
      return;
    }
    setUploading(true);
    setLogoError(false);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `minutes_logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('portal-assets')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from('portal-assets')
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      const logoEntry = configs.find(c => c.section === 'appearance' && c.key === 'logo_url');
      if (logoEntry) {
        const { error: updateErr } = await supabase
          .from('system_config')
          .update({ value: publicUrl, updated_by: currentUserId, updated_at: new Date().toISOString() })
          .eq('id', logoEntry.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('system_config')
          .upsert({ section: 'appearance', key: 'logo_url', value: publicUrl, value_type: 'string', label: 'لوگو صورت‌جلسات' }, { onConflict: 'section,key' });
        if (insertErr) throw insertErr;
      }
      setLogoUrl(publicUrl);
      toast.success('لوگو بارگذاری شد');
      logAudit({ module: 'system_config', action: 'logo_uploaded', entity_name: 'minutes.logo_url', details: 'لوگو صورت‌جلسات بارگذاری شد', severity: 'info' });
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
      const logoEntry = configs.find(c => c.section === 'appearance' && c.key === 'logo_url');
      if (logoEntry) {
        await supabase
          .from('system_config')
          .update({ value: '', updated_by: currentUserId, updated_at: new Date().toISOString() })
          .eq('id', logoEntry.id);
      }
      setLogoUrl(null);
      setLogoError(false);
      toast.success('لوگو حذف شد');
    } catch {
      toast.error('خطا در حذف لوگو');
    } finally {
      setUploading(false);
    }
  };

  // ── Build preview data ──────────────────────────────────────────────────
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
    approvals: [],
    approvalComments: [],
    logoUrl: cfgBool('minutes_show_logo', true) ? logoUrl : null,
  };

  // ── Config values for layout ─────────────────────────────────────────────
  const layoutConfig = {
    headerTitle: cfgVal('minutes_header_title', 'صورت‌جلسه'),
    orgName: cfgVal('minutes_org_name', ''),
    subtitle: cfgVal('minutes_subtitle', ''),
    footerText: cfgVal('minutes_footer_text', 'پایان صورت‌جلسه'),
    showLogo: cfgBool('minutes_show_logo', true),
    showParticipants: cfgBool('minutes_show_participants', true),
    showApprovers: cfgBool('minutes_show_approvers', true),
    showConfidentiality: cfgBool('minutes_show_confidentiality', true),
    showDecisions: cfgBool('minutes_show_decisions', true),
    fontSize: cfgVal('minutes_font_size', 'medium'),
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
      {/* ── Logo upload ─────────────────────────────────────────────────────── */}
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
                onError={() => setLogoError(true)}
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
                {uploading ? 'در حال آپلود...' : logoUrl ? 'تغییر لوگو' : 'بارگذاری لوگو'}
              </button>
              {logoUrl && !uploading && (
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
              فرمت‌های مجاز: PNG، JPEG، GIF، SVG — حداکثر ۲ مگابایت
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

      {/* ── Document appearance settings ───────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-500" />
          تنظیمات ظاهری سند
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Header title */}
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
          {/* Org name */}
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
          {/* Subtitle */}
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
          {/* Footer text */}
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

        {/* Visibility toggles */}
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
          <h5 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">نمایش بخش‌های سند</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {([
              { key: 'minutes_show_logo', label: 'نمایش لوگو' },
              { key: 'minutes_show_participants', label: 'نمایش شرکت‌کنندگان و امضاها' },
              { key: 'minutes_show_approvers', label: 'نمایش تأییدکنندگان' },
              { key: 'minutes_show_confidentiality', label: 'نمایش سطح محرمانگی' },
              { key: 'minutes_show_decisions', label: 'نمایش اطلاعات مصوبات' },
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

        {/* Font size select */}
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

      {/* ── Default settings ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-500" />
          تنظیمات پیش‌فرض
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Default confidentiality */}
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
          {/* Default approval mode */}
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

      {/* ── Live preview ─────────────────────────────────────────────────────── */}
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
        <div className="p-5 overflow-x-auto">
          <div
            className="mx-auto bg-white border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm"
            style={{ maxWidth: '800px', fontSize: FONT_SIZE_MAP[cfgVal('minutes_font_size', 'medium')] || '14px' }}
          >
            <MinutesDocumentLayoutWithConfig
              data={previewData}
              variant="preview"
              config={layoutConfig}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Extended layout with config support ─────────────────────────────────────
interface MinutesLayoutConfig {
  headerTitle: string;
  orgName: string;
  subtitle: string;
  footerText: string;
  showLogo: boolean;
  showParticipants: boolean;
  showApprovers: boolean;
  showConfidentiality: boolean;
  showDecisions: boolean;
  fontSize: string;
}

function MinutesDocumentLayoutWithConfig({
  data,
  variant,
  config,
}: {
  data: MinutesDocumentData;
  variant: 'print' | 'preview';
  config: MinutesLayoutConfig;
}) {
  const { minute, internalParts, externalParts, agendaItems, decisions, logoUrl } = data;
  const [logoError, setLogoError] = useState(false);

  const PRESENT_STATUSES = new Set(['present', 'online', 'late']);
  const presentNames: string[] = [];
  const absentNames: string[] = [];
  for (const p of internalParts) {
    if (p.attendance_status && PRESENT_STATUSES.has(p.attendance_status)) {
      presentNames.push(p.delegate_name || p.name_snapshot);
    } else if (p.attendance_status === 'absent') {
      absentNames.push(p.name_snapshot);
    }
  }
  for (const p of externalParts) {
    if (p.attendance_status && PRESENT_STATUSES.has(p.attendance_status)) {
      presentNames.push(p.full_name);
    } else if (p.attendance_status === 'absent') {
      absentNames.push(p.full_name);
    }
  }

  const allSigners = [
    ...internalParts.map(p => ({ id: p.id, name: p.name_snapshot, sub: p.org_unit_name_snapshot || '—' })),
    ...externalParts.map(p => ({ id: p.id, name: p.full_name, sub: p.organization || '—' })),
  ];
  const signCols = allSigners.length <= 1 ? 1 : Math.min(allSigners.length, 6);
  const signRows: typeof allSigners[][] = [];
  for (let i = 0; i < allSigners.length; i += signCols) {
    signRows.push(allSigners.slice(i, i + signCols));
  }

  const rootClass = variant === 'print' ? 'minutes-print-root' : 'minutes-preview-root';

  return (
    <div className={rootClass} dir="rtl">
      <div className="mp-doc">
        {/* Header */}
        <div className="mp-header">
          {config.showLogo && (
            <div className="mp-header-logo">
              {logoUrl && !logoError ? (
                <img
                  src={logoUrl}
                  alt="لوگو سازمان"
                  className="mp-logo"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div className="mp-logo-placeholder">محل لوگو</div>
              )}
            </div>
          )}
          <h1>{config.headerTitle || 'صورت‌جلسه'}</h1>
          {config.orgName && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{config.orgName}</p>}
          {config.subtitle && <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{config.subtitle}</p>}
        </div>

        {/* Meeting details */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">مشخصات جلسه</h2>
          <div className="mp-info-row-full">
            <span className="mp-label">عنوان جلسه:</span>
            <span className="mp-value">{minute.meeting_title_snapshot || '—'}</span>
          </div>
          <div className="mp-info-row-two">
            <div className="mp-field">
              <span className="mp-label">حاضرین جلسه:</span>
              <span className="mp-value">{presentNames.length > 0 ? presentNames.join('، ') : '—'}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">غایبین جلسه:</span>
              <span className="mp-value">{absentNames.length > 0 ? absentNames.join('، ') : '—'}</span>
            </div>
          </div>
          <div className="mp-info-row-three">
            <div className="mp-field">
              <span className="mp-label">محل جلسه:</span>
              <span className="mp-value">{minute.meeting_location_snapshot || '—'}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">دبیر جلسه:</span>
              <span className="mp-value">{minute.secretary_name_snapshot || '—'}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">رئیس جلسه:</span>
              <span className="mp-value">{minute.chair_name_snapshot || '—'}</span>
            </div>
          </div>
          {config.showConfidentiality && (
            <div className="mp-info-row-full">
              <span className="mp-label">سطح محرمانگی:</span>
              <span className="mp-value">{minute.confidentiality || 'سازمانی'}</span>
            </div>
          )}
        </div>

        {/* Agenda */}
        <div className="mp-section">
          <h2 className="mp-section-title">دستور جلسات</h2>
          {agendaItems.length === 0 ? (
            <p className="mp-item-row">—</p>
          ) : (
            <ol className="mp-agenda-list">
              {agendaItems.map(item => (
                <li key={item.id} className="mp-agenda-list-item">
                  {item.order}. {item.title}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Decisions */}
        {config.showDecisions && (
          <div className="mp-section">
            <h2 className="mp-section-title">مصوبات</h2>
            {decisions.length === 0 ? (
              <p className="mp-item-row">—</p>
            ) : (
              decisions.map((d, i) => (
                <div key={d.id} className="mp-decision-item">
                  <div className="mp-item-title">
                    مصوبه {i + 1} ـ {d.description || d.title || '—'}
                  </div>
                  <div className="mp-item-row mp-item-row-inline">
                    <span><span className="mp-item-label">واحد مسئول: </span>{d.responsibleUnitName || '—'}</span>
                    <span><span className="mp-item-label">مهلت انجام: </span>{d.dueDate || '—'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Signatures */}
        {config.showParticipants && allSigners.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">شرکت‌کنندگان و امضاها</h2>
            {signRows.map((row, rowIdx) => (
              <div key={rowIdx} className="mp-sign-grid" style={{ gridTemplateColumns: `repeat(${signCols}, 1fr)` }}>
                {row.map(s => (
                  <div key={s.id} className="mp-sign-box">
                    <div className="mp-sign-name">{s.name}</div>
                    <div className="mp-sign-sub">{s.sub}</div>
                    <div className="mp-sign-space" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mp-end-note">{config.footerText || 'پایان صورت‌جلسه'}</div>
      </div>
    </div>
  );
}
