import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { insertNotification } from '../../lib/notifications';
import toast from 'react-hot-toast';
import { ArrowRight, Users, Pin, Search, X, Info, Star, GitFork, Settings, AtSign, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import moment from 'moment-jalaali';
import {
  Channel, ChannelMessage, ChannelMember, ChannelProfile,
  MessageWithMeta, MemberRole, GroupTask, GroupTaskAssignment,
} from './types';
import { ChannelMessageItem } from './ChannelMessageItem';
import { ChannelInputBar } from './ChannelInputBar';
import { ChannelMembersModal } from './ChannelMembersModal';
import { WorkTopicsPanel } from './WorkTopicsPanel';
import { ChannelSettingsModal } from './ChannelSettingsModal';
import { loadChatTheme } from '../Chat/ChatSettingsPage';
import type { ChatThemeSettings } from '../Chat/ChatSettingsPage';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function useChatTheme(): ChatThemeSettings {
  const [theme, setTheme] = useState<ChatThemeSettings>(loadChatTheme);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setTheme(detail ? (detail as ChatThemeSettings) : loadChatTheme());
    };
    window.addEventListener('chatThemeChanged', handler);
    return () => window.removeEventListener('chatThemeChanged', handler);
  }, []);
  return theme;
}

interface Props {
  channel: Channel;
  currentUserId: string | null;
  allProfiles: ChannelProfile[];
  onBack: () => void;
  isMobile: boolean;
  scrollToMessageId?: string | null;
  onScrollHandled?: () => void;
  onNavigateToTasks?: (messageBody: string, messageId: string) => void;
  onOpenDirectChat?: (userId: string) => void;
}

type MemberWithProfile = ChannelMember & { profile: ChannelProfile | null };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function toJalali(iso: string): string {
  return moment(iso).format('jYYYY/jMM/jDD HH:mm');
}

function buildMeta(
  msgs: ChannelMessage[],
  reactions: { message_id: string; user_id: string; emoji: string }[],
  stars: { message_id: string }[],
  profiles: ChannelProfile[],
  currentUserId: string | null
): MessageWithMeta[] {
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const msgMap = new Map(msgs.map(m => [m.id, m]));
  const reactionsByMsg = new Map<string, { emoji: string; user_id: string }[]>();
  for (const r of reactions) {
    if (!reactionsByMsg.has(r.message_id)) reactionsByMsg.set(r.message_id, []);
    reactionsByMsg.get(r.message_id)!.push(r);
  }
  const starredIds = new Set(stars.map(s => s.message_id));

  return msgs
    .map(m => {
      const raw = reactionsByMsg.get(m.id) || [];
      const emojiMap = new Map<string, { count: number; reactedByMe: boolean }>();
      for (const r of raw) {
        const e = emojiMap.get(r.emoji) || { count: 0, reactedByMe: false };
        e.count++;
        if (r.user_id === currentUserId) e.reactedByMe = true;
        emojiMap.set(r.emoji, e);
      }
      return {
        ...m,
        senderProfile: m.sender_id ? (profileMap.get(m.sender_id) || null) : null,
        reactions: Array.from(emojiMap.entries()).map(([emoji, v]) => ({ emoji, ...v })),
        replyTarget: m.reply_to_id ? (msgMap.get(m.reply_to_id) || null) : null,
        isStarred: starredIds.has(m.id),
      };
    });
}

