import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot, Calendar, MessageSquare, ClipboardList, Navigation,
  AlertCircle, CheckCircle2, Clock, Search, RefreshCw,
  Sparkles, Trash2, ChevronDown, ChevronUp, XCircle, Filter,
  Terminal, Send, Mic, BookOpen, Users, Play,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { SparkLog } from './SparkAssistant';

// ─── Log helpers ──────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; icon: React.ElementType; bg: string; text: string }> = {
  meeting_request: { label: 'درخواست جلسه', icon: Calendar, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  create_meeting: { label: 'ایجاد جلسه', icon: Calendar, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  chat_send_message: { label: 'ارسال پیام', icon: MessageSquare, bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  send_message: { label: 'ارسال پیام', icon: MessageSquare, bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  create_task: { label: 'ایجاد اقدام', icon: ClipboardList, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  create_note: { label: 'ثبت یادداشت', icon: BookOpen, bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400' },
  add_contact: { label: 'مخاطب جدید', icon: Users, bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' },
  calendar_view: { label: 'تقویم', icon: Calendar, bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400' },
  calendar_list_today: { label: 'جلسات امروز', icon: Calendar, bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400' },
  navigate: { label: 'ناوبری', icon: Navigation, bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-400' },
  unknown: { label: 'نامشخص', icon: AlertCircle, bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-400' },
};

const STATUS_META = {
  pending: { label: 'در انتظار', icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  done: { label: 'انجام شد', icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  failed: { label: 'ناموفق', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
};

function timeSince(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'همین الان';
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ساعت پیش`;
  return `${Math.floor(hrs / 24)} روز پیش`;
}

// ─── Module command templates ─────────────────────────────────────────────────
interface CommandTemplate { label: string; template: string; }

const MODULE_COMMANDS: { id: string; label: string; icon: React.ElementType; color: string; commands: CommandTemplate[] }[] = [
  {
    id: 'meetings', label: 'درخواست جلسه', icon: Calendar, color: 'blue',
    commands: [
      { label: 'ثبت درخواست جلسه', template: 'ثبت درخواست جلسه با موضوع [موضوع] نماینده [نام نماینده] شماره [شماره تماس]' },
      { label: 'جلسه با مکان و زمان', template: 'ثبت درخواست جلسه با موضوع [موضوع] نماینده [نام] شماره [شماره] مکان [مکان] ساعت [ساعت]' },
      { label: 'جلسه اورژانسی', template: 'ثبت درخواست جلسه با موضوع [موضوع] نماینده [نام] شماره [شماره] اولویت اورژانس' },
    ],
  },
  {
    id: 'chat', label: 'چت سازمانی', icon: MessageSquare, color: 'emerald',
    commands: [
      { label: 'ارسال پیام عادی', template: 'یک پیام بده به [نام کاربر] با موضوع [متن پیام]' },
      { label: 'پیام مهم', template: 'یک پیام بده به [نام کاربر] با موضوع [متن پیام] با اهمیت مهم' },
      { label: 'پیام اورژانسی', template: 'یک پیام بده به [نام کاربر] با موضوع [متن پیام] با اهمیت اورژانسی' },
      { label: 'تماس تصویری', template: 'تماس تصویری با [نام کاربر]' },
    ],
  },
  {
    id: 'calendar', label: 'تقویم', icon: Calendar, color: 'teal',
    commands: [
      { label: 'تقویم روزانه', template: 'برو به تقویم روزانه' },
      { label: 'تقویم هفتگی', template: 'برو به تقویم هفتگی' },
      { label: 'لیست تقویم', template: 'برو به تقویم لیستی' },
      { label: 'جلسات امروز', template: 'لیست جلسات امروز را بهم بگو' },
    ],
  },
  {
    id: 'tasks', label: 'اقدامات', icon: ClipboardList, color: 'amber',
    commands: [
      { label: 'اقدام ساده', template: 'یک اقدام ایجاد کن با عنوان [عنوان]' },
      { label: 'اقدام برای کاربر', template: 'یک اقدام ایجاد کن با عنوان [عنوان] برای [نام کاربر]' },
    ],
  },
  {
    id: 'notes', label: 'یادداشت', icon: BookOpen, color: 'orange',
    commands: [
      { label: 'یادداشت ساده', template: 'یک یادداشت ثبت کن با عنوان [عنوان]' },
      { label: 'یادداشت با محتوا', template: 'یک یادداشت ثبت کن با عنوان [عنوان] با متن [متن یادداشت]' },
    ],
  },
  {
    id: 'contacts', label: 'مخاطبین', icon: Users, color: 'green',
    commands: [
      { label: 'مخاطب جدید', template: 'یک مخاطب جدید ثبت کن به نام [نام] شماره [شماره تماس]' },
      { label: 'مخاطب با شرکت', template: 'یک مخاطب جدید ثبت کن به نام [نام] شماره [شماره] شرکت [نام شرکت]' },
    ],
  },
];

const colorMap: Record<string, { icon: string; badge: string; btn: string }> = {
  blue:    { icon: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', badge: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800', btn: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 border-blue-100 dark:border-blue-800' },
  emerald: { icon: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30', badge: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800', btn: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border-emerald-100 dark:border-emerald-800' },
  teal:    { icon: 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30', badge: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-800', btn: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40 border-teal-100 dark:border-teal-800' },
  amber:   { icon: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30', badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800', btn: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border-amber-100 dark:border-amber-800' },
  orange:  { icon: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30', badge: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-800', btn: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40 border-orange-100 dark:border-orange-800' },
  green:   { icon: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30', badge: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-100 dark:border-green-800', btn: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 border-green-100 dark:border-green-800' },
};

// ─── Command input panel ──────────────────────────────────────────────────────
interface CommandPanelProps {
  module: typeof MODULE_COMMANDS[0];
  onSendCommand: (text: string) => void;
}

function CommandPanel({ module, onSendCommand }: CommandPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [customText, setCustomText] = useState('');
  const c = colorMap[module.color] || colorMap.blue;
  const Icon = module.icon;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${c.icon}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-white text-right">{module.label}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${c.badge}`}>{module.commands.length} دستور</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-50 dark:border-gray-700 p-4 space-y-3">
          <div className="space-y-2">
            {module.commands.map((cmd, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  onClick={() => setCustomText(cmd.template)}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-right transition-colors ${c.btn}`}
                >
                  <Terminal className="w-3 h-3 shrink-0" />
                  <span className="flex-1 font-medium">{cmd.label}</span>
                  <span className="text-[10px] opacity-60 truncate max-w-[200px]">{cmd.template.replace(/\[.*?\]/g, '...')}</span>
                </button>
                <button
                  onClick={() => onSendCommand(cmd.template)}
                  title="اجرای مستقیم در اسپارک"
                  className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors shrink-0"
                >
                  <Play className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mb-1.5">دستور سفارشی:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                placeholder="دستور خود را بنویسید..."
                onKeyDown={e => { if (e.key === 'Enter' && customText.trim()) { onSendCommand(customText); setCustomText(''); } }}
                className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => { if (customText.trim()) { onSendCommand(customText); setCustomText(''); } }}
                disabled={!customText.trim()}
                className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Log card ─────────────────────────────────────────────────────────────────
function LogCard({ log, onDelete }: { log: SparkLog; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const typeMeta = TYPE_META[log.command_type] || TYPE_META.unknown;
  const statusMeta = STATUS_META[log.status] || STATUS_META.pending;
  const TypeIcon = typeMeta.icon;
  const StatusIcon = statusMeta.icon;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeMeta.bg}`}>
            <TypeIcon className={`w-4 h-4 ${typeMeta.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{log.command_text}</p>
            {log.result_summary && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{log.result_summary}</p>}
            {log.error_message && <p className="text-xs text-red-500 mt-0.5">{log.error_message}</p>}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${typeMeta.bg} ${typeMeta.text}`}>
                <TypeIcon className="w-3 h-3" />{typeMeta.label}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusMeta.bg} ${statusMeta.color}`}>
                <StatusIcon className="w-3 h-3" />{statusMeta.label}
              </span>
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />{timeSince(log.created_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {log.payload && Object.keys(log.payload).length > 0 && (
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
            <button onClick={() => onDelete(log.id)} className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {expanded && log.payload && (
        <div className="px-4 pb-4 border-t border-gray-50 dark:border-gray-700 pt-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">داده‌های پردازش شده:</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(log.payload).filter(([k]) => k !== 'type').map(([key, val]) => {
              if (!val || (Array.isArray(val) && val.length === 0)) return null;
              const labels: Record<string, string> = {
                subject: 'موضوع', date: 'تاریخ', startTime: 'ساعت شروع', endTime: 'ساعت پایان',
                representative: 'نماینده', phone: 'شماره', location: 'مکان',
                targetUser: 'گیرنده', messageBody: 'پیام', taskTitle: 'عنوان اقدام',
                noteTitle: 'عنوان یادداشت', contactName: 'نام مخاطب', page: 'صفحه',
              };
              return (
                <div key={key} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-gray-400 mb-0.5">{labels[key] || key}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-200 font-medium">
                    {Array.isArray(val) ? val.join('، ') : String(val)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 px-4 py-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-800 dark:text-white">{value}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      </div>
    </div>
  );
}

// ─── Main SparkPage ───────────────────────────────────────────────────────────
interface SparkPageProps {
  externalLogs?: SparkLog[];
  onSendToAssistant?: (text: string) => void;
}

export function SparkPage({ externalLogs, onSendToAssistant }: SparkPageProps) {
  const [logs, setLogs] = useState<SparkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'commands' | 'logs'>('commands');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('spark_assistant_logs').select('*').order('created_at', { ascending: false }).limit(200);
    setLogs((data as SparkLog[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!externalLogs?.length) return;
    setLogs(prev => {
      const ids = new Set(prev.map(l => l.id));
      const newOnes = externalLogs.filter(l => !ids.has(l.id));
      return newOnes.length ? [...newOnes, ...prev] : prev;
    });
  }, [externalLogs]);

  const deleteLog = async (id: string) => {
    await supabase.from('spark_assistant_logs').delete().eq('id', id);
    setLogs(prev => prev.filter(l => l.id !== id));
    toast.success('حذف شد');
  };

  const clearAll = async () => {
    if (!confirm('آیا از حذف تمام سوابق اسپارک مطمئنید؟')) return;
    await supabase.from('spark_assistant_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setLogs([]);
    toast.success('تمام سوابق حذف شد');
  };

  const filtered = logs.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (search && !l.command_text.includes(search) && !(l.result_summary || '').includes(search)) return false;
    return true;
  });

  const stats = {
    total: logs.length,
    done: logs.filter(l => l.status === 'done').length,
    failed: logs.filter(l => l.status === 'failed').length,
    meetings: logs.filter(l => l.command_type === 'meeting_request' || l.command_type === 'create_meeting').length,
    messages: logs.filter(l => l.command_type === 'send_message' || l.command_type === 'chat_send_message').length,
    tasks: logs.filter(l => l.command_type === 'create_task').length,
  };

  const handleSendCommand = (text: string) => {
    if (onSendToAssistant) {
      onSendToAssistant(text);
    } else {
      toast('پنجره اسپارک را باز کنید و دستور را وارد کنید', { icon: '💬' });
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              اسپارک <Sparkles className="w-4 h-4 text-yellow-400" />
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">دستیار هوشمند سازمانی</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title="بارگذاری مجدد">
            <RefreshCw className="w-4 h-4" />
          </button>
          {logs.length > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-colors">
              <Trash2 className="w-4 h-4" /> حذف همه
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="کل دستورات" value={stats.total} icon={Bot} color="bg-gradient-to-br from-sky-400 to-blue-600" />
        <StatCard label="انجام شده" value={stats.done} icon={CheckCircle2} color="bg-gradient-to-br from-emerald-400 to-green-600" />
        <StatCard label="ناموفق" value={stats.failed} icon={XCircle} color="bg-gradient-to-br from-red-400 to-rose-600" />
        <StatCard label="درخواست جلسه" value={stats.meetings} icon={Calendar} color="bg-gradient-to-br from-blue-400 to-blue-600" />
        <StatCard label="پیام‌ها" value={stats.messages} icon={MessageSquare} color="bg-gradient-to-br from-emerald-400 to-teal-600" />
        <StatCard label="اقدامات" value={stats.tasks} icon={ClipboardList} color="bg-gradient-to-br from-amber-400 to-orange-500" />
      </div>

      {/* How to use */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
        <Mic className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
          <p className="font-semibold mb-1">نحوه استفاده از دستورات صوتی</p>
          <p>روی دکمه میکروفون در پنجره اسپارک کلیک کنید. دستور <strong>کامل</strong> خود را بگویید. سپس دوباره روی دکمه توقف کلیک کنید تا اسپارک پردازش کند و اجرا نماید.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl">
        <button onClick={() => setActiveTab('commands')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'commands' ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
          <Terminal className="w-4 h-4" /> دستورات آماده
        </button>
        <button onClick={() => setActiveTab('logs')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'logs' ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
          <Clock className="w-4 h-4" /> سوابق ({logs.length})
        </button>
      </div>

      {activeTab === 'commands' && (
        <div className="space-y-3">
          {MODULE_COMMANDS.map(mod => (
            <CommandPanel key={mod.id} module={mod} onSendCommand={handleSendCommand} />
          ))}
        </div>
      )}

      {activeTab === 'logs' && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="جستجو..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-400" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-700 dark:text-gray-200 focus:outline-hidden focus:ring-2 focus:ring-blue-400">
              <option value="all">همه وضعیت‌ها</option>
              <option value="done">انجام شده</option>
              <option value="pending">در انتظار</option>
              <option value="failed">ناموفق</option>
            </select>
            {(search || filterStatus !== 'all') && (
              <button onClick={() => { setSearch(''); setFilterStatus('all'); }}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            )}
            <p className="text-xs text-gray-400 mr-auto">{filtered.length} مورد</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-10 h-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
                <Bot className="w-8 h-8 text-white" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-center text-sm">
                {search || filterStatus !== 'all' ? 'نتیجه‌ای یافت نشد' : 'هنوز دستوری اجرا نشده است.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(log => <LogCard key={log.id} log={log} onDelete={deleteLog} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
