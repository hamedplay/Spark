import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Check, UserCheck, X, MapPin, Clock, Calendar, Search, ChevronRight, Users, Building2, ChevronDown, Circle as XCircle, CircleAlert as AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { insertNotification } from '../lib/notifications';
import { getMeetingTemplateKey } from '../config/templateCatalog';
import toast from 'react-hot-toast';
import { useOrgUsers } from '../lib/useOrgUsers';
import { useDraggableFab, panelStyle } from '../lib/useDraggableFab';
import { gregorianToJalali } from '../lib/sparkDateUtils';

function formatMeetingDate(meeting: { start_time?: string | null; date?: string | null }): string {
  try {
    const dateStr = meeting.date || (meeting.start_time ? meeting.start_time.split('T')[0] : '');
    if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const [jy, jm, jd] = gregorianToJalali(y, m, d);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  } catch { return ''; }
}

interface InboxEntry {
  id: string;           // meeting_inbox.id
  meeting_id: string;
  status: 'pending' | 'accepted' | 'delegated' | 'declined';
  delegate_to: string | null;
}

interface InboxMeeting {
  id: string;
  subject: string;
  request_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  user_id: string;
  participant_user_ids: string[];
  notify_users: string[];
  calendar_id: string | null;
}

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function MeetingInboxButton() {
  const [open, setOpen] = useState(false);
  const { pos: fabPos, onDragStart, wasDragged } = useDraggableFab('inbox-fab-pos', 'right', 38);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [meetings, setMeetings] = useState<Record<string, InboxMeeting>>({});
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [delegateForEntry, setDelegateForEntry] = useState<InboxEntry | null>(null);
  const [declineConfirmEntry, setDeclineConfirmEntry] = useState<InboxEntry | null>(null);
  const [delegateSearch, setDelegateSearch] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const { groups: orgGroups, allUsers: orgAllUsers } = useOrgUsers(currentUserId);

  const pendingCount = entries.length;

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);
    setFetchError(null);

    // Single joined query — avoids the two-query race where entries update
    // before meetings load, and catches RLS failures in one place.
    const { data: inboxRows, error: inboxErr } = await supabase
      .from('meeting_inbox')
      .select(`
        id,
        meeting_id,
        status,
        delegate_to,
        meeting:meetings (
          id, subject, request_date, start_time, end_time,
          location, user_id, participant_user_ids, notify_users, calendar_id
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .not('meeting_id', 'is', null);

    if (inboxErr) {
      console.error('[MeetingInbox] fetch error:', inboxErr);
      setFetchError('خطا در بارگذاری صندوق ورودی');
      return;
    }

    if (!inboxRows || inboxRows.length === 0) {
      setEntries([]);
      setMeetings({});
      return;
    }

    // Build entries list and meetings map from the joined response
    const newEntries: InboxEntry[] = [];
    const mtgMap: Record<string, InboxMeeting> = {};

    for (const row of inboxRows) {
      const mtg = (row as any).meeting as InboxMeeting | null;
      if (!mtg) continue; // meeting was deleted or RLS blocked it
      newEntries.push({
        id: row.id,
        meeting_id: row.meeting_id,
        status: row.status as InboxEntry['status'],
        delegate_to: row.delegate_to,
      });
      mtgMap[mtg.id] = mtg;
    }

    setEntries(newEntries);
    setMeetings(mtgMap);

    const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email');
    setAllProfiles(profs || []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh when meeting_inbox changes (new invites from organizers)
  useEffect(() => {
    const channel = supabase
      .channel(`meeting-inbox-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_inbox' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDelegateForEntry(null);
        setDeclineConfirmEntry(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAccept = async (entry: InboxEntry) => {
    const meeting = meetings[entry.meeting_id];
    if (!meeting || !currentUserId) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('meeting_inbox')
        .update({ status: 'accepted' })
        .eq('id', entry.id);
      if (error) throw error;

      // Notify organizer
      await insertNotification({
        userId: meeting.user_id,
        category: 'meeting',
        eventType: getMeetingTemplateKey('organizer', 'confirmed'),
        fallbackTitle: 'تأیید شرکت در جلسه',
        fallbackMessage: `${getProfileName(currentUserId)} شرکت در جلسه «${meeting.subject}» را تأیید کرد`,
        placeholders: {
          meeting_subject: meeting.subject,
          meeting_date: formatMeetingDate(meeting),
          start_time: meeting.start_time || '',
          end_time: meeting.end_time || '',
          participant_name: getProfileName(currentUserId),
          recipient_greeting: `${getProfileName(meeting.user_id)} گرامی`,
          full_name: getProfileName(meeting.user_id),
          organizer_name: getProfileName(meeting.user_id),
          location: meeting.location || '',
        },
        senderId: currentUserId,
        senderName: getProfileName(currentUserId),
        actionUrl: 'calendar',
      });

      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setMeetings(prev => { const n = { ...prev }; delete n[entry.meeting_id]; return n; });
      toast.success(`جلسه «${meeting.subject}» تأیید شد و در تقویم ثبت شد`);
    } catch {
      toast.error('خطا در تأیید جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async (entry: InboxEntry) => {
    const meeting = meetings[entry.meeting_id];
    if (!meeting || !currentUserId) return;

    setLoading(true);
    setDeclineConfirmEntry(null);
    try {
      // 1. Mark inbox entry as declined
      const { error: inboxErr } = await supabase
        .from('meeting_inbox')
        .update({ status: 'declined' })
        .eq('id', entry.id);
      if (inboxErr) throw inboxErr;

      // 2. Flag the meeting as rejected so creator sees it needs attention
      //    (SECURITY DEFINER function — participant cannot update meetings directly)
      await supabase.rpc('flag_meeting_rejected', { p_meeting_id: meeting.id });

      // 3. Notify organizer and direct them to meeting management
      await insertNotification({
        userId: meeting.user_id,
        category: 'meeting',
        eventType: getMeetingTemplateKey('organizer', 'declined'),
        fallbackTitle: 'رد دعوت جلسه',
        fallbackMessage: `${getProfileName(currentUserId)} دعوت به جلسه «${meeting.subject}» را رد کرد`,
        placeholders: {
          meeting_subject: meeting.subject,
          meeting_date: formatMeetingDate(meeting),
          start_time: meeting.start_time || '',
          end_time: meeting.end_time || '',
          participant_name: getProfileName(currentUserId),
          recipient_greeting: `${getProfileName(meeting.user_id)} گرامی`,
          full_name: getProfileName(meeting.user_id),
          organizer_name: getProfileName(meeting.user_id),
          location: meeting.location || '',
        },
        senderId: currentUserId,
        senderName: getProfileName(currentUserId),
        actionUrl: 'meetings',
      });

      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setMeetings(prev => { const n = { ...prev }; delete n[entry.meeting_id]; return n; });
      toast.success(`دعوت به جلسه «${meeting.subject}» رد شد`);
    } catch {
      toast.error('خطا در رد کردن جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleDelegate = async (entry: InboxEntry, delegateToId: string) => {
    const meeting = meetings[entry.meeting_id];
    if (!meeting || !currentUserId) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delegate-meeting`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            meeting_id: meeting.id,
            delegate_to_id: delegateToId,
            inbox_entry_id: entry.id,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'delegation failed');
      }

      const myName = getProfileName(currentUserId);
      const delegateName = getProfileName(delegateToId);

      await insertNotification({
        userId: delegateToId,
        category: 'meeting',
        eventType: getMeetingTemplateKey('representative', 'invite'),
        fallbackTitle: 'انتخاب به عنوان جانشین',
        fallbackMessage: `شما به عنوان جانشین برای جلسه «${meeting.subject}» انتخاب شده‌اید`,
        placeholders: {
          meeting_subject: meeting.subject,
          meeting_date: formatMeetingDate(meeting),
          start_time: meeting.start_time?.slice(11, 16) || '',
          end_time: meeting.end_time?.slice(11, 16) || '',
          location: meeting.location || '',
          location_part: meeting.location ? ` | ${meeting.location}` : '',
          full_name: delegateName,
          recipient_greeting: `${delegateName} گرامی`,
          organizer_name: myName,
          represented_person_name: myName,
          join_link: meeting.join_link || '',
        },
        senderId: currentUserId,
        actionUrl: 'calendar',
      });

      const allToNotify = [...new Set([
        ...(meeting.notify_users || []),
        ...(meeting.participant_user_ids || []),
        meeting.user_id,
      ])].filter(id => id !== currentUserId && id !== delegateToId);

      await Promise.all(allToNotify.map(uid =>
        insertNotification({
          userId: uid,
          category: 'meeting',
          eventType: 'change',
          fallbackTitle: 'تغییر جانشین در جلسه',
          fallbackMessage: `کاربر ${myName} برای جلسه «${meeting.subject}»، کاربر ${delegateName} را به عنوان جانشین انتخاب کرد`,
          placeholders: {
            meeting_subject: meeting.subject,
            meeting_date: formatMeetingDate(meeting),
            start_time: meeting.start_time?.slice(11, 16) || '',
            end_time: meeting.end_time?.slice(11, 16) || '',
            location: meeting.location || '',
            location_part: meeting.location ? ` | ${meeting.location}` : '',
            full_name: getProfileName(uid),
            recipient_greeting: getProfileName(uid) ? `${getProfileName(uid)} گرامی` : 'همکار گرامی',
            organizer_name: myName,
            represented_person_name: myName,
          },
          senderId: currentUserId,
          actionUrl: 'calendar',
        })
      ));

      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setMeetings(prev => { const n = { ...prev }; delete n[entry.meeting_id]; return n; });
      setDelegateForEntry(null);
      setOpen(false);
      toast.success(`جانشین به ${delegateName} تغییر یافت`);
    } catch {
      toast.error('خطا در ثبت جانشین');
    } finally {
      setLoading(false);
    }
  };

  const getProfileName = (uid: string) =>
    allProfiles.find(p => p.user_id === uid)?.full_name ||
    allProfiles.find(p => p.user_id === uid)?.email ||
    '—';

  const toggleUnit = (key: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const isSearching = delegateSearch.trim().length > 0;

  const filteredDelegates = orgAllUsers.filter(u =>
    (u.full_name || '').toLowerCase().includes(delegateSearch.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(delegateSearch.toLowerCase())
  );

  return (
    <>
      {/* FAB */}
      <button
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={() => { if (!wasDragged()) { setOpen(v => !v); setDelegateForEntry(null); setDeclineConfirmEntry(null); } }}
        className={`fixed z-[60] rounded-full shadow-xl flex items-center justify-center transition-all duration-200 select-none ${open ? 'opacity-0 pointer-events-none scale-0' : 'opacity-80 hover:opacity-100 hover:scale-105'}`}
        style={{ top: fabPos.y, left: fabPos.x, width: 38, height: 38, background: 'linear-gradient(135deg,#059669,#0d9488)', boxShadow: '0 6px 20px rgba(5,150,105,0.4)', cursor: 'grab', touchAction: 'none' }}
        title="صندوق ورودی جلسات"
      >
        <Inbox className="w-[18px] h-[18px] text-white pointer-events-none" />
        {pendingCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5 border-2 border-white leading-none">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-[60] w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ ...panelStyle(fabPos, 380, 620, 38), maxHeight: 620, boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg,#059669,#0d9488)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <Inbox className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">صندوق ورودی جلسات</p>
                <p className="text-xs text-emerald-100">
                  {pendingCount === 0 ? 'هیچ جلسه‌ای در انتظار نیست' : `${pendingCount} جلسه در انتظار پاسخ`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchData()}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white flex-shrink-0 transition-colors"
                title="بارگذاری مجدد"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setOpen(false); setDelegateForEntry(null); setDeclineConfirmEntry(null); }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white flex-shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-gray-800">

            {/* Delegate picker sub-panel */}
            {delegateForEntry ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20 flex-shrink-0">
                  <button
                    onClick={() => setDelegateForEntry(null)}
                    className="p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 flex-shrink-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">انتخاب جانشین</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                      {meetings[delegateForEntry.meeting_id]?.subject || ''}
                    </p>
                  </div>
                </div>
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
                  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2">
                    <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={delegateSearch}
                      onChange={e => setDelegateSearch(e.target.value)}
                      placeholder="جستجوی کاربر..."
                      className="flex-1 bg-transparent text-sm text-gray-700 dark:text-white outline-none placeholder-gray-400"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {isSearching ? (
                    filteredDelegates.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">کاربری یافت نشد</p>
                    ) : filteredDelegates.map(u => (
                      <button
                        key={u.user_id}
                        onClick={() => handleDelegate(delegateForEntry, u.user_id)}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0 disabled:opacity-50 text-right"
                      >
                        <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                            {(u.full_name || u.email || '?').charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{u.position_title || u.email}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    orgGroups.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">کاربری یافت نشد</p>
                    ) : orgGroups.map(group => {
                      const key = group.unit_id || '__no_unit__';
                      const isOpen = expandedUnits.has(key);
                      return (
                        <div key={key}>
                          <button
                            onClick={() => toggleUnit(key)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-right border-b border-gray-100 dark:border-gray-700"
                          >
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                            <Building2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            <span className="flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">{group.unit_name}</span>
                            <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded-full flex-shrink-0">{group.users.length}</span>
                          </button>
                          {isOpen && group.users.map(u => (
                            <button
                              key={u.user_id}
                              onClick={() => handleDelegate(delegateForEntry, u.user_id)}
                              disabled={loading}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0 disabled:opacity-50 text-right"
                            >
                              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                                  {(u.full_name || u.email || '?').charAt(0)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0 text-right">
                                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                                <p className="text-xs text-gray-400 truncate">{u.position_title || u.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : declineConfirmEntry ? (
              /* Decline confirmation sub-panel */
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-red-50 dark:bg-red-900/20 flex-shrink-0">
                  <button
                    onClick={() => setDeclineConfirmEntry(null)}
                    className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 flex-shrink-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-300">رد دعوت</p>
                    <p className="text-xs text-red-600 dark:text-red-400 truncate">
                      {meetings[declineConfirmEntry.meeting_id]?.subject || ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center flex-1 px-6 py-8 gap-5">
                  <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white mb-1">آیا مطمئن هستید؟</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      با رد این دعوت، جلسه از تقویم شما حذف می‌شود و سازنده جلسه مطلع خواهد شد.
                    </p>
                  </div>
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => handleDecline(declineConfirmEntry)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
                    >
                      <XCircle className="w-4 h-4" />
                      بله، رد کن
                    </button>
                    <button
                      onClick={() => setDeclineConfirmEntry(null)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Meeting list */
              <div className="overflow-y-auto flex-1">
                {fetchError ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 px-4">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <p className="text-sm text-red-500 dark:text-red-400 text-center">{fetchError}</p>
                    <button
                      onClick={() => fetchData()}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-sm font-medium hover:bg-emerald-100 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      تلاش مجدد
                    </button>
                  </div>
                ) : entries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 px-4">
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                      <Inbox className="w-8 h-8 text-gray-300 dark:text-gray-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 text-center">صندوق ورودی خالی است</p>
                    <p className="text-xs text-gray-400 text-center">جلساتی که دیگران برای شما ثبت کرده‌اند اینجا نمایش داده می‌شوند</p>
                  </div>
                ) : (
                  entries.map(entry => {
                    const meeting = meetings[entry.meeting_id];
                    if (!meeting) return null;
                    const creatorName = getProfileName(meeting.user_id);
                    const participantNames = (meeting.participant_user_ids || [])
                      .filter(id => id !== currentUserId)
                      .map(id => getProfileName(id))
                      .filter(n => n !== '—');

                    return (
                      <div key={entry.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0 p-4">
                        {/* Creator badge */}
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                              {creatorName.charAt(0)}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">دعوت از طرف</span>
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{creatorName}</span>
                        </div>

                        {/* Title */}
                        <p className="text-sm font-bold text-gray-800 dark:text-white mb-2 leading-tight">{meeting.subject}</p>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-2">
                          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                            {gregorianToJalali(meeting.request_date) || meeting.request_date}
                          </span>
                          {meeting.start_time && (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <Clock className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                              {meeting.start_time}{meeting.end_time ? ` — ${meeting.end_time}` : ''}
                            </span>
                          )}
                          {meeting.location && (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 col-span-2">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                              <span className="truncate">{meeting.location}</span>
                            </span>
                          )}
                        </div>

                        {/* Other participants */}
                        {participantNames.length > 0 && (
                          <div className="flex items-start gap-1.5 mb-3">
                            <Users className="w-3.5 h-3.5 flex-shrink-0 text-gray-400 mt-0.5" />
                            <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                              {participantNames.join('، ')}
                            </span>
                          </div>
                        )}

                        {/* Action buttons — 3 buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccept(entry)}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 active:scale-95"
                          >
                            <Check className="w-3.5 h-3.5" />
                            قبول
                          </button>
                          <button
                            onClick={() => { setDeclineConfirmEntry(entry); }}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 active:scale-95"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            رد کردن
                          </button>
                          <button
                            onClick={() => { setDelegateForEntry(entry); setDelegateSearch(''); }}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 active:scale-95"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            جانشین
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