// ─── Jalali Calendar Picker ───────────────────────────────────────────────────
function JalaliCalendarPicker({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const today = moment();
  const initM = value ? moment(value) : today.clone();
  const [viewYear, setViewYear] = useState(initM.jYear());
  const [viewMonth, setViewMonth] = useState(initM.jMonth());
  const [hour, setHour] = useState<number>(value ? moment(value).hour() : 9);
  const [minute, setMinute] = useState<number>(value ? moment(value).minute() : 0);

  const monthStart = moment(`${viewYear}/${viewMonth + 1}/1`, 'jYYYY/jM/jD');
  const firstDow = (monthStart.day() + 1) % 7; // Saturday=0 in fa
  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedM = value ? moment(value) : null;

  // روزِ انتخاب‌شده فعلی برای ترکیب با ساعت؛ اگر چیزی انتخاب نشده از روزِ نمای جاری استفاده می‌کنیم
  const buildDate = (day: number, h: number, mn: number) =>
    moment(`${viewYear}/${viewMonth + 1}/${day}`, 'jYYYY/jM/jD').hour(h).minute(mn).second(0).toDate();

  const selectDay = (day: number) => onChange(buildDate(day, hour, minute));

  const changeTime = (h: number, mn: number) => {
    setHour(h);
    setMinute(mn);
    if (selectedM) {
      // روزِ انتخاب‌شده را با ساعت جدید به‌روزرسانی کن
      onChange(moment(value!).hour(h).minute(mn).second(0).toDate());
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 p-3 w-full shadow-xl" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        <span className="text-sm font-semibold text-gray-700 dark:text-white">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const isSelected = selectedM && selectedM.jYear() === viewYear && selectedM.jMonth() === viewMonth && selectedM.jDate() === day;
          const isToday = today.jYear() === viewYear && today.jMonth() === viewMonth && today.jDate() === day;
          return (
            <button type="button" key={day} onClick={() => selectDay(day)}
              className={`text-center text-xs py-1 rounded-lg transition-colors
                ${isSelected ? 'bg-blue-500 text-white font-bold' : isToday ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              {day}
            </button>
          );
        })}
      </div>

      {/* انتخاب ساعت */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2" dir="ltr">
        <select
          value={hour}
          onChange={e => changeTime(Number(e.target.value), minute)}
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/40"
        >
          {hours.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
        </select>
        <span className="text-gray-400 font-bold">:</span>
        <select
          value={minute}
          onChange={e => changeTime(hour, Number(e.target.value))}
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/40"
        >
          {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
        <span className="text-[10px] text-gray-400 mr-1">ساعت</span>
      </div>
    </div>
  );
}

// ─── Jalali Date Input ────────────────────────────────────────────────────────
function JalaliDateInput({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          readOnly
          value={value ? toJalali(value.toISOString()) : ''}
          onClick={() => setOpen(v => !v)}
          placeholder="انتخاب تاریخ و ساعت"
          className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm cursor-pointer"
          dir="ltr"
        />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {open && (
        <div className="absolute z-50 top-full mb-1 left-0 right-0">
          <JalaliCalendarPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}


// ─── GroupTaskModal ───────────────────────────────────────────────────────────
function GroupTaskModal({ msg, mentionedUsers, channelId, currentUserId, onClose, onCreated }: {
  msg: MessageWithMeta;
  mentionedUsers: ChannelProfile[];
  channelId: string;
  currentUserId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(msg.body ? msg.body.slice(0, 80) : '');
  const [groupDueDate, setGroupDueDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || !currentUserId || mentionedUsers.length === 0) return;
    if (!groupDueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    setSaving(true);
    try {
      const { data: task, error } = await supabase.from('channel_group_tasks').insert({
        channel_id: channelId,
        message_id: msg.id,
        title: title.trim(),
        body: msg.body,
        created_by: currentUserId,
        status: 'open',
        due_date: groupDueDate.toISOString(),
      }).select().maybeSingle();
      if (error || !task) { toast.error('خطا در ایجاد اقدام: ' + error?.message); return; }

      for (const u of mentionedUsers) {
        await supabase.from('channel_group_task_assignments').insert({
          group_task_id: task.id,
          assignee_id: u.user_id,
          status: 'pending',
        });insertNotification({
          userId: u.user_id,
          category: 'channel',
          eventType: 'new_message',
          fallbackTitle: 'اقدام گروهی جدید',
          fallbackMessage: `یک اقدام گروهی برای شما ایجاد شد: ${title.trim()}`,
          placeholders: { message_preview: title.trim() },
          senderId: currentUserId,
        }).catch(() => {});
      }
      toast.success(`اقدام گروهی برای ${mentionedUsers.length} نفر ایجاد شد`);
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[400] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div className="flex items-center gap-2">
            <GitFork className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-gray-900 dark:text-white">ایجاد اقدام گروهی</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {msg.body && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 line-clamp-3">
              {msg.body}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">عنوان اقدام</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="عنوان اقدام گروهی..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">تاریخ سررسید شمسی *</label>
            <JalaliDateInput value={groupDueDate} onChange={setGroupDueDate} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">مسئولان ({mentionedUsers.length} نفر)</p>
            <div className="space-y-1.5">
              {mentionedUsers.map(u => (
                <div key={u.user_id} className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{u.full_name || u.email}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">لغو</button>
            <button onClick={create} disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'در حال ایجاد...' : 'ایجاد اقدام'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pinned messages popup
function PinnedPopup({ pinnedMsgs, privatePins, profiles, onScrollTo, onClose }: {
  pinnedMsgs: ChannelMessage[];
  privatePins: ChannelMessage[];
  profiles: ChannelProfile[];
  onScrollTo: (id: string) => void;
  onClose: () => void;
}) {
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const totalCount = pinnedMsgs.length + privatePins.length;

  return (
    <div className="absolute top-14 left-2 right-2 sm:left-4 sm:right-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 z-50 overflow-hidden max-h-72 flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5">
          <Pin className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-white">پیام‌های پین شده ({totalCount})</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400"><X className="w-4 h-4" /></button>
      </div>
      <div className="overflow-y-auto flex-1">
        {totalCount === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">پیام پین شده‌ای وجود ندارد</p>
        ) : (
          <>
            {pinnedMsgs.map(m => {
              const pinner = m.pinned_by ? profileMap.get(m.pinned_by) : null;
              return (
                <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                  className="w-full flex items-start gap-2 px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-right transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                  <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    {pinner && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-0.5">
                        پین شده توسط {pinner.full_name || pinner.email}
                      </p>
                    )}
                    <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                  </div>
                </button>
              );
            })}
            {privatePins.map(m => (
              <button key={`priv-${m.id}`} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="w-full flex items-start gap-2 px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-right transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                <Pin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-blue-500 dark:text-blue-400 mb-0.5">پین خصوصی</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// Starred messages panel
function StarredPanel({ starredMsgs, onScrollTo, onClose }: {
  starredMsgs: MessageWithMeta[];
  onScrollTo: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} dir="rtl">
      <div className="absolute inset-y-0 left-0 w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            <h3 className="text-base font-bold dark:text-white">پیام‌های نشان‌دار</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">{starredMsgs.length}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {starredMsgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Star className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400">پیام نشان‌داری وجود ندارد</p>
            </div>
          ) : (
            starredMsgs.map(m => (
              <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-yellow-50 dark:hover:bg-yellow-900/10 text-right transition-colors border-b border-gray-50 dark:border-gray-800">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{m.senderProfile?.full_name || m.senderProfile?.email || 'کاربر'}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ChannelConversationView({ channel, currentUserId, allProfiles, onBack, isMobile, scrollToMessageId, onScrollHandled, onNavigateToTasks, onOpenDirectChat }: Props) {
  const theme = useChatTheme();
  const isDark = useDarkMode();
  const [messages, setMessages] = useState<MessageWithMeta[]>([]);
  const [reactions, setReactions] = useState<{ message_id: string; user_id: string; emoji: string }[]>([]);
  const [_stars, setStars] = useState<{ message_id: string }[]>([]);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [pinnedMsgs, setPinnedMsgs] = useState<ChannelMessage[]>([]);
  const [privatePins, setPrivatePins] = useState<ChannelMessage[]>([]);
  const [groupTasks, setGroupTasks] = useState<GroupTask[]>([]);
  const [replyTarget, setReplyTarget] = useState<ChannelMessage | null>(null);
  const [editTarget, setEditTarget] = useState<MessageWithMeta | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showTopics, setShowTopics] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPinnedPopup, setShowPinnedPopup] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [groupTaskTarget, setGroupTaskTarget] = useState<{ msg: MessageWithMeta; mentionedUsers: ChannelProfile[] } | null>(null);
  const [mentionBarItems, setMentionBarItems] = useState<{ id: string; body: string | null; senderName: string }[]>([]);
  const [readLogMap, setReadLogMap] = useState<Record<string, Array<{ user_id: string; seen_at: string }>>>({});
  const [dismissedMentionIds, setDismissedMentionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`dismissed_mentions_ch_${channel.id}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgContainerRef = useRef<HTMLDivElement>(null);

  const profileMap = new Map(allProfiles.map(p => [p.user_id, p]));
  const memberProfiles: ChannelProfile[] = members.map(m => m.profile).filter(Boolean) as ChannelProfile[];

  const canPost = channel.type === 'group'
    ? (myRole !== null && !(channel as any).is_locked)
    : (myRole === 'admin' || channel.created_by === currentUserId);

  const isAdmin = myRole === 'admin';

  const starredMessages = messages.filter(m => m.isStarred);

  const fetchMessages = useCallback(async () => {
    const { data: msgs } = await supabase
      .from('channel_messages').select('*')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true });

    const msgIds = (msgs || []).map(m => m.id);
    const [{ data: reacts }, { data: starsData }] = await Promise.all([
      msgIds.length
        ? supabase.from('channel_message_reactions').select('message_id, user_id, emoji').in('message_id', msgIds)
        : Promise.resolve({ data: [] }),
      currentUserId && msgIds.length
        ? supabase.from('channel_message_stars').select('message_id').in('message_id', msgIds).eq('user_id', currentUserId)
        : Promise.resolve({ data: [] }),
    ]);

    const raw = msgs || [];
    setReactions(reacts || []);
    setStars(starsData || []);
    setMessages(buildMeta(raw, reacts || [], starsData || [], allProfiles, currentUserId));

    if (currentUserId) {
      const hasUnread = raw.some(m => !m.deleted_for_all && m.sender_id !== currentUserId && !(m.read_by || []).includes(currentUserId));
      if (hasUnread) {
        supabase.rpc('mark_channel_messages_read', { p_channel_id: channel.id })
          .then(() => {
            supabase.from('channel_messages').select('*')
              .eq('channel_id', channel.id)
              .order('created_at', { ascending: true })
              .then(({ data: fresh }) => {
                if (fresh) setMessages(buildMeta(fresh, reacts || [], starsData || [], allProfiles, currentUserId));
              });
          })
          .catch(() => {});
      }

      const ownMsgIds = raw.filter(m => m.sender_id === currentUserId).map(m => m.id);
      if (ownMsgIds.length) fetchReadLog(ownMsgIds);
    }
  }, [channel.id, allProfiles, currentUserId]);

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase.from('channel_members').select('*').eq('channel_id', channel.id);
    if (!data) return;
    const withProfiles: MemberWithProfile[] = data.map((m: any) => ({
      ...m, profile: profileMap.get(m.user_id) || null,
    }));
    setMembers(withProfiles);
    const me = data.find((m: any) => m.user_id === currentUserId);
    setMyRole(me?.role || null);
  }, [channel.id, currentUserId, allProfiles]);

  const fetchPinned = useCallback(async () => {
    const { data: adminPinned } = await supabase.from('channel_messages').select('*')
      .eq('channel_id', channel.id).eq('is_pinned', true).eq('deleted_for_all', false)
      .order('created_at', { ascending: false });
    setPinnedMsgs(adminPinned || []);

    if (currentUserId) {
      const { data: myPins } = await supabase
        .from('channel_message_private_pins')
        .select('message_id')
        .eq('user_id', currentUserId);
      if (myPins && myPins.length > 0) {
        const ids = myPins.map((p: any) => p.message_id);
        const { data: privateMsgs } = await supabase.from('channel_messages').select('*')
          .in('id', ids).eq('deleted_for_all', false);
        setPrivatePins(privateMsgs || []);
      } else {
        setPrivatePins([]);
      }
    }
  }, [channel.id, currentUserId]);

  const fetchGroupTasks = useCallback(async () => {
    if (channel.type !== 'group') return;
    const { data: tasks } = await supabase.from('channel_group_tasks').select('*')
      .eq('channel_id', channel.id).order('created_at', { ascending: false });
    if (!tasks || tasks.length === 0) { setGroupTasks([]); return; }

    const taskIds = tasks.map((t: any) => t.id);
    const [{ data: assignments }, { data: activities }] = await Promise.all([
      supabase.from('channel_group_task_assignments').select('*').in('group_task_id', taskIds),
      supabase.from('channel_group_task_activities').select('*').in('group_task_id', taskIds).order('created_at', { ascending: true }),
    ]);

    const grouped = tasks.map((t: any) => ({
      ...t,
      assignments: (assignments || []).filter((a: any) => a.group_task_id === t.id),
      activities: (activities || []).filter((a: any) => a.group_task_id === t.id),
      creatorProfile: profileMap.get(t.created_by) || null,
    }));
    setGroupTasks(grouped as GroupTask[]);
  }, [channel.id, channel.type, allProfiles]);

  const fetchMentionBar = async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from('channel_messages')
      .select('id, body, sender_id')
      .eq('channel_id', channel.id)
      .eq('deleted_for_all', false)
      .neq('sender_id', currentUserId)
      .contains('mentioned_user_ids', [currentUserId])
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data || data.length === 0) return;
    const senderMap = new Map(allProfiles.map(p => [p.user_id, p]));
    setMentionBarItems(data.map((m: any) => ({
      id: m.id,
      body: m.body,
      senderName: senderMap.get(m.sender_id)?.full_name || senderMap.get(m.sender_id)?.email || 'کاربر',
    })));
  };

  const fetchReadLog = useCallback(async (msgIds: string[]) => {
    if (!msgIds.length) return;
    try {
      const { data } = await supabase
        .from('channel_message_read_log')
        .select('message_id, user_id, seen_at')
        .in('message_id', msgIds);
      if (!data) return;
      const grouped: Record<string, Array<{ user_id: string; seen_at: string }>> = {};
      for (const row of data) {
        (grouped[row.message_id] ??= []).push({ user_id: row.user_id, seen_at: row.seen_at });
      }
      setReadLogMap(grouped);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchMembers();
    fetchPinned();
    fetchGroupTasks();
    if (currentUserId) fetchMentionBar();

    const sub = supabase.channel(`ch-rt-${channel.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages', filter: `channel_id=eq.${channel.id}` }, () => { fetchMessages(); fetchPinned(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_message_reactions' }, fetchMessages)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_message_stars' }, fetchMessages)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members', filter: `channel_id=eq.${channel.id}` }, fetchMembers)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_group_tasks', filter: `channel_id=eq.${channel.id}` }, fetchGroupTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_group_task_assignments' }, fetchGroupTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_group_task_activities' }, fetchGroupTasks)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [channel.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!scrollToMessageId) return;
    handleScrollToMessage(scrollToMessageId);
    onScrollHandled?.();
  }, [scrollToMessageId]);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const container = msgContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).style.backgroundColor = 'rgba(20, 184, 166, 0.15)';
      setTimeout(() => { (el as HTMLElement).style.backgroundColor = ''; }, 1500);
    }
  }, []);

  const handleReact = async (msgId: string, emoji: string) => {
    if (!currentUserId) return;
    const existing = reactions.find(r => r.message_id === msgId && r.user_id === currentUserId && r.emoji === emoji);
    if (existing) {
      await supabase.from('channel_message_reactions').delete().eq('message_id', msgId).eq('user_id', currentUserId).eq('emoji', emoji);
    } else {
      await supabase.from('channel_message_reactions').insert({ message_id: msgId, user_id: currentUserId, emoji });
    }
    fetchMessages();
  };

  const handlePin = async (msgId: string, pinned: boolean) => {
    if (!currentUserId) return;
    if (isAdmin) {
      await supabase.from('channel_messages').update({
        is_pinned: pinned,
        pinned_by: pinned ? currentUserId : null,
      }).eq('id', msgId);
    } else {
      if (pinned) {
        await supabase.from('channel_message_private_pins')
          .upsert({ message_id: msgId, user_id: currentUserId }, { onConflict: 'message_id,user_id' });
      } else {
        await supabase.from('channel_message_private_pins')
          .delete().eq('message_id', msgId).eq('user_id', currentUserId);
      }
    }
    fetchMessages(); fetchPinned();
  };

  const handleStar = async (msgId: string, starred: boolean) => {
    if (!currentUserId) return;
    if (starred) {
      const { error } = await supabase.from('channel_message_stars')
        .upsert({ message_id: msgId, user_id: currentUserId }, { onConflict: 'message_id,user_id' });
      if (error) { toast.error('خطا در نشانه‌گذاری: ' + error.message); return; }
    } else {
      await supabase.from('channel_message_stars').delete().eq('message_id', msgId).eq('user_id', currentUserId);
    }
    await fetchMessages();
  };

  const handleDelete = async (msgId: string) => {
    await supabase.rpc('delete_channel_message', { p_message_id: msgId });
    fetchMessages(); fetchPinned();
  };

  const handleEdit = (msg: MessageWithMeta) => {
    setEditTarget(msg); setReplyTarget(null);
  };

  const handleRegisterTask = (messageBody: string, messageId: string) => {
    if (!currentUserId) return;
    onNavigateToTasks?.(messageBody, messageId);
  };

  const handleGroupTask = (msg: MessageWithMeta, mentionedUsers: ChannelProfile[]) => {
    setGroupTaskTarget({ msg, mentionedUsers });
  };

  const handleCompleteTask = async (taskId: string) => {
    await supabase.from('channel_group_tasks').update({ status: 'done' }).eq('id', taskId);
    await supabase.from('channel_group_task_assignments').update({ status: 'archived' }).eq('group_task_id', taskId);
    fetchGroupTasks();
  };

  const handleArchiveTask = async (taskId: string) => {
    await supabase.from('channel_group_tasks').update({ status: 'archived' }).eq('id', taskId);
    fetchGroupTasks();
  };

  const handleUpdateAssignment = async (assignmentId: string, status: GroupTaskAssignment['status']) => {
    await supabase.from('channel_group_task_assignments').update({ status }).eq('id', assignmentId);
    fetchGroupTasks();
  };

  const handleAddActivity = async (taskId: string, note: string) => {
    if (!currentUserId) return;
    const { error } = await supabase.from('channel_group_task_activities').insert({
      group_task_id: taskId,
      user_id: currentUserId,
      note,
    });
    if (error) { toast.error('خطا در ثبت: ' + error.message); return; }
    fetchGroupTasks();
  };

  const handleAddMember = async (userId: string) => {
    const { error } = await supabase.from('channel_members').insert({ channel_id: channel.id, user_id: userId, role: 'member' });
    if (error) { toast.error(`خطا: ${error.message}`); return; }
    const name = profileMap.get(userId)?.full_name || 'کاربر';
    await supabase.rpc('insert_channel_system_message', {
      p_channel_id: channel.id,
      p_body: `${name} به ${channel.type === 'channel' ? 'کانال' : 'گروه'} اضافه شد`,
    });
    insertNotification({
      userId, category: 'channel', eventType: 'member_added',
      fallbackTitle: `به ${channel.name} اضافه شدید`,
      fallbackMessage: `شما به ${channel.type === 'channel' ? 'کانال' : 'گروه'} ${channel.name} اضافه شدید`,
      placeholders: { channel_name: channel.name, channel_type: channel.type === 'channel' ? 'کانال' : 'گروه' },
      senderId: currentUserId,
    }).catch(() => {});
    fetchMembers();
  };

  const handleRemoveMember = async (userId: string) => {
    await supabase.from('channel_members').delete().eq('channel_id', channel.id).eq('user_id', userId);
    fetchMembers();
  };

  const handleChangeRole = async (userId: string, role: MemberRole) => {
    await supabase.from('channel_members').update({ role }).eq('channel_id', channel.id).eq('user_id', userId);
    fetchMembers();
  };

  const displayMessages = searchQuery
    ? messages.filter(m => m.body?.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const grouped: { date: string; msgs: MessageWithMeta[] }[] = [];
  for (const msg of displayMessages) {
    const d = formatDate(msg.created_at);
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== d) grouped.push({ date: d, msgs: [msg] });
    else last.msgs.push(msg);
  }

  const openGroupTasksCount = groupTasks.filter(t => t.status === 'open').length;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 relative" dir="rtl">
        {/* Header */}
        <div className="flex items-center gap-2 px-2 sm:px-4 py-2.5 sm:py-3 border-b border-gray-100 dark:border-gray-700 shrink-0 bg-white dark:bg-gray-800">
          {isMobile && (
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 shrink-0">
              <ArrowRight className="w-5 h-5" />
            </button>
          )}
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0 text-sm font-bold text-teal-600 dark:text-teal-400">
            {channel.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white truncate">{channel.name}</h2>
            <p className="text-[11px] text-gray-400">{channel.member_count} عضو</p>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {/* Search */}
            <button onClick={() => setShowSearch(v => !v)}
              className={`p-1.5 sm:p-2 rounded-xl transition-colors ${showSearch ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400'}`}>
              <Search className="w-4 h-4" />
            </button>

            {/* Group tasks (only for groups) */}
            {channel.type === 'group' && (
              <button onClick={() => setShowTopics(true)}
                className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 relative">
                <GitFork className="w-4 h-4" />
                {openGroupTasksCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-teal-500 rounded-full flex items-center justify-center text-[9px] text-white font-bold px-0.5">{openGroupTasksCount}</span>
                )}
              </button>
            )}

            {/* Members */}
            <button onClick={() => setShowMembers(true)} className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
              <Users className="w-4 h-4" />
            </button>

            {/* Admin settings */}
            {isAdmin && (
              <button onClick={() => setShowSettings(true)} className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-3 sm:px-4 py-2 border-b border-gray-100 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-700/50">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجو در پیام‌ها..."
                className="w-full pr-9 pl-3 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/40" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
        )}

        {/* Description */}
        {channel.description && (
          <div className="px-3 sm:px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><Info className="w-3 h-3 shrink-0" />{channel.description}</p>
          </div>
        )}

        {/* Messages + floating buttons */}
        <div className="flex-1 relative overflow-hidden">
          <div ref={msgContainerRef} className="h-full overflow-y-auto py-2 overscroll-contain">
            {grouped.map(({ date, msgs: grpMsgs }) => (
              <div key={date}>
                <div className="flex justify-center my-3">
                  <span className="text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">{date}</span>
                </div>
                {grpMsgs.map(msg => (
                  <div key={msg.id} data-msg-id={msg.id} style={{ transition: 'background-color 0.6s ease' }}>
                    <ChannelMessageItem
                      msg={msg}
                      currentUserId={currentUserId}
                      myRole={myRole}
                      allMembers={memberProfiles}
                      allProfiles={allProfiles}
                      isChannelType={channel.type === 'channel'}
                      isPrivatelyPinned={privatePins.some(p => p.id === msg.id)}
                      theme={theme}
                      isDark={isDark}
                      readLogData={readLogMap[msg.id]}
                      onReply={m => { setReplyTarget(m); setEditTarget(null); }}
                      onReact={handleReact}
                      onPin={handlePin}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                      onStar={handleStar}
                      onScrollToMessage={handleScrollToMessage}
                      onRegisterAsTask={handleRegisterTask}
                      onGroupTask={channel.type === 'group' ? handleGroupTask : undefined}
                      onOpenDirectChat={onOpenDirectChat}
                    />
                  </div>
                ))}
              </div>
            ))}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-16">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <Users className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm text-gray-400">هنوز پیامی ارسال نشده</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Floating pin button — only when there are pinned messages */}
          {(pinnedMsgs.length > 0 || privatePins.length > 0) && (
            <button
              onClick={() => setShowPinnedPopup(v => !v)}
              className={`absolute left-3 top-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shadow-lg border transition-all z-10 text-xs font-medium ${
                showPinnedPopup
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }`}
              title="پیام‌های پین شده"
            >
              <Pin className="w-3.5 h-3.5" />
              <span>{pinnedMsgs.length + privatePins.length}</span>
            </button>
          )}

          {/* Floating star button — only when there are starred messages */}
          {starredMessages.length > 0 && (
            <button
              onClick={() => setShowStarred(v => !v)}
              className={`absolute left-3 transition-all z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shadow-lg border text-xs font-medium ${
                pinnedMsgs.length > 0 || privatePins.length > 0 ? 'top-14' : 'top-3'
              } ${
                showStarred
                  ? 'bg-yellow-400 text-white border-yellow-400'
                  : 'bg-white dark:bg-gray-800 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
              }`}
              title="پیام‌های نشان‌دار"
            >
              <Star className={`w-3.5 h-3.5 ${showStarred ? 'fill-white' : 'fill-yellow-400'}`} />
              <span>{starredMessages.length}</span>
            </button>
          )}

          {/* Pinned popup */}
          {showPinnedPopup && (
            <PinnedPopup
              pinnedMsgs={pinnedMsgs}
              privatePins={privatePins}
              profiles={allProfiles}
              onScrollTo={handleScrollToMessage}
              onClose={() => setShowPinnedPopup(false)}
            />
          )}
        </div>

        {/* Input */}
        {mentionBarItems.filter(m => !dismissedMentionIds.has(m.id)).length > 0 && (
          <ChannelMentionsBar
            items={mentionBarItems.filter(m => !dismissedMentionIds.has(m.id))}
            onScrollTo={id => handleScrollToMessage(id)}
            onDismiss={id => setDismissedMentionIds(prev => {
              const next = new Set([...prev, id]);
              try { localStorage.setItem(`dismissed_mentions_ch_${channel.id}`, JSON.stringify([...next])); } catch {}
              return next;
            })}
            onDismissAll={() => {
              const all = new Set(mentionBarItems.map(m => m.id));
              try { localStorage.setItem(`dismissed_mentions_ch_${channel.id}`, JSON.stringify([...all])); } catch {}
              setDismissedMentionIds(all);
            }}
          />
        )}
        <ChannelInputBar
          channelId={channel.id}
          channelName={channel.name}
          channelType={channel.type}
          currentUserId={currentUserId}
          allProfiles={allProfiles}
          members={members}
          replyTarget={replyTarget}
          editTarget={editTarget}
          canPost={canPost}
          onSent={fetchMessages}
          onCancelReply={() => setReplyTarget(null)}
          onCancelEdit={() => setEditTarget(null)}
        />

      {/* Starred panel */}
      {showStarred && (
        <StarredPanel
          starredMsgs={starredMessages}
          onScrollTo={id => { handleScrollToMessage(id); setShowStarred(false); }}
          onClose={() => setShowStarred(false)}
        />
      )}

      {showMembers && (
        <ChannelMembersModal
          members={members}
          allProfiles={allProfiles}
          currentUserId={currentUserId}
          myRole={myRole}
          onClose={() => setShowMembers(false)}
          onAdd={handleAddMember}
          onRemove={handleRemoveMember}
          onChangeRole={handleChangeRole}
        />
      )}

      {showSettings && (
        <ChannelSettingsModal
          channel={channel}
          myRole={myRole}
          currentUserId={currentUserId}
          members={members}
          allProfiles={allProfiles}
          onClose={() => setShowSettings(false)}
          onUpdated={fetchMembers}
          onDeleted={() => { setShowSettings(false); /* parent handles via RT */ }}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onChangeRole={handleChangeRole}
        />
      )}

      {showTopics && channel.type === 'group' && (
        <WorkTopicsPanel
          tasks={groupTasks}
          members={memberProfiles}
          currentUserId={currentUserId}
          channelId={channel.id}
          allProfiles={allProfiles}
          onClose={() => setShowTopics(false)}
          onCompleteTask={handleCompleteTask}
          onArchiveTask={handleArchiveTask}
          onUpdateAssignment={handleUpdateAssignment}
          onAddActivity={handleAddActivity}
          onTaskCreated={fetchGroupTasks}
        />
      )}

      {groupTaskTarget && (
        <GroupTaskModal
          msg={groupTaskTarget.msg}
          mentionedUsers={groupTaskTarget.mentionedUsers}
          channelId={channel.id}
          currentUserId={currentUserId}
          onClose={() => setGroupTaskTarget(null)}
          onCreated={() => { fetchGroupTasks(); setGroupTaskTarget(null); }}
        />
      )}
    </div>
  );
}

// ─── Channel Mentions Bar ────────────────────────────────────────────────────
function ChannelMentionsBar({
  items,
  onScrollTo,
  onDismiss,
  onDismissAll,
}: {
  items: { id: string; body: string | null; senderName: string }[];
  onScrollTo: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  const current = items[0];
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border-t border-teal-200 dark:border-teal-800"
      dir="rtl"
    >
      <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
        <AtSign className="w-3.5 h-3.5 text-white" />
      </div>
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="flex-1 min-w-0 text-right"
      >
        <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 truncate block">
          {current.senderName} شما را منشن کرد
        </span>
        {current.body && (
          <span className="text-[11px] text-teal-600/80 dark:text-teal-400/80 truncate block leading-tight">
            {current.body.slice(0, 80)}
          </span>
        )}
      </button>
      {items.length > 1 && (
        <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold bg-teal-100 dark:bg-teal-900/40 px-1.5 py-0.5 rounded-full shrink-0">
          {items.length}
        </span>
      )}
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="text-[11px] text-teal-700 dark:text-teal-300 font-semibold hover:underline shrink-0"
      >
        رفتن
      </button>
      <button
        onClick={() => onDismiss(current.id)}
        title="بستن این منشن"
        className="p-1 text-teal-500 hover:text-teal-700 shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {items.length > 1 && (
        <button
          onClick={onDismissAll}
          className="text-[10px] text-teal-500 hover:text-teal-700 shrink-0"
        >
          همه
        </button>
      )}
    </div>
  );
}
