import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Loader as Loader2, CreditCard as Edit2, Save, X, Archive, GitFork, User, ChevronDown, Calendar, ArrowLeft, CircleCheck as CheckCircle, MessageSquare, ClipboardList, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { Task, TaskWorkflowStep } from '../types';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import moment from 'moment-jalaali';
import { usePermissions } from '../context/PermissionsContext';
import { insertNotification } from '../lib/notifications';
import { useOrgUsers, OrgUserProfile } from '../lib/useOrgUsers';

// Configure moment-jalaali locale
moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

interface TasksPageProps {
  prefillDescription?: string;
  prefillSourceMessageId?: string;
  onPrefillConsumed?: () => void;
  currentUserId?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const toJalali = (iso: string) => moment(iso).format('jYYYY/jMM/jDD HH:mm');

// Send in-app notification to a user (skips if recipient is actor)
async function sendTaskNotification(
  recipientId: string,
  actorId: string,
  title: string,
  message: string,
  senderName?: string,
  senderAvatarUrl?: string,
  taskTitle?: string,
) {
  if (!recipientId) return;
  try {
    await insertNotification({
      userId: recipientId,
      category: 'task',
      eventType: 'assign',
      fallbackTitle: title,
      fallbackMessage: message,
      placeholders: { task_title: taskTitle || title, sender_name: senderName || '' },
      senderId: actorId || null,
      senderName: senderName || null,
      senderAvatarUrl: senderAvatarUrl || null,
      actionUrl: 'tasks',
    });
  } catch { /* non-critical — silently ignore */ }
}

// Collect unique recipient IDs: creator + current assignee, minus actor
function getTaskRecipients(task: Task): string[] {
  const ids = new Set<string>();
  if (task.created_by_id) ids.add(task.created_by_id);
  if (task.current_assignee_id) ids.add(task.current_assignee_id);
  return Array.from(ids);
}

// ── Jalali Calendar Picker ───────────────────────────────────────────────────
const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function JalaliCalendarPicker({ value, onChange, onClose }: {
  value: Date | null;
  onChange: (d: Date) => void;
  onClose: () => void;
}) {
  const now = value ? moment(value) : moment();
  const [viewYear, setViewYear] = useState(Number(now.format('jYYYY')));
  const [viewMonth, setViewMonth] = useState(Number(now.format('jMM')) - 1); // 0-indexed
  const [hour, setHour] = useState(value ? value.getHours() : 0);
  const [minute, setMinute] = useState(value ? Math.floor(value.getMinutes() / 15) * 15 : 0);

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  // days in current jalali month
  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;
  // first weekday of month (0=Sat)
  const firstDay = moment(`${viewYear}/${viewMonth + 1}/01`, 'jYYYY/jMM/jDD').day(); // 0=Sun
  // convert Sun=0 to Sat=0 offset
  const offset = (firstDay + 1) % 7;

  const selectedJY = value ? Number(moment(value).format('jYYYY')) : null;
  const selectedJM = value ? Number(moment(value).format('jMM')) - 1 : null;
  const selectedJD = value ? Number(moment(value).format('jDD')) : null;

  const handleDayClick = (day: number) => {
    const m = moment(`${viewYear}/${viewMonth + 1}/${day} ${hour}:${minute}`, 'jYYYY/jMM/jDD HH:mm');
    onChange(m.toDate());
  };

  const handleConfirm = () => {
    if (value) {
      const m = moment(value);
      const updated = moment(`${Number(m.format('jYYYY'))}/${Number(m.format('jMM'))}/${Number(m.format('jDD'))} ${hour}:${minute}`, 'jYYYY/jMM/jDD HH:mm');
      onChange(updated.toDate());
    }
    onClose();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 p-4 w-72" dir="rtl">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm dark:text-white">{JALALI_MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 py-1 font-medium">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const isSelected = selectedJY === viewYear && selectedJM === viewMonth && selectedJD === day;
          const isToday = Number(moment().format('jYYYY')) === viewYear &&
            Number(moment().format('jMM')) - 1 === viewMonth &&
            Number(moment().format('jDD')) === day;
          return (
            <button key={day} onClick={() => handleDayClick(day)}
              className={`h-8 w-full rounded-lg text-sm transition-colors
                ${isSelected ? 'bg-teal-500 text-white font-bold' :
                  isToday ? 'border border-teal-400 text-teal-600 dark:text-teal-400' :
                  'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              {day}
            </button>
          );
        })}
      </div>

      {/* Time picker */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 justify-center">
        <span className="text-xs text-gray-500 dark:text-gray-400">ساعت:</span>
        <select value={hour} onChange={e => setHour(Number(e.target.value))}
          className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 dark:bg-gray-700 dark:text-white">
          {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
        </select>
        <span className="text-gray-400">:</span>
        <select value={minute} onChange={e => setMinute(Number(e.target.value))}
          className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 dark:bg-gray-700 dark:text-white">
          {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
      </div>

      <button onClick={handleConfirm}
        className="mt-3 w-full bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-xl text-sm font-medium transition-colors">
        تایید
      </button>
    </div>
  );
}

function JalaliDateInput({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input readOnly value={value ? toJalali(value.toISOString()) : ''}
          onClick={() => setOpen(v => !v)}
          placeholder="انتخاب تاریخ و ساعت"
          className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm cursor-pointer"
          dir="ltr" />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0">
          <JalaliCalendarPicker
            value={value}
            onChange={(d) => { onChange(d); }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── User selector dropdown ───────────────────────────────────────────────────
function UserSelector({ users, groups, value, onChange, placeholder }: {
  users: UserProfile[];
  groups?: { label: string; users: OrgUserProfile[] }[];
  value: string;
  onChange: (userId: string, displayName: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allUsers: (UserProfile | OrgUserProfile)[] = groups
    ? groups.flatMap(g => g.users)
    : users;

  const selected = allUsers.find(u => u.user_id === value);
  const isSearching = search.trim().length > 0;

  const filteredFlat = allUsers.filter(u =>
    (u.full_name || u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? (selected.full_name || selected.email) : (placeholder || 'انتخاب کاربر')}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input type="text" autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="جستجو..." className="w-full p-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {isSearching || !groups ? (
              // لیست مسطح در حالت جستجو یا بدون گروه‌بندی
              filteredFlat.length === 0
                ? <p className="px-3 py-3 text-gray-400 text-sm text-center">نتیجه‌ای یافت نشد</p>
                : filteredFlat.map(u => (
                  <button key={u.user_id} type="button"
                    onClick={() => { onChange(u.user_id, u.full_name || u.email || ''); setOpen(false); setSearch(''); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                    <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(u.full_name || u.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="text-right">
                      <p className="text-gray-800 dark:text-gray-100 font-medium">{u.full_name || '—'}</p>
                      <p className="text-gray-400 text-xs">{u.email}</p>
                    </div>
                  </button>
                ))
            ) : (
              // گروه‌بندی بر اساس واحد سازمانی
              groups.map(group => {
                if (group.users.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="px-3 py-1.5 flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/60 sticky top-0 z-10">
                      <Building2 className="w-3 h-3 text-teal-500 flex-shrink-0" />
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide truncate">{group.label}</span>
                    </div>
                    {group.users.map(u => (
                      <button key={u.user_id} type="button"
                        onClick={() => { onChange(u.user_id, u.full_name || u.email || ''); setOpen(false); setSearch(''); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                        <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {(u.full_name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="text-right min-w-0">
                          <p className="text-gray-800 dark:text-gray-100 font-medium truncate">{u.full_name || '—'}</p>
                          <p className="text-gray-400 text-xs truncate">{u.position_title || u.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add note modal ────────────────────────────────────────────────────────────
function AddNoteModal({ task, userId, actorName, actorAvatarUrl, onClose, onSaved }: {
  task: Task;
  userId: string;
  actorName: string;
  actorAvatarUrl?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!note.trim()) { toast.error('یادداشت نمی‌تواند خالی باشد'); return; }
    setSaving(true);
    try {
      await supabase.from('task_workflow_steps').insert({
        task_id: task.id,
        actor_id: userId,
        action: 'note_added',
        note: note.trim(),
      });

      // Notify creator & current assignee
      const recipients = getTaskRecipients(task, userId);
      await Promise.all(recipients.map(rid =>
        sendTaskNotification(rid, userId,
          `اقدام جدید روی: ${task.title}`,
          `${actorName} اقدام ثبت کرد: ${note.trim().slice(0, 100)}${note.length > 100 ? '…' : ''}`,
          actorName, actorAvatarUrl, task.title
        )
      ));

      toast.success('اقدام ثبت شد');
      logAudit({ module: 'tasks', action: 'task_action_added', entity_name: task.title, entity_id: task.id, details: `اقدام ثبت شد: ${note.trim().slice(0, 80)}`, severity: 'info' });
      onSaved();
      onClose();
    } catch { toast.error('خطا در ثبت'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-500" /> ثبت اقدام
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">اقدام انجام شده روی <span className="font-medium text-gray-800 dark:text-white">{task.title}</span> را توضیح دهید:</p>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            rows={4} autoFocus placeholder="توضیح اقدام انجام شده..."
            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm resize-none" />
          <button onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            ثبت اقدام
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Workflow flowchart modal ──────────────────────────────────────────────────
function WorkflowModal({ task, steps, users, onClose }: {
  task: Task;
  steps: TaskWorkflowStep[];
  users: UserProfile[];
  onClose: () => void;
}) {
  const getName = (id?: string | null) => {
    if (!id) return '—';
    const u = users.find(u => u.user_id === id);
    return u?.full_name || u?.email;
  };

  const actionMeta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    created: { label: 'ایجاد شد', color: 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-300', icon: <ClipboardList className="w-4 h-4" /> },
    referred: { label: 'ارجاع داده شد', color: 'bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900/30 dark:border-amber-500 dark:text-amber-300', icon: <ArrowLeft className="w-4 h-4" /> },
    accepted: { label: 'شروع شد', color: 'bg-teal-100 border-teal-400 text-teal-700 dark:bg-teal-900/30 dark:border-teal-500 dark:text-teal-300', icon: <CheckCircle className="w-4 h-4" /> },
    completed: { label: 'تکمیل شد', color: 'bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300', icon: <CheckCircle className="w-4 h-4" /> },
    rejected: { label: 'رد شد', color: 'bg-red-100 border-red-400 text-red-700 dark:bg-red-900/30 dark:border-red-500 dark:text-red-300', icon: <X className="w-4 h-4" /> },
    note_added: { label: 'اقدام ثبت شد', color: 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-gray-300', icon: <MessageSquare className="w-4 h-4" /> },
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">
              <GitFork className="w-5 h-5 text-teal-500" /> مسیر اقدام
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{task.title}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {steps.length === 0 ? (
            <p className="text-center text-gray-400 py-8">هیچ مرحله‌ای ثبت نشده است</p>
          ) : (
            <div className="relative">
              <div className="absolute right-5 top-5 bottom-5 w-0.5 bg-gray-200 dark:bg-gray-700" />
              <div className="space-y-5">
                {steps.map(step => {
                  const meta = actionMeta[step.action] || actionMeta.note_added;
                  const iconBg = meta.color.split(' ')[0];
                  const iconBorder = meta.color.split(' ')[1];
                  return (
                    <div key={step.id} className="flex gap-4 relative">
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 relative z-10 ${iconBg} ${iconBorder}`}>
                        {meta.icon}
                      </div>
                      <div className={`flex-1 rounded-xl border p-3 ${meta.color}`}>
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="font-semibold text-sm">{meta.label}</span>
                          {/* ✅ Correct Jalali date using moment-jalaali */}
                          <span className="text-xs opacity-70" dir="ltr">{moment(step.created_at).format('jYYYY/jMM/jDD HH:mm')}</span>
                        </div>
                        <p className="text-sm mt-1">
                          <span className="opacity-70">توسط: </span>
                          <span className="font-medium">{getName(step.actor_id)}</span>
                          {step.to_user_id && (
                            <>
                              <span className="opacity-70"> ← ارجاع به: </span>
                              <span className="font-medium">{getName(step.to_user_id)}</span>
                            </>
                          )}
                        </p>
                        {step.note && <p className="text-xs mt-1.5 opacity-80 bg-white/50 dark:bg-black/20 rounded-lg p-2">{step.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Refer modal ───────────────────────────────────────────────────────────────
function ReferModal({ task, users, groups, currentUserId, actorName, actorAvatarUrl, onClose, onReferred }: {
  task: Task;
  users: UserProfile[];
  groups: { label: string; users: OrgUserProfile[] }[];
  currentUserId: string;
  actorName: string;
  actorAvatarUrl?: string | null;
  onClose: () => void;
  onReferred: () => void;
}) {
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRefer = async () => {
    if (!toUserId) { toast.error('لطفاً کاربر مقصد را انتخاب کنید'); return; }
    setSaving(true);
    try {
      const toUser = users.find(u => u.user_id === toUserId);
      const toUserName = toUser?.full_name || toUser?.email || '';

      await supabase.from('tasks').update({
        assignee: toUserName || toUserId,
        current_assignee_id: toUserId,
        status: 'pending',
      }).eq('id', task.id);

      await supabase.from('task_workflow_steps').insert({
        task_id: task.id,
        actor_id: currentUserId,
        action: 'referred',
        from_user_id: currentUserId,
        to_user_id: toUserId,
        note,
      });

      // Notify new assignee
      await sendTaskNotification(
        toUserId, currentUserId,
        `اقدام به شما ارجاع داده شد: ${task.title}`,
        `${actorName} این اقدام را به شما ارجاع داد${note ? ` — ${note.slice(0, 80)}` : ''}`,
        actorName, actorAvatarUrl,
      );

      // Notify creator (if different from actor and new assignee)
      if (task.created_by_id && task.created_by_id !== currentUserId && task.created_by_id !== toUserId) {
        await sendTaskNotification(
          task.created_by_id, currentUserId,
          `ارجاع اقدام: ${task.title}`,
          `${actorName} اقدام را به ${toUserName} ارجاع داد`,
          actorName, actorAvatarUrl,
        );
      }

      toast.success('اقدام ارجاع داده شد');
      onReferred();
      onClose();
    } catch { toast.error('خطا در ارجاع اقدام'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2"><ArrowLeft className="w-4 h-4 text-amber-500" /> ارجاع اقدام</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ارجاع به</label>
			<UserSelector users={users} groups={groups} value={toUserId} onChange={(id) => setToUserId(id)} placeholder="انتخاب کاربر مقصد" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیح ارجاع (اختیاری)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
          </div>
          <button onClick={handleRefer} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4" />}
            ارجاع
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main TasksPage ─────────────────────────────────────────────────────────────
export function TasksPage({ prefillDescription, prefillSourceMessageId, onPrefillConsumed, currentUserId: propUserId }: TasksPageProps) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('tasks_create');
  const canEdit = hasPermission('tasks_edit');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'archived'>('all');
  const [taskTab, setTaskTab] = useState<'assigned_to_me' | 'created_by_me' | 'all'>('assigned_to_me');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const { groups: orgGroups, allUsers: finalAllUsers } = useOrgUsers(userId);
  const userSelectorGroups = orgGroups.map(g => ({label: g.unit_name,users: g.users,}));

  // Modals
  const [workflowTask, setWorkflowTask] = useState<Task | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<TaskWorkflowStep[]>([]);
  const [referTask, setReferTask] = useState<Task | null>(null);
  const [addNoteTask, setAddNoteTask] = useState<Task | null>(null);

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: prefillDescription || '',
    priority: 'medium' as Task['priority'],
    // "اقدام کننده" = who must do the action
    assigneeId: '',
    assigneeName: '',
  });
  const [newDueDate, setNewDueDate] = useState<Date | null>(null);

  // Edit form
  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [editAssigneeId, setEditAssigneeId] = useState('');

  useEffect(() => {
    if (!propUserId) {
      // Fallback: fetch from auth if prop wasn't provided
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
    fetchUsers();
    fetchTasks();

    const channel = supabase
      .channel(`tasks-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchTasks())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Auto-open create form with prefill
  useEffect(() => {
    if (prefillDescription) {
      setNewTask(t => ({ ...t, description: prefillDescription }));
      // Auto-fill due date with current date+time
      setNewDueDate(new Date());
      setShowCreateForm(true);
      onPrefillConsumed?.();
    }
  }, [prefillDescription]);

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name, email, avatar_url').not('is_hidden', 'eq', true);
    if (data) setUsers(data);
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setTasks(data || []);
    } catch { toast.error('خطا در دریافت اقدامات'); }
    finally { setLoading(false); }
  };

  const fetchWorkflow = async (taskId: string) => {
    const { data } = await supabase
      .from('task_workflow_steps').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
    setWorkflowSteps((data || []) as TaskWorkflowStep[]);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('لطفاً ابتدا وارد شوید'); return; }
    if (!newDueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    if (!newTask.assigneeId) { toast.error('اقدام کننده را انتخاب کنید'); return; }
    if (!newTask.title.trim()) { toast.error('عنوان را وارد کنید'); return; }

    setLoading(true);
    try {
      const creatorProfile = users.find(u => u.user_id === userId);

      const { data: inserted, error } = await supabase
        .from('tasks')
        .insert([{
          title: newTask.title,
          description: newTask.description,
          priority: newTask.priority,
          // assignee = اقدام کننده (person who must act)
          assignee: newTask.assigneeName,
          current_assignee_id: newTask.assigneeId,
          due_date: newDueDate.toISOString(),
          status: 'pending',
          archived: false,
          user_id: userId,
          created_by_id: userId,
          source_message_id: prefillSourceMessageId || null,
          source_message_body: prefillDescription || null,
        }])
        .select()
        .single();

      if (error) throw error;

      if (inserted) {
        const creatorName = creatorProfile?.full_name || creatorProfile?.email || 'کاربر';
        await supabase.from('task_workflow_steps').insert({
          task_id: inserted.id,
          actor_id: userId,
          action: 'created',
          to_user_id: newTask.assigneeId,
          note: prefillDescription
            ? `ایجاد شده از پیام چت — ایجادکننده: ${creatorName}`
            : `ایجادکننده: ${creatorName}`,
        });

        // Notify the assignee (if different from creator)
        await sendTaskNotification(
          newTask.assigneeId, userId,
          `اقدام جدید برای شما: ${newTask.title}`,
          `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(newDueDate!.toISOString())}`,
          creatorName, creatorProfile?.avatar_url || undefined,
          newTask.title,
        );
      }

      toast.success('اقدام جدید ایجاد شد');
      logAudit({ module: 'tasks', action: 'task_created', entity_name: newTask.title, entity_id: inserted?.id, details: `اقدام "${newTask.title}" برای ${newTask.assigneeName} ایجاد شد`, severity: 'info' });
      setShowCreateForm(false);
      setNewTask({ title: '', description: '', priority: 'medium', assigneeId: '', assigneeName: '' });
      setNewDueDate(null);
      fetchTasks();
    } catch { toast.error('خطا در ایجاد اقدام'); }
    finally { setLoading(false); }
  };

  const handleUpdateTask = async (taskId: string, updatedData: Partial<Task>) => {
    try {
      const shouldArchive = updatedData.status === 'completed';
      const { error } = await supabase.from('tasks').update({ ...updatedData, archived: shouldArchive }).eq('id', taskId);
      if (error) throw error;

      if (updatedData.status && userId) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = {
          completed: 'completed',
          in_progress: 'accepted',
        };
        const act = actionMap[updatedData.status];
        const statusFa: Record<string, string> = {
          completed: 'تکمیل شد',
          in_progress: 'شروع شد',
          pending: 'به حالت انتظار برگشت',
        };
        const actorProfile = users.find(u => u.user_id === userId);
        const actorName = actorProfile?.full_name || actorProfile?.email || 'کاربر';
        // find the full task to get recipients
        const fullTask = tasks.find(t => t.id === taskId);

        if (act && fullTask) {
          await supabase.from('task_workflow_steps').insert({
            task_id: taskId,
            actor_id: userId,
            action: act,
            note: `وضعیت اقدام ${statusFa[updatedData.status] || updatedData.status}`,
          });

          // Notify creator + previous assignee
          const recipients = getTaskRecipients(fullTask, userId);
          const statusLabel = statusFa[updatedData.status] || updatedData.status;
          await Promise.all(recipients.map(rid =>
            sendTaskNotification(rid, userId,
              `تغییر وضعیت اقدام: ${fullTask.title}`,
              `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
              actorName, actorProfile?.avatar_url || undefined, fullTask.title
            )
          ));
        }
      }

      toast.success(shouldArchive ? 'تکمیل و بایگانی شد' : 'به‌روزرسانی شد');
      const fullTask = tasks.find(t => t.id === taskId);
      logAudit({ module: 'tasks', action: updatedData.status ? `task_${updatedData.status}` : 'task_updated', entity_name: fullTask?.title || taskId, entity_id: taskId, details: updatedData.status ? `وضعیت اقدام به "${updatedData.status}" تغییر کرد` : 'اقدام به‌روز شد', severity: 'info' });
      fetchTasks();
      setEditingTaskId(null);
      setEditingTask(null);
    } catch { toast.error('خطا در به‌روزرسانی'); }
  };

  const handleEditSave = async () => {
    if (!editingTask) return;
    const assigneeUser = users.find(u => u.user_id === editAssigneeId);
    await handleUpdateTask(editingTask.id, {
      ...editingTask,
      assignee: assigneeUser ? (assigneeUser.full_name || assigneeUser.email || editingTask.assignee) : editingTask.assignee,
      current_assignee_id: editAssigneeId || editingTask.current_assignee_id,
      due_date: editDueDate ? editDueDate.toISOString() : editingTask.due_date,
    });
  };

  const handleExportToExcel = () => {
    const exportData = tasks.map(task => ({
      'عنوان': task.title,
      'توضیحات': task.description,
      'وضعیت': task.status === 'pending' ? 'در انتظار' : task.status === 'in_progress' ? 'در حال انجام' : 'تکمیل شده',
      'اولویت': task.priority === 'high' ? 'بالا' : task.priority === 'medium' ? 'متوسط' : 'پایین',
      'تاریخ سررسید': toJalali(task.due_date),
      'اقدام کننده': task.assignee,
      'تاریخ ایجاد': task.created_at ? toJalali(task.created_at) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    XLSX.writeFile(wb, `tasks-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('فایل اکسل دانلود شد');
  };

  const getCreatorName = (task: Task) => {
    if (!task.created_by_id) return '—';
    const u = users.find(u => u.user_id === task.created_by_id);
    return u?.full_name || u?.email || '—';
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'archived' ? task.archived : !task.archived && task.status === statusFilter);
    const matchesTab =
      taskTab === 'all' ? true :
      taskTab === 'assigned_to_me' ? task.current_assignee_id === userId :
      taskTab === 'created_by_me' ? (task.created_by_id === userId || task.user_id === userId) : true;
    return matchesSearch && matchesStatus && matchesTab;
  });

  // Count for badges
  const assignedToMeCount = tasks.filter(t => t.current_assignee_id === userId && !t.archived && t.status !== 'completed').length;
  const createdByMeCount = tasks.filter(t => (t.created_by_id === userId || t.user_id === userId) && !t.archived).length;

  const priorityBadge: Record<string, string> = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };
  const statusBadge: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };
  const statusLabel: Record<string, string> = { pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'تکمیل شده' };

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold dark:text-white">مدیریت اقدامات</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExportToExcel}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl transition-colors text-sm">
            دریافت اکسل
          </button>
          {canCreate && (
            <button onClick={() => setShowCreateForm(v => !v)}
              className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl transition-colors text-sm">
              <Plus className="w-4 h-4" /> اقدام جدید
            </button>
          )}
        </div>
      </div>

      {/* Tabs: کارتابل */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button onClick={() => setTaskTab('assigned_to_me')}
          className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'assigned_to_me' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          کارتابل من
          {assignedToMeCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-bold">
              {assignedToMeCount > 9 ? '9+' : assignedToMeCount}
            </span>
          )}
        </button>
        <button onClick={() => setTaskTab('created_by_me')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'created_by_me' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          ایجاد شده توسط من
          {createdByMeCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-gray-400 text-white text-xs flex items-center justify-center font-bold">
              {createdByMeCount > 9 ? '9+' : createdByMeCount}
            </span>
          )}
        </button>
        <button onClick={() => setTaskTab('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'all' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          همه
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTask} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white mb-5 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-teal-500" /> ایجاد اقدام جدید
          </h3>
          {prefillDescription && (
            <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl text-sm text-teal-700 dark:text-teal-300 flex items-start gap-2">
              <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>این اقدام از متن پیام چت ایجاد می‌شود</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان *</label>
              <input required type="text" value={newTask.title}
                onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اقدام کننده *</label>
              <UserSelector users={finalAllUsers as UserProfile[]} groups={userSelectorGroups} value={newTask.assigneeId}
                onChange={(id, name) => setNewTask(t => ({ ...t, assigneeId: id, assigneeName: name }))}
                placeholder="انتخاب کاربر" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
              <select value={newTask.priority}
                onChange={e => setNewTask(t => ({ ...t, priority: e.target.value as Task['priority'] }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                <option value="high">بالا</option>
                <option value="medium">متوسط</option>
                <option value="low">پایین</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ سررسید شمسی *</label>
              <JalaliDateInput value={newDueDate} onChange={setNewDueDate} />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیحات *</label>
              <textarea required value={newTask.description}
                onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))}
                rows={4} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button type="submit" disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              ایجاد اقدام
            </button>
            <button type="button" onClick={() => setShowCreateForm(false)}
              className="px-5 flex items-center gap-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl transition-colors">
              <X className="w-4 h-4" /> انصراف
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="جستجو..." className="w-full pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm">
          <option value="all">همه اقدامات</option>
          <option value="pending">در انتظار</option>
          <option value="in_progress">در حال انجام</option>
          <option value="completed">تکمیل شده</option>
          <option value="archived">بایگانی شده</option>
        </select>
      </div>

      {/* Task grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <ClipboardList className="w-12 h-12 opacity-30" />
          <p className="text-lg">هیچ اقدامی یافت نشد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTasks.map(task => (
            <div key={task.id} id={`task-${task.id}`}
              className={`bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 p-5 hover:shadow-lg transition-all ${task.archived ? 'opacity-70' : ''}`}>
              {editingTaskId === task.id ? (
                <div className="space-y-3">
                  <input type="text" value={editingTask?.title || ''}
                    onChange={e => setEditingTask(t => t ? { ...t, title: e.target.value } : null)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="عنوان" />
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">اقدام کننده</label>
                    <UserSelector users={finalAllUsers as UserProfile[]} groups={userSelectorGroups} value={editAssigneeId}
                      onChange={(id) => setEditAssigneeId(id)}
                      placeholder={editingTask?.assignee || 'انتخاب کاربر'} />
                  </div>
                  <select value={editingTask?.priority || 'medium'}
                    onChange={e => setEditingTask(t => t ? { ...t, priority: e.target.value as Task['priority'] } : null)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                    <option value="high">بالا</option>
                    <option value="medium">متوسط</option>
                    <option value="low">پایین</option>
                  </select>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تاریخ سررسید</label>
                    <JalaliDateInput
                      value={editDueDate || (editingTask ? new Date(editingTask.due_date) : null)}
                      onChange={setEditDueDate} />
                  </div>
                  <textarea value={editingTask?.description || ''}
                    onChange={e => setEditingTask(t => t ? { ...t, description: e.target.value } : null)}
                    rows={3} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm resize-none" />
                  <div className="flex gap-2">
                    <button onClick={handleEditSave}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-xl text-sm transition-colors">
                      <Save className="w-4 h-4" /> ذخیره
                    </button>
                    <button onClick={() => { setEditingTaskId(null); setEditingTask(null); }}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-xl text-sm transition-colors">
                      <X className="w-4 h-4" /> انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-bold text-gray-800 dark:text-white text-base leading-snug flex-1">{task.title}</h3>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={async () => { setWorkflowTask(task); await fetchWorkflow(task.id); }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                        title="مسیر اقدام">
                        <GitFork className="w-4 h-4" />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => { setEditingTaskId(task.id); setEditingTask(task); setEditDueDate(null); setEditAssigneeId(task.current_assignee_id || ''); }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${priorityBadge[task.priority]}`}>
                      {task.priority === 'high' ? 'اولویت بالا' : task.priority === 'medium' ? 'متوسط' : 'پایین'}
                    </span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusBadge[task.status]}`}>
                      {statusLabel[task.status]}
                    </span>
                    {task.current_assignee_id === userId && (task.created_by_id !== userId && task.user_id !== userId) && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1">
                        <ArrowLeft className="w-3 h-3" /> ارجاع به من
                      </span>
                    )}
                    {task.current_assignee_id === userId && (task.created_by_id === userId || task.user_id === userId) && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1">
                        <User className="w-3 h-3" /> اقدام‌کننده: من
                      </span>
                    )}
                    {task.source_message_id && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> از چت
                      </span>
                    )}
                    {task.archived && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 flex items-center gap-1">
                        <Archive className="w-3 h-3" /> بایگانی
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3">{task.description}</p>

                  {/* Meta */}
                  <div className="space-y-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {/* مسئول = ایجادکننده (6) */}
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                      <span>مسئول: <span className="text-gray-700 dark:text-gray-300 font-medium">{getCreatorName(task)}</span></span>
                    </div>
                    {/* اقدام کننده = assignee (6) */}
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 flex-shrink-0 text-teal-500" />
                      <span>اقدام کننده: <span className="text-gray-700 dark:text-gray-300 font-medium">{task.assignee || '—'}</span></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                      {/* ✅ Correct Jalali date */}
                      <span>سررسید: <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{toJalali(task.due_date)}</span></span>
                    </div>
                  </div>

                  {/* Actions bar */}
                  <div className="flex gap-2">
                    <select value={task.status}
                      onChange={e => handleUpdateTask(task.id, { status: e.target.value as Task['status'] })}
                      className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:bg-gray-700 dark:text-white">
                      <option value="pending">در انتظار</option>
                      <option value="in_progress">در حال انجام</option>
                      <option value="completed">تکمیل شده</option>
                    </select>
                    {/* ثبت اقدام — any user can log an action (3) */}
                    {userId && (
                      <button onClick={() => setAddNoteTask(task)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/20 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded-xl text-sm border border-teal-200 dark:border-teal-700 transition-colors"
                        title="ثبت اقدام">
                        <ClipboardList className="w-3.5 h-3.5" /> ثبت
                      </button>
                    )}
                    {userId && (
                      <button onClick={() => setReferTask(task)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-xl text-sm border border-amber-200 dark:border-amber-700 transition-colors"
                        title="ارجاع">
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Workflow flowchart modal */}
      {workflowTask && (
        <WorkflowModal task={workflowTask} steps={workflowSteps} users={users} onClose={() => setWorkflowTask(null)} />
      )}

      {/* Refer modal */}
      {referTask && userId && (() => {
        const actor = users.find(u => u.user_id === userId);
        return (
          <ReferModal
            task={referTask}
            users={finalAllUsers as UserProfile[]}
            groups={userSelectorGroups}
            currentUserId={userId}
            actorName={actor?.full_name || actor?.email || 'کاربر'}
            actorAvatarUrl={actor?.avatar_url || null}
            onClose={() => setReferTask(null)}
            onReferred={fetchTasks}
          />
        );
      })()}

      {/* Add note / log action modal */}
      {addNoteTask && userId && (() => {
        const actor = users.find(u => u.user_id === userId);
        return (
          <AddNoteModal
            task={addNoteTask}
            userId={userId}
            actorName={actor?.full_name || actor?.email || 'کاربر'}
            actorAvatarUrl={actor?.avatar_url || null}
            onClose={() => setAddNoteTask(null)}
            onSaved={fetchTasks}
          />
        );
      })()}
    </div>
  );
}
