import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Check, UserCheck, X, MapPin, Clock, Calendar, Search, ChevronRight, Users, Building2, ChevronDown, Circle as XCircle, CircleAlert as AlertCircle, RefreshCw, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { insertNotification } from '../lib/notifications';
import { getMeetingTemplateKey } from '../config/templateCatalog';
import toast from 'react-hot-toast';
import { useOrgUsers } from '../lib/useOrgUsers';
import { useDraggableFab, panelStyle } from '../lib/useDraggableFab';
import { gregorianToJalali } from '../lib/sparkDateUtils';

function formatJalaliDate(value?: string | null): string {
  if (!value) return 'تاریخ نامشخص';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاریخ نامشخص';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

function formatMeetingDate(meeting: { request_date?: string | null }): string {
  if (!meeting.request_date) return '';
  return formatJalaliDate(meeting.request_date);
}

function formatConflictTime(value?: string | null): string {
  if (!value) return '';
  const match = String(value).match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
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

export function MeetingInboxButton() {
  const [open, setOpen] = useState(false);
  const { pos: fabPos, onDragStart, wasDragged } = useDraggableFab('inbox-fab-pos', 'right', 38);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [meetings, setMeetings] = useState<Record<string, InboxMeeting>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [delegateForEntry, setDelegateForEntry] = useState<InboxEntry | null>(null);
  const [declineConfirmEntry, setDeclineConfirmEntry] = useState<InboxEntry | null>(null);
  const [conflictEntry, setConflictEntry] = useState<InboxEntry | null>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [conflictMeetingId, setConflictMeetingId] = useState<string | null>(null);
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
    const handleOpenDelegate = async (event: Event) => {
      const meetingId = (event as CustomEvent<{ meetingId?: string }>).detail?.meetingId;
      if (!meetingId) return;

      let entry = entries.find(item => item.meeting_id === meetingId) || null;
      if (!entry) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: row, error } = await supabase
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
          .eq('meeting_id', meetingId)
          .eq('user_id', user.id)
          .in('status', ['pending', 'accepted'])
          .maybeSingle();

        if (error || !row) {
          toast.error('این جلسه دیگر قابل واگذاری نیست');
          fetchData();
          return;
        }

        const meeting = (row as any).meeting as InboxMeeting | null;
        if (!meeting) {
          toast.error('اطلاعات جلسه در دسترس نیست');
          return;
        }

        entry = {
          id: row.id,
          meeting_id: row.meeting_id,
          status: row.status as InboxEntry['status'],
          delegate_to: row.delegate_to,
        };
        if (entry.status === 'pending') {
          setEntries(prev => prev.some(item => item.id === entry!.id) ? prev : [...prev, entry!]);
        }
        setMeetings(prev => ({ ...prev, [meeting.id]: meeting }));
      }

      setDelegateSearch('');
      setExpandedUnits(new Set());
      setDelegateForEntry(entry);
      setOpen(true);
    };

    window.addEventListener('spark:open-meeting-delegate', handleOpenDelegate);
    return () => window.removeEventListener('spark:open-meeting-delegate', handleOpenDelegate);
  }, [entries, fetchData]);

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
      const { data, error } = await supabase.rpc('accept_meeting_invitation_v2', {
        p_meeting_inbox_id: entry.id,
        p_allow_conflict: false,
      });
      if (error) throw error;
      const result = (data || []) as any[];
      const row = Array.isArray(result) ? result[0] : result;
      if (row?.requires_confirmation) {
        setConflictEntry(entry);
        setConflicts(row.conflicts || []);
        setConflictMeetingId(row.meeting_id || null);
        return;
      }
      if (!row?.accepted) {
        throw new Error('ACCEPT_FAILED');
      }
      await afterAccept(entry, meeting);
    } catch {
      toast.error('خطا در تأیید جلسه');
    } finally {
      setLoading(false);
    }
  };

  const confirmAcceptWithConflict = async () => {
    if (!conflictEntry) return;
    const meeting = meetings[conflictEntry.meeting_id];
    if (!meeting || !currentUserId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('accept_meeting_invitation_v2', {
        p_meeting_inbox_id: conflictEntry.id,
        p_allow_conflict: true,
      });
      if (error) throw error;
      const result = (data || []) as any[];
      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.accepted) throw new Error('ACCEPT_FAILED');
      await afterAccept(conflictEntry, meeting);
      setConflictEntry(null);
      setConflicts([]);
      setConflictMeetingId(null);
    } catch {
      toast.error('خطا در تأیید جلسه');
    } finally {
      setLoading(false);
    }
  };

  const afterAccept = async (entry: InboxEntry, meeting: any) => {
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
      // Fetch the current updated_at for optimistic concurrency
      const { data: inboxRow } = await supabase
        .from('meeting_inbox')
        .select('updated_at, created_at')
        .eq('id', entry.id)
        .maybeSingle();

      const expectedUpdatedAt = inboxRow?.updated_at || inboxRow?.created_at || null;

      const { data, error: rpcError } = await supabase.rpc('assign_meeting_invitation_delegate', {
        p_meeting_inbox_id: entry.id,
        p_delegate_user_id: delegateToId,
        p_expected_updated_at: expectedUpdatedAt,
      });

      if (rpcError) {
        toast.error('خطا در ارتباط با سرور');
        return;
      }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AUTHENTICATED: 'احراز هویت نشده‌اید.',
          INBOX_NOT_FOUND: 'دعوت یافت نشد.',
          NOT_INBOX_OWNER: 'این دعوت متعلق به شما نیست.',
          CANNOT_DELEGATE_TO_SELF: 'نمی‌توانید خودتان را به‌عنوان جانشین انتخاب کنید.',
          INBOX_NOT_PENDING: 'این دعوت دیگر در وضعیت انتظار نیست.',
          DELEGATE_ALREADY_ASSIGNED: 'برای این دعوت قبلاً جانشین انتخاب شده است.',
          INBOX_VERSION_CONFLICT: 'اطلاعات تغییر کرده است. صفحه را تازه‌سازی کنید.',
          MEETING_NOT_FOUND: 'جلسه یافت نشد.',
          DELEGATE_IS_ORGANIZER: 'سازنده جلسه نمی‌تواند جانشین شود.',
          DELEGATE_ALREADY_PARTICIPANT: 'این کاربر از قبل شرکت‌کننده این جلسه است.',
          DELEGATE_ALREADY_INVITED: 'این کاربر از قبل برای این جلسه دعوت شده است.',
          DELEGATE_PROFILE_INVALID: 'پروفایل جانشین معتبر نیست یا فعال نیست.',
          DELEGATE_DIFFERENT_ORG: 'جانشین باید از همان سازمان باشد.',
        };
        toast.error(msgs[data.error_code] || data.message || 'خطا در ثبت جانشین');
        return;
      }

      const delegateName = data?.delegate_name || getProfileName(delegateToId);

      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setMeetings(prev => { const n = { ...prev }; delete n[entry.meeting_id]; return n; });
      setDelegateForEntry(null);
      setOpen(false);
      toast.success(`جانشین «${delegateName}» با موفقیت ثبت شد`);
    } catch {
      toast.error('خطا در ثبت جانشین');
    } finally {
      setLoading(false);
    }
  };

  const getProfileName = (uid: string) =>
    orgAllUsers.find(p => p.user_id === uid)?.full_name || '—';

  const toggleUnit = (key: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const isSearching = delegateSearch.trim().length > 0;

  const filteredDelegates = orgAllUsers.filter(u =>
    (u.full_name || '').toLowerCase().includes(delegateSearch.toLowerCase()) ||
    (u.position_title || '').toLowerCase().includes(delegateSearch.toLowerCase()) ||
    (u.unit_name || '').toLowerCase().includes(delegateSearch.toLowerCase())
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
                    ) : filteredDelegates.map(renderDelegateOption)
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
                          {isOpen && group.users.map(renderDelegateOption)}
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

      {/* Conflict warning modal */}
      {conflictEntry && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
              <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-white">تداخل زمانی جلسه</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">این جلسه با جلسه یا جلسات زیر تداخل زمانی دارد. آیا با وجود تداخل مایل به تأیید جلسه هستید؟</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {conflicts.map((c, i) => {
                const conflictTitle =
                  typeof c.title === 'string' && c.title.trim()
                    ? c.title.trim()
                    : 'موضوع جلسه مشخص نیست';
                const formattedDate = formatJalaliDate(c.meeting_date);
                const start = formatConflictTime(c.start_time);
                const end = formatConflictTime(c.end_time);
                let formattedTimeRange: string;
                if (start && end) formattedTimeRange = `${start} تا ${end}`;
                else if (start) formattedTimeRange = `شروع: ${start}`;
                else formattedTimeRange = 'ساعت نامشخص';
                const renderDelegateOption = (u: (typeof filteredDelegates)[number]) => (
                      <button
                        key={u.user_id}
                        onClick={() => handleDelegate(delegateForEntry, u.user_id)}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0 disabled:opacity-50 text-right"
                      >
                        <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                            {(u.full_name || '?').charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{u.position_title || u.unit_name || ''}</p>
                        </div>
                      </button>
                    );

  return (
                  <div key={i} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-2">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{conflictTitle}</p>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{formattedDate}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{formattedTimeRange}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={confirmAcceptWithConflict}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                تأیید با وجود تداخل
              </button>
              <button
                onClick={() => { setConflictEntry(null); setConflicts([]); setConflictMeetingId(null); }}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

