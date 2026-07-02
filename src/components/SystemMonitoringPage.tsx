import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarDays, MessageSquare, SquareCheck as CheckSquare, Users, ListFilter as Filter, Search, MoveVertical as MoreVertical, CreditCard as Edit2, Trash2, GitBranch, X, CircleCheck as CheckCircle, Archive, Share2, Calendar, ArrowRight, Circle, Loader as Loader2, RefreshCw, Circle as XCircle, TriangleAlert as AlertTriangle, Hash, Lock, Eye, Hash as ChannelIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface MeetingRow {
  id: string;
  subject: string;
  request_date: string | null;
  duration: string | null;
  location: string | null;
  representative: string | null;
  phone: string | null;
  notes: string | null;
  priority: string | null;
  status: string | null;
  status_type: string | null;
  created_at: string | null;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  guest_emails: string[] | null;
  members_only: boolean | null;
  repeat_type: string | null;
  shared_count?: number;
  creator_name?: string | null;
  participants?: { id: string; name: string }[];
  actions?: { id: string; title: string; status: string; assignee: string }[];
}

interface MeetingFlowEvent {
  label: string;
  date: string | null;
  actor?: string | null;
  icon: React.ElementType;
  color: string;
  done: boolean;
}

interface ChatConversation {
  id: string;
  type: string;
  name: string | null;
  created_at: string | null;
  creator_id: string | null;
  participant_ids: string[] | null;
  last_message_at: string | null;
  creator_name?: string | null;
  message_count?: number;
  messages?: ChatMessage[];
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  sender_name?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  assignee: string | null;
  created_at: string | null;
  user_id: string | null;
  archived: boolean | null;
  current_assignee_id: string | null;
  created_by_id: string | null;
  source_message_id: string | null;
  creator_name?: string | null;
  assignee_name?: string | null;
  workflow?: TaskWorkflowStep[];
}

interface TaskWorkflowStep {
  id: string;
  task_id: string;
  actor_id: string | null;
  action: string;
  from_user_id: string | null;
  to_user_id: string | null;
  note: string | null;
  created_at: string;
  actor_name?: string | null;
  from_name?: string | null;
  to_name?: string | null;
}

interface ChannelRow {
  id: string;
  name: string | null;
  type: string | null;
  is_private: boolean | null;
  created_by: string | null;
  created_at: string | null;
  member_count: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  creator_name?: string | null;
  message_count?: number;
  messages?: ChannelMsgRow[];
}

interface ChannelMsgRow {
  id: string;
  channel_id: string;
  sender_id: string | null;
  body: string;
  message_type: string | null;
  created_at: string;
  sender_name?: string | null;
}

interface GroupTaskRow {
  id: string;
  channel_id: string;
  title: string;
  body: string | null;
  status: string;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  channel_name?: string | null;
  creator_name?: string | null;
}

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUPERADMIN_CODE = '19881990';

function maskConfidential(body: string, msgType: string | null, revealed: boolean): React.ReactNode {
  if (msgType === 'confidential' && !revealed) {
    return (
      <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 italic">
        <Lock className="w-3 h-3" />پیام محرمانه ارسال شده است
      </span>
    );
  }
  return body;
}

// Convert gregorian ISO string to jalali display
const toJalali = (d: string | null): string => {
  if (!d) return '—';
  return moment(d).format('jYYYY/jMM/jDD');
};

const toJalaliTime = (d: string | null): string => {
  if (!d) return '—';
  return moment(d).format('jYYYY/jMM/jDD HH:mm');
};

// Convert jalali date input (jYYYY/jMM/jDD) to ISO for DB query
const jalaliToGregorian = (jDate: string): string | null => {
  if (!jDate) return null;
  try {
    const m = moment(jDate, 'jYYYY/jMM/jDD');
    if (!m.isValid()) return null;
    return m.toISOString();
  } catch { return null; }
};

const priorityLabel: Record<string, string> = { high: 'بالا', medium: 'متوسط', low: 'پایین' };
const priorityColor: Record<string, string> = {
  high: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  low: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
};
const statusLabel: Record<string, string> = {
  open: 'باز', closed: 'بسته', requested: 'درخواست شده', approved: 'تایید شده',
  pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'تکمیل شده',
};
const statusColor: Record<string, string> = {
  open: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  closed: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  requested: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
};

const SEL = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const INP = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function Badge2({ label, colorCls }: { label: string; colorCls: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorCls}`}>{label}</span>;
}

function DataField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">{value ?? '—'}</span>
    </div>
  );
}

// Jalali date input that displays and accepts jYYYY/jMM/jDD
function JalaliInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'مثال: 1403/06/15'}
      className={INP}
      dir="ltr"
    />
  );
}

// ─── MeetingFlowModal ─────────────────────────────────────────────────────────

function MeetingFlowModal({ meeting, profiles, onClose }: {
  meeting: MeetingRow; profiles: Profile[]; onClose: () => void;
}) {
  const getProfile = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)) : null;

  const events: MeetingFlowEvent[] = [
    { label: 'ایجاد درخواست', date: meeting.created_at, actor: getProfile(meeting.user_id), icon: Circle, color: 'bg-blue-500', done: true },
    { label: 'تایید جلسه', date: meeting.status_type === 'approved' ? meeting.request_date : null, actor: null, icon: CheckCircle, color: meeting.status_type === 'approved' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600', done: meeting.status_type === 'approved' },
    { label: 'تنظیم زمان جلسه', date: meeting.start_time, actor: null, icon: Calendar, color: meeting.start_time ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600', done: !!meeting.start_time },
    { label: 'بایگانی / بسته شدن', date: meeting.status === 'closed' ? meeting.created_at : null, actor: null, icon: Archive, color: meeting.status === 'closed' ? 'bg-gray-500' : 'bg-gray-300 dark:bg-gray-600', done: meeting.status === 'closed' },
  ];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت جلسه</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{meeting.subject}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-0">
          {events.map((ev, i) => {
            const Icon = ev.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${ev.done ? ev.color : 'bg-gray-200 dark:bg-gray-700'}`}>
                    <Icon className={`w-4 h-4 ${ev.done ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`} />
                  </div>
                  {i < events.length - 1 && <div className={`w-0.5 flex-1 my-1 rounded-full ${ev.done ? 'bg-teal-300 dark:bg-teal-700' : 'bg-gray-200 dark:bg-gray-700'}`} style={{ minHeight: '32px' }} />}
                </div>
                <div className={`pb-5 flex-1 ${i === events.length - 1 ? 'pb-0' : ''}`}>
                  <p className={`font-semibold text-sm ${ev.done ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{ev.label}</p>
                  {ev.date && <p className="text-xs text-gray-500 mt-0.5">{toJalaliTime(ev.date)}</p>}
                  {ev.actor && <p className="text-xs text-blue-500 mt-0.5">توسط: {ev.actor}</p>}
                  {!ev.done && <p className="text-xs text-gray-400 mt-0.5 italic">انجام نشده</p>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">اشتراک‌گذاری:
              <span className={`mr-1 font-bold ${(meeting.shared_count || 0) > 0 ? 'text-blue-500' : 'text-gray-400'}`}>
                {(meeting.shared_count || 0) > 0 ? `${meeting.shared_count} بار` : 'انجام نشده'}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">شرکت‌کنندگان: <span className="font-bold text-teal-600 dark:text-teal-400 mr-1">{meeting.participants?.length || 0} نفر</span></span>
          </div>
          {meeting.participants && meeting.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pr-6">
              {meeting.participants.map(p => <span key={p.id} className="px-2 py-0.5 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-xs">{p.name}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MeetingEditModal (full edit) ─────────────────────────────────────────────

function MeetingEditModal({ meeting, onClose, onSaved }: {
  meeting: MeetingRow; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    subject: meeting.subject || '',
    representative: meeting.representative || '',
    phone: meeting.phone || '',
    location: meeting.location || '',
    duration: meeting.duration || '',
    notes: meeting.notes || '',
    priority: meeting.priority || 'medium',
    status: meeting.status || 'open',
    status_type: meeting.status_type || 'requested',
    request_date: meeting.request_date || '',
    start_time: meeting.start_time ? toJalali(meeting.start_time) : '',
    end_time: meeting.end_time ? toJalali(meeting.end_time) : '',
    members_only: meeting.members_only || false,
    repeat_type: meeting.repeat_type || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      subject: form.subject,
      representative: form.representative,
      phone: form.phone,
      location: form.location,
      duration: form.duration,
      notes: form.notes,
      priority: form.priority,
      status: form.status,
      status_type: form.status_type,
      members_only: form.members_only,
      repeat_type: form.repeat_type || null,
    };
    // Convert jalali back to ISO
    if (form.start_time) {
      const iso = jalaliToGregorian(form.start_time);
      if (iso) payload.start_time = iso;
    }
    if (form.end_time) {
      const iso = jalaliToGregorian(form.end_time);
      if (iso) payload.end_time = iso;
    }
    const { error } = await supabase.from('meetings').update(payload).eq('id', meeting.id);
    setSaving(false);
    if (error) { toast.error('خطا در ذخیره'); return; }
    toast.success('جلسه ویرایش شد');
    onSaved();
    onClose();
  };

  const f = (label: string, key: keyof typeof form, type: 'text' | 'select' | 'textarea' | 'jalali' | 'toggle' = 'text', opts?: { value: string; label: string }[]) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      {type === 'textarea' ? (
        <textarea rows={2} value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={INP + ' resize-none'} />
      ) : type === 'select' && opts ? (
        <select value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={SEL}>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'toggle' ? (
        <button type="button" onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}
          className={`w-10 h-5 rounded-full relative transition-colors ${form[key] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      ) : type === 'jalali' ? (
        <JalaliInput value={form[key] as string} onChange={v => setForm(p => ({ ...p, [key]: v }))} />
      ) : (
        <input type="text" value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={INP} />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-bold text-gray-900 dark:text-white">ویرایش جلسه</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {f('موضوع جلسه', 'subject')}
            {f('نماینده', 'representative')}
            {f('تلفن', 'phone')}
            {f('مکان', 'location')}
            {f('مدت', 'duration')}
            {f('تکرار', 'repeat_type', 'select', [
              { value: '', label: 'بدون تکرار' },
              { value: 'daily', label: 'روزانه' },
              { value: 'weekly', label: 'هفتگی' },
              { value: 'monthly', label: 'ماهانه' },
            ])}
            {f('وضعیت', 'status', 'select', [
              { value: 'open', label: 'باز' },
              { value: 'closed', label: 'بسته' },
            ])}
            {f('نوع', 'status_type', 'select', [
              { value: 'requested', label: 'درخواست شده' },
              { value: 'approved', label: 'تایید شده' },
            ])}
            {f('اولویت', 'priority', 'select', [
              { value: 'high', label: 'بالا' },
              { value: 'medium', label: 'متوسط' },
              { value: 'low', label: 'پایین' },
            ])}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">فقط اعضا</label>
              <button type="button" onClick={() => setForm(p => ({ ...p, members_only: !p.members_only }))}
                className={`w-10 h-5 rounded-full relative transition-colors ${form.members_only ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.members_only ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">زمان شروع (شمسی)</label>
              <JalaliInput value={form.start_time} onChange={v => setForm(p => ({ ...p, start_time: v }))} placeholder="1403/06/15" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">زمان پایان (شمسی)</label>
              <JalaliInput value={form.end_time} onChange={v => setForm(p => ({ ...p, end_time: v }))} placeholder="1403/06/15" />
            </div>
          </div>
          {f('یادداشت', 'notes', 'textarea')}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} ذخیره
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

// ─── TaskFlowModal ────────────────────────────────────────────────────────────

function TaskFlowModal({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const actionLabel: Record<string, string> = {
    created: 'ایجاد اقدام', referred: 'ارجاع شده', accepted: 'پذیرفته شده',
    completed: 'تکمیل شده', rejected: 'رد شده', note_added: 'یادداشت اضافه شد',
  };
  const actionColor: Record<string, string> = {
    created: 'bg-blue-500', referred: 'bg-amber-500', accepted: 'bg-teal-500',
    completed: 'bg-green-500', rejected: 'bg-red-500', note_added: 'bg-gray-400',
  };
  const ActionIcon: Record<string, React.ElementType> = {
    created: Circle, referred: ArrowRight, accepted: CheckCircle,
    completed: CheckSquare, rejected: XCircle, note_added: Hash,
  };

  const steps = task.workflow || [];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت اقدام</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{task.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          {steps.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">تاریخچه‌ای ثبت نشده</p>
              <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">مراحل اقدام هنوز ثبت نشده‌اند</p>
            </div>
          ) : steps.map((step, i) => {
            const Icon = ActionIcon[step.action] || Circle;
            const color = actionColor[step.action] || 'bg-gray-400';
            return (
              <div key={step.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  {i < steps.length - 1 && <div className="w-0.5 flex-1 my-1 bg-gray-200 dark:bg-gray-700 rounded-full" style={{ minHeight: '28px' }} />}
                </div>
                <div className={`pb-4 flex-1 ${i === steps.length - 1 ? 'pb-0' : ''}`}>
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">{actionLabel[step.action] || step.action}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{toJalaliTime(step.created_at)}</p>
                  {step.actor_name && <p className="text-xs text-blue-500 mt-0.5">توسط: {step.actor_name}</p>}
                  {step.from_name && <p className="text-xs text-gray-500 mt-0.5">از: {step.from_name}</p>}
                  {step.to_name && <p className="text-xs text-teal-500 mt-0.5">به: {step.to_name}</p>}
                  {step.note && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-gray-700/50 px-2 py-1 rounded-lg">{step.note}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── TaskEditModal (full edit) ────────────────────────────────────────────────

function TaskEditModal({ task, profiles, onClose, onSaved }: {
  task: TaskRow; profiles: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'pending',
    priority: task.priority || 'medium',
    assignee: task.assignee || '',
    due_date: task.due_date ? toJalali(task.due_date) : '',
    archived: task.archived || false,
    current_assignee_id: task.current_assignee_id || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee,
      archived: form.archived,
      current_assignee_id: form.current_assignee_id || null,
    };
    if (form.due_date) {
      const iso = jalaliToGregorian(form.due_date);
      if (iso) payload.due_date = iso;
    }
    const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
    setSaving(false);
    if (error) { toast.error('خطا در ذخیره'); return; }
    toast.success('اقدام ویرایش شد');
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-bold text-gray-900 dark:text-white">ویرایش اقدام</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">عنوان</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={INP} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">توضیحات</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={INP + ' resize-none'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">وضعیت</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={SEL}>
                <option value="pending">در انتظار</option>
                <option value="in_progress">در حال انجام</option>
                <option value="completed">تکمیل شده</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">اولویت</label>
              <select value={form.priority || 'medium'} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={SEL}>
                <option value="high">بالا</option>
                <option value="medium">متوسط</option>
                <option value="low">پایین</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">نام مسئول</label>
              <input value={form.assignee} onChange={e => setForm(p => ({ ...p, assignee: e.target.value }))} className={INP} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">مسئول (کاربر)</label>
              <select value={form.current_assignee_id} onChange={e => setForm(p => ({ ...p, current_assignee_id: e.target.value }))} className={SEL}>
                <option value="">انتخاب کنید...</option>
                {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">موعد انجام (شمسی)</label>
              <JalaliInput value={form.due_date} onChange={v => setForm(p => ({ ...p, due_date: v }))} placeholder="1403/06/15" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">بایگانی</label>
              <button type="button" onClick={() => setForm(p => ({ ...p, archived: !p.archived }))}
                className={`w-10 h-5 rounded-full relative transition-colors ${form.archived ? 'bg-gray-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.archived ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} ذخیره
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

// ─── ChatFlowModal ────────────────────────────────────────────────────────────

function ChatFlowModal({ conv, profiles, onClose }: {
  conv: ChatConversation; profiles: Profile[]; onClose: () => void;
}) {
  const getProfile = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)) : null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت مکالمه</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{conv.name || 'مکالمه مستقیم'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-0">
          {[
            { label: 'ایجاد مکالمه', date: conv.created_at, actor: getProfile(conv.creator_id), icon: Circle, color: 'bg-blue-500', done: true },
            { label: 'آخرین پیام', date: conv.last_message_at, actor: null, icon: MessageSquare, color: conv.last_message_at ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600', done: !!conv.last_message_at },
          ].map((ev, i) => {
            const Icon = ev.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${ev.done ? ev.color : 'bg-gray-200 dark:bg-gray-700'}`}>
                    <Icon className={`w-4 h-4 ${ev.done ? 'text-white' : 'text-gray-400'}`} />
                  </div>
                  {i < 1 && <div className={`w-0.5 flex-1 my-1 rounded-full ${ev.done ? 'bg-teal-300 dark:bg-teal-700' : 'bg-gray-200 dark:bg-gray-700'}`} style={{ minHeight: '32px' }} />}
                </div>
                <div className="pb-5 flex-1">
                  <p className={`font-semibold text-sm ${ev.done ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{ev.label}</p>
                  {ev.date && <p className="text-xs text-gray-500 mt-0.5">{toJalaliTime(ev.date)}</p>}
                  {ev.actor && <p className="text-xs text-blue-500 mt-0.5">توسط: {ev.actor}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Messages */}
        {conv.messages && conv.messages.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-700 flex-1 overflow-y-auto">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-5 py-2">آخرین پیام‌ها</p>
            <div className="space-y-1 px-5 pb-4">
              {conv.messages.map(msg => (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600 dark:text-blue-400">
                    {(msg.sender_name || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{msg.sender_name || '—'}</span>
                      <span className="text-xs text-gray-400">{toJalaliTime(msg.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-3 space-y-2 flex-shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-1">نوع مکالمه</p>
              <p className="text-sm font-bold text-gray-800 dark:text-white">{conv.type === 'direct' ? 'مستقیم' : conv.type === 'group' ? 'گروهی' : conv.type}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-1">تعداد پیام</p>
              <p className="text-sm font-bold text-gray-800 dark:text-white">{conv.message_count ?? '—'}</p>
            </div>
          </div>
          {conv.participant_ids && conv.participant_ids.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">شرکت‌کنندگان ({conv.participant_ids.length} نفر)</p>
              <div className="flex flex-wrap gap-1.5">
                {conv.participant_ids.map(uid => (
                  <span key={uid} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs">
                    {getProfile(uid) || uid.slice(0, 8)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmDeleteModal ───────────────────────────────────────────────────────

function ConfirmDeleteModal({ onConfirm, onCancel, message }: { onConfirm: () => void; onCancel: () => void; message: string }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <h3 className="font-bold text-gray-900 dark:text-white">تایید حذف</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors">حذف</button>
          <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Meetings Monitor ────────────────────────────────────────────────

function MeetingsMonitor({ profiles }: { profiles: Profile[] }) {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterStatusType, setFilterStatusType] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterShared, setFilterShared] = useState('all');
  const [filterMembersOnly, setFilterMembersOnly] = useState('all');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [flowMeeting, setFlowMeeting] = useState<MeetingRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editMeeting, setEditMeeting] = useState<MeetingRow | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('meetings').select(`
      id, subject, request_date, duration, location, representative, phone,
      notes, priority, status, status_type, created_at, user_id, start_time,
      end_time, guest_emails, members_only, repeat_type,
      participants(id, name), actions(id, title, status, assignee)
    `).order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری جلسات'); setLoading(false); return; }

    const rows: MeetingRow[] = (data || []).map((m: any) => ({
      ...m,
      creator_name: profiles.find(p => p.user_id === m.user_id)?.full_name || null,
    }));

    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      const { data: shared } = await supabase.from('shared_meetings').select('meeting_id').in('meeting_id', ids);
      const cnt: Record<string, number> = {};
      (shared || []).forEach((s: any) => { cnt[s.meeting_id] = (cnt[s.meeting_id] || 0) + 1; });
      rows.forEach(r => { r.shared_count = cnt[r.id] || 0; });
    }
    setMeetings(rows);
    setLoading(false);
  }, [profiles]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteMeeting = async (id: string) => {
    await supabase.from('participants').delete().eq('meeting_id', id);
    await supabase.from('actions').delete().eq('meeting_id', id);
    const { error } = await supabase.from('meetings').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('جلسه حذف شد');
    setDeleteId(null);
    loadMeetings();
  };

  const filtered = meetings.filter(m => {
    if (search && !m.subject?.toLowerCase().includes(search.toLowerCase()) && !m.representative?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    if (filterStatusType !== 'all' && m.status_type !== filterStatusType) return false;
    if (filterPriority !== 'all' && m.priority !== filterPriority) return false;
    if (filterUser !== 'all' && m.user_id !== filterUser) return false;
    if (filterDateFrom) {
      const fromIso = jalaliToGregorian(filterDateFrom);
      if (fromIso && m.created_at && new Date(m.created_at) < new Date(fromIso)) return false;
    }
    if (filterDateTo) {
      const toIso = jalaliToGregorian(filterDateTo);
      if (toIso && m.created_at && new Date(m.created_at) > new Date(toIso)) return false;
    }
    if (filterShared === 'yes' && !(m.shared_count && m.shared_count > 0)) return false;
    if (filterShared === 'no' && (m.shared_count && m.shared_count > 0)) return false;
    if (filterMembersOnly === 'yes' && !m.members_only) return false;
    if (filterMembersOnly === 'no' && m.members_only) return false;
    return true;
  });

  const clearFilters = () => { setSearch(''); setFilterStatus('all'); setFilterStatusType('all'); setFilterPriority('all'); setFilterUser('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterShared('all'); setFilterMembersOnly('all'); };
  const hasFilter = search || filterStatus !== 'all' || filterStatusType !== 'all' || filterPriority !== 'all' || filterUser !== 'all' || filterDateFrom || filterDateTo || filterShared !== 'all' || filterMembersOnly !== 'all';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shadow-sm flex-shrink-0">
          <CalendarDays className="w-9 h-9 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">مدیریت جلسات</h2>
          <p className="text-sm text-gray-500">{filtered.length} جلسه از {meetings.length}</p>
        </div>
        <button onClick={loadMeetings} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
          <RefreshCw className="w-4 h-4" /> بارگذاری
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-blue-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-300">فیلترهای پیشرفته</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو موضوع / نماینده..." className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SEL}>
            <option value="all">همه وضعیت‌ها</option>
            <option value="open">باز</option>
            <option value="closed">بسته</option>
          </select>
          <select value={filterStatusType} onChange={e => setFilterStatusType(e.target.value)} className={SEL}>
            <option value="all">همه نوع‌ها</option>
            <option value="requested">درخواست شده</option>
            <option value="approved">تایید شده</option>
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className={SEL}>
            <option value="all">همه اولویت‌ها</option>
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="all">همه کاربران</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterShared} onChange={e => setFilterShared(e.target.value)} className={SEL}>
            <option value="all">اشتراک: همه</option>
            <option value="yes">به اشتراک گذاشته</option>
            <option value="no">گذاشته نشده</option>
          </select>
          <select value={filterMembersOnly} onChange={e => setFilterMembersOnly(e.target.value)} className={SEL}>
            <option value="all">دسترسی: همه</option>
            <option value="yes">فقط اعضا</option>
            <option value="no">عمومی</option>
          </select>
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">از (شمسی)</span>
              <JalaliInput value={filterDateFrom} onChange={setFilterDateFrom} placeholder="1403/01/01" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">تا (شمسی)</span>
              <JalaliInput value={filterDateTo} onChange={setFilterDateTo} placeholder="1403/12/29" />
            </div>
          </div>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="mt-3 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600">
            <X className="w-3.5 h-3.5" /> پاک کردن فیلترها
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ جلسه‌ای یافت نشد</p></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(m => (
            <div key={m.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="font-bold text-gray-900 dark:text-white text-sm">{m.subject}</h4>
                    {m.priority && <Badge2 label={priorityLabel[m.priority] || m.priority} colorCls={priorityColor[m.priority] || 'bg-gray-100 text-gray-500'} />}
                    {m.status && <Badge2 label={statusLabel[m.status] || m.status} colorCls={statusColor[m.status] || 'bg-gray-100 text-gray-500'} />}
                    {m.status_type && <Badge2 label={statusLabel[m.status_type] || m.status_type} colorCls={statusColor[m.status_type] || 'bg-gray-100 text-gray-500'} />}
                    {(m.shared_count || 0) > 0 && <Badge2 label={`اشتراک ${m.shared_count}`} colorCls="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />}
                    {m.members_only && <Badge2 label="فقط اعضا" colorCls="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" />}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                    <DataField label="شناسه" value={<span className="font-mono text-gray-400 text-xs">{m.id.slice(0, 8)}…</span>} />
                    <DataField label="نماینده" value={m.representative} />
                    <DataField label="ایجادکننده" value={m.creator_name} />
                    <DataField label="تاریخ ایجاد" value={toJalali(m.created_at)} />
                    <DataField label="تاریخ درخواست" value={m.request_date ? toJalali(m.request_date) : '—'} />
                    <DataField label="شروع" value={toJalaliTime(m.start_time)} />
                    <DataField label="پایان" value={toJalaliTime(m.end_time)} />
                    <DataField label="مدت" value={m.duration} />
                    <DataField label="مکان" value={m.location} />
                    <DataField label="تکرار" value={m.repeat_type} />
                    <DataField label="شرکت‌کنندگان" value={`${m.participants?.length || 0} نفر`} />
                    <DataField label="اقدامات" value={`${m.actions?.length || 0} مورد`} />
                  </div>
                  {m.notes && <p className="mt-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-2.5 py-1.5 line-clamp-2">{m.notes}</p>}
                  {m.participants && m.participants.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.participants.slice(0, 5).map(p => <span key={p.id} className="px-2 py-0.5 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-full text-xs">{p.name}</span>)}
                      {m.participants.length > 5 && <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full text-xs">+{m.participants.length - 5}</span>}
                    </div>
                  )}
                </div>
                <div className="relative flex-shrink-0" ref={menuOpen === m.id ? menuRef : undefined}>
                  <button onClick={() => setMenuOpen(menuOpen === m.id ? null : m.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {menuOpen === m.id && (
                    <div className="absolute left-0 top-8 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 min-w-[140px] overflow-hidden">
                      <button onClick={() => { setEditMeeting(m); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <Edit2 className="w-3.5 h-3.5 text-blue-500" /> ویرایش
                      </button>
                      <button onClick={() => { setFlowMeeting(m); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <GitBranch className="w-3.5 h-3.5 text-teal-500" /> فلوچارت
                      </button>
                      <button onClick={() => { setDeleteId(m.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {flowMeeting && <MeetingFlowModal meeting={flowMeeting} profiles={profiles} onClose={() => setFlowMeeting(null)} />}
      {editMeeting && <MeetingEditModal meeting={editMeeting} profiles={profiles} onClose={() => setEditMeeting(null)} onSaved={loadMeetings} />}
      {deleteId && <ConfirmDeleteModal message="آیا از حذف این جلسه و تمام داده‌های آن اطمینان دارید؟ این عملیات برگشت‌پذیر نیست." onConfirm={() => deleteMeeting(deleteId)} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}

// ─── Section: Chat Monitor ─────────────────────────────────────────────────────

function ChatMonitor({ profiles }: { profiles: Profile[] }) {
  const [convs, setConvs] = useState<ChatConversation[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'channels'>('chat');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterHasMessages, setFilterHasMessages] = useState('all');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [flowConv, setFlowConv] = useState<ChatConversation | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [superAdminCode, setSuperAdminCode] = useState('');
  const [superAdminVerified, setSuperAdminVerified] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadConvs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('chat_conversations').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری چت'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (c: any) => {
      const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id);
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, sender_id, body, message_type, created_at')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const lastMsgAt = msgs && msgs.length > 0 ? msgs[0].created_at : null;

      const messages: ChatMessage[] = (msgs || []).reverse().map((msg: any) => ({
        ...msg,
        content: msg.body || msg.content || '',
        message_type: msg.message_type || null,
        sender_name: profiles.find(p => p.user_id === msg.sender_id)?.full_name || null,
      }));

      return {
        ...c,
        creator_name: profiles.find(p => p.user_id === c.creator_id)?.full_name || null,
        message_count: count ?? 0,
        last_message_at: lastMsgAt,
        messages,
      } as ChatConversation;
    }));
    setConvs(rows);
    setLoading(false);
  }, [profiles]);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری کانال‌ها'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (ch: any) => {
      const { count } = await supabase.from('channel_messages').select('id', { count: 'exact', head: true }).eq('channel_id', ch.id);
      const { data: msgs } = await supabase
        .from('channel_messages')
        .select('id, channel_id, sender_id, body, message_type, created_at')
        .eq('channel_id', ch.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const messages: ChannelMsgRow[] = (msgs || []).reverse().map((msg: any) => ({
        ...msg,
        sender_name: profiles.find(p => p.user_id === msg.sender_id)?.full_name || null,
      }));

      return {
        ...ch,
        creator_name: profiles.find(p => p.user_id === ch.created_by)?.full_name || null,
        message_count: count ?? 0,
        messages,
      } as ChannelRow;
    }));
    setChannels(rows);
    setLoading(false);
  }, [profiles]);

  useEffect(() => {
    if (activeTab === 'chat') loadConvs();
    else loadChannels();
  }, [activeTab, loadConvs, loadChannels]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteConv = async (id: string) => {
    await supabase.from('chat_messages').delete().eq('conversation_id', id);
    const { error } = await supabase.from('chat_conversations').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('مکالمه حذف شد');
    setDeleteId(null);
    loadConvs();
  };

  const filtered = convs.filter(c => {
    if (search && !c.name?.toLowerCase().includes(search.toLowerCase()) && !c.creator_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== 'all' && c.type !== filterType) return false;
    if (filterUser !== 'all' && c.creator_id !== filterUser && !(c.participant_ids || []).includes(filterUser)) return false;
    if (filterDateFrom) {
      const fromIso = jalaliToGregorian(filterDateFrom);
      if (fromIso && c.created_at && new Date(c.created_at) < new Date(fromIso)) return false;
    }
    if (filterDateTo) {
      const toIso = jalaliToGregorian(filterDateTo);
      if (toIso && c.created_at && new Date(c.created_at) > new Date(toIso)) return false;
    }
    if (filterHasMessages === 'yes' && (c.message_count ?? 0) === 0) return false;
    if (filterHasMessages === 'no' && (c.message_count ?? 0) > 0) return false;
    return true;
  });

  const clearFilters = () => { setSearch(''); setFilterType('all'); setFilterUser('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterHasMessages('all'); };
  const hasFilter = search || filterType !== 'all' || filterUser !== 'all' || filterDateFrom || filterDateTo || filterHasMessages !== 'all';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shadow-sm flex-shrink-0">
          <MessageSquare className="w-9 h-9 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">مدیریت چت سازمانی</h2>
          <p className="text-sm text-gray-500">
            {activeTab === 'chat' ? `${filtered.length} مکالمه از ${convs.length}` : `${channels.filter(ch => !search || ch.name?.toLowerCase().includes(search.toLowerCase())).length} کانال از ${channels.length}`}
          </p>
        </div>
        <button onClick={() => activeTab === 'chat' ? loadConvs() : loadChannels()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
          <RefreshCw className="w-4 h-4" /> بارگذاری
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('chat')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'chat' ? 'bg-teal-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <MessageSquare className="w-4 h-4" /> چت مستقیم / گروهی
        </button>
        <button onClick={() => setActiveTab('channels')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'channels' ? 'bg-teal-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <ChannelIcon className="w-4 h-4" /> کانال‌ها
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-teal-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-300">فیلترهای پیشرفته</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو نام / ایجادکننده..." className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={SEL}>
            <option value="all">همه انواع</option>
            <option value="direct">مستقیم</option>
            <option value="group">گروهی</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="all">همه کاربران</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterHasMessages} onChange={e => setFilterHasMessages(e.target.value)} className={SEL}>
            <option value="all">همه مکالمات</option>
            <option value="yes">دارای پیام</option>
            <option value="no">بدون پیام</option>
          </select>
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">از (شمسی)</span>
              <JalaliInput value={filterDateFrom} onChange={setFilterDateFrom} placeholder="1403/01/01" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">تا (شمسی)</span>
              <JalaliInput value={filterDateTo} onChange={setFilterDateTo} placeholder="1403/12/29" />
            </div>
          </div>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="mt-3 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600">
            <X className="w-3.5 h-3.5" /> پاک کردن فیلترها
          </button>
        )}
      </div>

      {/* Superadmin code for confidential messages */}
      <div className="flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl px-4 py-3">
        <Lock className="w-4 h-4 text-orange-500 flex-shrink-0" />
        <span className="text-xs text-orange-700 dark:text-orange-300 flex-1">پیام‌های محرمانه نیاز به کد سوپرادمین دارند</span>
        {superAdminVerified ? (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
            <Eye className="w-3.5 h-3.5" />دسترسی فعال است
          </span>
        ) : showCodeInput ? (
          <div className="flex items-center gap-2">
            <input type="password" value={superAdminCode} onChange={e => setSuperAdminCode(e.target.value)}
              placeholder="کد سوپرادمین" className="px-3 py-1.5 text-sm border border-orange-300 dark:border-orange-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white w-36 focus:outline-none focus:ring-2 focus:ring-orange-500" dir="ltr" />
            <button onClick={() => {
              if (superAdminCode === SUPERADMIN_CODE) { setSuperAdminVerified(true); toast.success('دسترسی محرمانه فعال شد'); }
              else { toast.error('کد اشتباه است'); setSuperAdminCode(''); }
              setShowCodeInput(false);
            }} className="px-3 py-1.5 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600">تایید</button>
          </div>
        ) : (
          <button onClick={() => setShowCodeInput(true)} className="px-3 py-1.5 bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-300 text-xs rounded-lg hover:bg-orange-200 dark:hover:bg-orange-700">وارد کردن کد</button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : activeTab === 'chat' ? (
        filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ مکالمه‌ای یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => (
              <div key={c.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">{c.name || 'مکالمه مستقیم'}</h4>
                      <Badge2 label={c.type === 'direct' ? 'مستقیم' : c.type === 'group' ? 'گروهی' : c.type} colorCls={c.type === 'direct' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'} />
                      <Badge2 label={`${c.message_count ?? 0} پیام`} colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                      <DataField label="ایجادکننده" value={c.creator_name} />
                      <DataField label="تاریخ ایجاد" value={toJalali(c.created_at)} />
                      <DataField label="آخرین پیام" value={toJalaliTime(c.last_message_at)} />
                      <DataField label="شرکت‌کنندگان" value={`${(c.participant_ids || []).length} نفر`} />
                    </div>
                    {c.participant_ids && c.participant_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.participant_ids.slice(0, 5).map(uid => (
                          <span key={uid} className="px-2 py-0.5 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-full text-xs">
                            {profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)}
                          </span>
                        ))}
                        {c.participant_ids.length > 5 && <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full text-xs">+{c.participant_ids.length - 5}</span>}
                      </div>
                    )}
                    {c.messages && c.messages.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                        <p className="text-xs text-gray-400 font-medium">آخرین پیام‌ها:</p>
                        {c.messages.map((msg: any) => (
                          <div key={msg.id} className="flex items-start gap-2">
                            <div className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-xs font-bold text-teal-600 dark:text-teal-400 flex-shrink-0">{(msg.sender_name || '?')[0]}</div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 ml-1">{msg.sender_name || '—'}</span>
                              <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">{toJalaliTime(msg.created_at)}</span>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{maskConfidential(msg.content || msg.body || '', msg.message_type, superAdminVerified)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative flex-shrink-0" ref={menuOpen === c.id ? menuRef : undefined}>
                    <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpen === c.id && (
                      <div className="absolute left-0 top-8 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 min-w-[140px] overflow-hidden">
                        <button onClick={() => { setFlowConv(c); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <GitBranch className="w-3.5 h-3.5 text-teal-500" /> فلوچارت
                        </button>
                        <button onClick={() => { setDeleteId(c.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Channels tab */
        channels.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><ChannelIcon className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ کانالی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {channels.filter(ch => !search || ch.name?.toLowerCase().includes(search.toLowerCase())).map(ch => (
              <div key={ch.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm">{ch.name || '—'}</h4>
                  <Badge2 label={ch.is_private ? 'خصوصی' : 'عمومی'} colorCls={ch.is_private ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'} />
                  <Badge2 label={`${ch.message_count ?? 0} پیام`} colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" />
                  <Badge2 label={`${ch.member_count ?? 0} عضو`} colorCls="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-2">
                  <DataField label="ایجادکننده" value={ch.creator_name} />
                  <DataField label="تاریخ ایجاد" value={toJalali(ch.created_at)} />
                  <DataField label="آخرین پیام" value={toJalaliTime(ch.last_message_at)} />
                </div>
                {ch.messages && ch.messages.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                    <p className="text-xs text-gray-400 font-medium">آخرین پیام‌ها:</p>
                    {ch.messages.map(msg => (
                      <div key={msg.id} className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">{(msg.sender_name || '?')[0]}</div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 ml-1">{msg.sender_name || '—'}</span>
                          <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">{toJalaliTime(msg.created_at)}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{maskConfidential(msg.body || '', msg.message_type, superAdminVerified)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {flowConv && <ChatFlowModal conv={flowConv} profiles={profiles} onClose={() => setFlowConv(null)} />}
      {deleteId && <ConfirmDeleteModal message="آیا از حذف این مکالمه و تمام پیام‌های آن اطمینان دارید؟" onConfirm={() => deleteConv(deleteId)} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}

// ─── Section: Tasks Monitor ───────────────────────────────────────────────────

function TasksMonitor({ profiles }: { profiles: Profile[] }) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [groupTasks, setGroupTasks] = useState<GroupTaskRow[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'group'>('tasks');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterArchived, setFilterArchived] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterHasSource, setFilterHasSource] = useState('all');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [flowTask, setFlowTask] = useState<TaskRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری اقدامات'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (t: any) => {
      const { data: wf } = await supabase.from('task_workflow').select('*').eq('task_id', t.id).order('created_at');
      const steps: TaskWorkflowStep[] = (wf || []).map((s: any) => ({
        ...s,
        actor_name: profiles.find(p => p.user_id === s.actor_id)?.full_name || null,
        from_name: profiles.find(p => p.user_id === s.from_user_id)?.full_name || null,
        to_name: profiles.find(p => p.user_id === s.to_user_id)?.full_name || null,
      }));
      return {
        ...t,
        creator_name: profiles.find(p => p.user_id === t.created_by_id)?.full_name || profiles.find(p => p.user_id === t.user_id)?.full_name || null,
        assignee_name: profiles.find(p => p.user_id === t.current_assignee_id)?.full_name || null,
        workflow: steps,
      } as TaskRow;
    }));
    setTasks(rows);
    setLoading(false);
  }, [profiles]);

  const loadGroupTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('channel_group_tasks').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری اقدامات گروهی'); setLoading(false); return; }
    const rows = await Promise.all((data || []).map(async (t: any) => {
      const { data: ch } = await supabase.from('channels').select('name').eq('id', t.channel_id).maybeSingle();
      return {
        ...t,
        channel_name: ch?.name || null,
        creator_name: profiles.find(p => p.user_id === t.created_by)?.full_name || null,
      } as GroupTaskRow;
    }));
    setGroupTasks(rows);
    setLoading(false);
  }, [profiles]);

  useEffect(() => {
    if (activeTab === 'tasks') loadTasks();
    else loadGroupTasks();
  }, [activeTab, loadTasks, loadGroupTasks]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteTask = async (id: string) => {
    await supabase.from('task_workflow').delete().eq('task_id', id);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('اقدام حذف شد');
    setDeleteId(null);
    loadTasks();
  };

  const filtered = tasks.filter(t => {
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) && !t.assignee?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterUser !== 'all' && t.user_id !== filterUser && t.created_by_id !== filterUser) return false;
    if (filterAssignee !== 'all' && t.current_assignee_id !== filterAssignee) return false;
    if (filterArchived === 'yes' && !t.archived) return false;
    if (filterArchived === 'no' && t.archived) return false;
    if (filterDateFrom) {
      const fromIso = jalaliToGregorian(filterDateFrom);
      if (fromIso && t.created_at && new Date(t.created_at) < new Date(fromIso)) return false;
    }
    if (filterDateTo) {
      const toIso = jalaliToGregorian(filterDateTo);
      if (toIso && t.created_at && new Date(t.created_at) > new Date(toIso)) return false;
    }
    if (filterHasSource === 'yes' && !t.source_message_id) return false;
    if (filterHasSource === 'no' && t.source_message_id) return false;
    return true;
  });

  const clearFilters = () => { setSearch(''); setFilterStatus('all'); setFilterPriority('all'); setFilterUser('all'); setFilterAssignee('all'); setFilterArchived('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterHasSource('all'); };
  const hasFilter = search || filterStatus !== 'all' || filterPriority !== 'all' || filterUser !== 'all' || filterAssignee !== 'all' || filterArchived !== 'all' || filterDateFrom || filterDateTo || filterHasSource !== 'all';

  const filteredGroupTasks = groupTasks.filter(t =>
    !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.channel_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shadow-sm flex-shrink-0">
          <CheckSquare className="w-9 h-9 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">مدیریت اقدامات</h2>
          <p className="text-sm text-gray-500">
            {activeTab === 'tasks' ? `${filtered.length} اقدام از ${tasks.length}` : `${filteredGroupTasks.length} اقدام گروهی از ${groupTasks.length}`}
          </p>
        </div>
        <button onClick={() => activeTab === 'tasks' ? loadTasks() : loadGroupTasks()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
          <RefreshCw className="w-4 h-4" /> بارگذاری
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('tasks')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'tasks' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <CheckSquare className="w-4 h-4" /> اقدامات
        </button>
        <button onClick={() => setActiveTab('group')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'group' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <Users className="w-4 h-4" /> اقدامات گروهی
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-amber-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-300">فیلترهای پیشرفته</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو عنوان / مسئول..." className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SEL}>
            <option value="all">همه وضعیت‌ها</option>
            <option value="pending">در انتظار</option>
            <option value="in_progress">در حال انجام</option>
            <option value="completed">تکمیل شده</option>
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className={SEL}>
            <option value="all">همه اولویت‌ها</option>
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="all">همه ایجادکنندگان</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className={SEL}>
            <option value="all">همه مسئولان</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterArchived} onChange={e => setFilterArchived(e.target.value)} className={SEL}>
            <option value="all">همه (فعال + بایگانی)</option>
            <option value="no">فقط فعال</option>
            <option value="yes">فقط بایگانی</option>
          </select>
          <select value={filterHasSource} onChange={e => setFilterHasSource(e.target.value)} className={SEL}>
            <option value="all">منشأ: همه</option>
            <option value="yes">از پیام چت</option>
            <option value="no">مستقل</option>
          </select>
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">از (شمسی)</span>
              <JalaliInput value={filterDateFrom} onChange={setFilterDateFrom} placeholder="1403/01/01" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">تا (شمسی)</span>
              <JalaliInput value={filterDateTo} onChange={setFilterDateTo} placeholder="1403/12/29" />
            </div>
          </div>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="mt-3 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600">
            <X className="w-3.5 h-3.5" /> پاک کردن فیلترها
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : activeTab === 'tasks' ? (
        filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ اقدامی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filtered.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">{t.title}</h4>
                      {t.priority && <Badge2 label={priorityLabel[t.priority] || t.priority} colorCls={priorityColor[t.priority] || 'bg-gray-100 text-gray-500'} />}
                      {t.status && <Badge2 label={statusLabel[t.status] || t.status} colorCls={statusColor[t.status] || 'bg-gray-100 text-gray-500'} />}
                      {t.archived && <Badge2 label="بایگانی" colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500" />}
                      {t.source_message_id && <Badge2 label="از چت" colorCls="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400" />}
                      {t.workflow && t.workflow.length > 0 && <Badge2 label={`${t.workflow.length} مرحله`} colorCls="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" />}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                      <DataField label="شناسه" value={<span className="font-mono text-gray-400 text-xs">{t.id.slice(0, 8)}…</span>} />
                      <DataField label="ایجادکننده" value={t.creator_name} />
                      <DataField label="مسئول فعلی" value={t.assignee_name || t.assignee} />
                      <DataField label="تاریخ ایجاد" value={toJalali(t.created_at)} />
                      <DataField label="موعد انجام" value={toJalali(t.due_date)} />
                      <DataField label="مراحل جریان" value={`${t.workflow?.length || 0} مرحله`} />
                    </div>
                    {t.description && <p className="mt-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-2.5 py-1.5 line-clamp-2">{t.description}</p>}
                  </div>
                  <div className="relative flex-shrink-0" ref={menuOpen === t.id ? menuRef : undefined}>
                    <button onClick={() => setMenuOpen(menuOpen === t.id ? null : t.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpen === t.id && (
                      <div className="absolute left-0 top-8 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 min-w-[140px] overflow-hidden">
                        <button onClick={() => { setEditTask(t); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <Edit2 className="w-3.5 h-3.5 text-blue-500" /> ویرایش
                        </button>
                        <button onClick={() => { setFlowTask(t); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <GitBranch className="w-3.5 h-3.5 text-amber-500" /> فلوچارت
                        </button>
                        <button onClick={() => { setDeleteId(t.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Group tasks tab */
        filteredGroupTasks.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><Users className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ اقدام گروهی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filteredGroupTasks.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm">{t.title}</h4>
                  <Badge2 label="گروهی" colorCls="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" />
                  {t.status && <Badge2 label={statusLabel[t.status] || t.status} colorCls={statusColor[t.status] || 'bg-gray-100 text-gray-500'} />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                  <DataField label="کانال" value={t.channel_name} />
                  <DataField label="ایجادکننده" value={t.creator_name} />
                  <DataField label="تاریخ ایجاد" value={toJalali(t.created_at)} />
                  <DataField label="آخرین بروزرسانی" value={toJalali(t.updated_at)} />
                </div>
                {t.body && <p className="mt-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-2.5 py-1.5 line-clamp-2">{t.body}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {flowTask && <TaskFlowModal task={flowTask} onClose={() => setFlowTask(null)} />}
      {editTask && <TaskEditModal task={editTask} profiles={profiles} onClose={() => setEditTask(null)} onSaved={loadTasks} />}
      {deleteId && <ConfirmDeleteModal message="آیا از حذف این اقدام اطمینان دارید؟" onConfirm={() => deleteTask(deleteId)} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Section = 'meetings' | 'chat' | 'tasks';

const TABS: { key: Section; label: string; icon: React.ElementType; color: string; desc: string }[] = [
  { key: 'meetings', label: 'مدیریت جلسات', icon: CalendarDays, color: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30', desc: 'مشاهده و مدیریت تمام جلسات سیستم' },
  { key: 'chat', label: 'مدیریت چت', icon: MessageSquare, color: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/30', desc: 'مانیتورینگ مکالمات سازمانی' },
  { key: 'tasks', label: 'مدیریت اقدامات', icon: CheckSquare, color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30', desc: 'مشاهده و مدیریت تمام اقدامات' },
];

export function SystemMonitoringPage() {
  const [section, setSection] = useState<Section>('meetings');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name, email').then(({ data }) => {
      setProfiles(data || []);
      setProfilesLoaded(true);
    });
  }, []);

  if (!profilesLoaded) return (
    <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
  );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = section === tab.key;
          const borderColor = active ? (tab.key === 'meetings' ? '#3b82f6' : tab.key === 'chat' ? '#14b8a6' : '#f59e0b') : undefined;
          return (
            <button key={tab.key} onClick={() => setSection(tab.key)}
              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-right ${active ? 'bg-white dark:bg-gray-800 shadow-md' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-sm'}`}
              style={active ? { borderColor } : {}}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${tab.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 dark:text-white text-sm">{tab.label}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{tab.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      {section === 'meetings' && <MeetingsMonitor profiles={profiles} />}
      {section === 'chat' && <ChatMonitor profiles={profiles} />}
      {section === 'tasks' && <TasksMonitor profiles={profiles} />}
    </div>
  );
}
