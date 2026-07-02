import { useState, useEffect, useRef } from 'react';
import { X, Clock, MapPin, Users, User, Phone, Bell, RefreshCw, UserPlus, Share2, ExternalLink, Trash2, CreditCard as Edit2, Video, Copy, Check, FileText, Image, CalendarDays, CircleCheck as CheckCircle2, Circle as XCircle, Circle as HelpCircle, UserCheck, ClipboardList } from 'lucide-react';
import { MeetingData, CalendarEntry, ProfileEntry } from './types';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { toPng } from 'html-to-image';
import moment from 'moment-jalaali';

interface AgendaItem {
  id: string;
  title: string;
  presenter: string | null;
  duration_minutes: number | null;
  sort_order: number;
}

interface Props {
  meeting: MeetingData;
  currentUserId: string | null;
  allProfiles: ProfileEntry[];
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  getMeetingColor: (m: MeetingData) => string;
  onClose: () => void;
  onEdit: (m: MeetingData) => void;
  onDelete: (id: string, deleteRepeating?: boolean) => void;
  onShare: (m: MeetingData) => void;
  onGoogleCalendar: (m: MeetingData) => void;
}

export function MeetingDetailModal({
  meeting: m, currentUserId, allProfiles, calendars, subscribedCalendars,
  getMeetingColor, onClose, onEdit, onDelete, onGoogleCalendar,
}: Props) {
  const isOwner = m.user_id === currentUserId;
  const isManager = m.meeting_manager === currentUserId;
  const canEdit = isOwner || isManager;
  const creator = allProfiles.find(p => p.user_id === m.user_id);
  const cal = [...calendars, ...subscribedCalendars].find(c => c.id === m.calendar_id);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareChoice, setShowShareChoice] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);

  // Per-participant inbox status — only fetched for the meeting owner
  const [participantStatuses, setParticipantStatuses] = useState<Record<string, 'pending' | 'accepted' | 'declined' | 'delegated'>>({});

  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);

  useEffect(() => {
    supabase
      .from('meeting_agenda_items')
      .select('id, title, presenter, duration_minutes, sort_order')
      .eq('meeting_id', m.id)
      .order('sort_order')
      .then(({ data }) => { if (data) setAgendaItems(data as AgendaItem[]); });
  }, [m.id]);

  useEffect(() => {
    if (!isOwner || !m.participant_user_ids?.length) return;
    supabase
      .from('meeting_inbox')
      .select('user_id, status')
      .eq('meeting_id', m.id)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, 'pending' | 'accepted' | 'declined' | 'delegated'> = {};
        for (const row of data) map[row.user_id] = row.status;
        setParticipantStatuses(map);
      });
  }, [m.id, isOwner, m.participant_user_ids?.length]);

  // Determine if the current user is a participant (can see join buttons)
  const isParticipant = currentUserId && (
    m.user_id === currentUserId ||
    (m.participant_user_ids || []).includes(currentUserId) ||
    (m.notify_users || []).includes(currentUserId)
  );

  useEffect(() => {
    if (m.is_online && m.conference_room_id) {
      supabase
        .from('conference_rooms')
        .select('code')
        .eq('id', m.conference_room_id)
        .maybeSingle()
        .then(({ data }) => { if (data) setRoomCode(data.code); });
    }
  }, [m.conference_room_id, m.is_online]);

  // Check if it's within 10 minutes before start time
  const canJoinNow = (): boolean => {
    if (!m.start_time || !m.request_date) return false;
    try {
      const dateStr = m.request_date.slice(0, 10);
      const [h, min] = m.start_time.split(':').map(Number);
      const meetingStart = new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`);
      const tenMinBefore = new Date(meetingStart.getTime() - 10 * 60 * 1000);
      return new Date() >= tenMinBefore;
    } catch {
      return false;
    }
  };

  const joinAllowed = canJoinNow();

  const handleJoinRoom = () => {
    if (!roomCode) return;
    if (!joinAllowed) {
      toast.error('ورود به جلسه تا ۱۰ دقیقه قبل از شروع امکان‌پذیر نیست');
      return;
    }
    window.open(`/?conference=${roomCode}`, '_blank');
  };

  const guestLink = roomCode ? `${window.location.origin}/?conference=${roomCode}` : null;

  const copyGuestLink = async () => {
    if (!guestLink) return;
    try {
      await navigator.clipboard.writeText(guestLink);
      setCopiedLink(true);
      toast.success('لینک مهمان کپی شد');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast.error('خطا در کپی لینک');
    }
  };

  const getMeetingTimeInfo = (): string => {
    if (!m.start_time || !m.request_date) return '';
    try {
      const dateStr = m.request_date.slice(0, 10);
      const [h, min] = m.start_time.split(':').map(Number);
      const meetingStart = new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`);
      const tenMinBefore = new Date(meetingStart.getTime() - 10 * 60 * 1000);
      const now = new Date();
      if (now < tenMinBefore) {
        const diff = Math.ceil((tenMinBefore.getTime() - now.getTime()) / 60000);
        return `ورود ${diff} دقیقه دیگر فعال می‌شود`;
      }
      return '';
    } catch {
      return '';
    }
  };

const getJalaliDate = (): string => {
  if (!m.request_date) return '';

  try {
    const d = moment.utc(m.request_date).utcOffset(210);

    const jy = d.jYear();
    const jm = d.jMonth() + 1;
    const jd = d.jDate();

    const monthNames = [
      'فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور',
      'مهر','آبان','آذر','دی','بهمن','اسفند'
    ];

    return `${jd} ${monthNames[jm - 1]} ${jy}`;
  } catch {
    return '';
  }
};

  const buildShareText = (): string => {
    const participantNames = (m.participant_user_ids || [])
      .map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8))
      .join('، ');
    const notifyNames = ((m.notify_users || []) as string[])
      .map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8))
      .join('، ');
    const externalNames = (m.external_participants || []).join('، ');
    const creatorName = creator?.full_name || creator?.email || 'کاربر ناشناس';
    const timeStr = m.start_time && m.end_time ? `${m.start_time} - ${m.end_time}` : '';
    const dateStr = getJalaliDate();

    const lines = [
      `📋 جلسه: ${m.subject}`,
      `👤 ایجادکننده: ${creatorName}`,
      dateStr ? `📅 تاریخ: ${dateStr}` : '',
      timeStr ? `⏰ زمان: ${timeStr}` : '',
      m.location ? `📍 محل: ${m.location}` : '',
      m.representative ? `🧑‍💼 نماینده: ${m.representative}` : '',
      m.phone ? `📞 تماس: ${m.phone}` : '',
      participantNames ? `👥 شرکت‌کنندگان: ${participantNames}` : '',
      notifyNames ? `🔔 مطلعین: ${notifyNames}` : '',
      externalNames ? `🌐 خارج سازمان: ${externalNames}` : '',
      roomCode ? `🔗 لینک آنلاین: ${window.location.origin}/?conference=${roomCode}` : '',
      m.notes ? `📝 یادداشت: ${m.notes}` : '',
      agendaItems.length > 0
        ? `📌 دستور جلسه:\n` + agendaItems.map((item, idx) => {
            const parts = [`${idx + 1}. ${item.title}`];
            if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
            if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
            return parts.join(' | ');
          }).join('\n')
        : '',
    ].filter(Boolean).join('\n');

    return lines;
  };

  const handleShareAsText = async () => {
    setShowShareChoice(false);
    const text = buildShareText();
    if (navigator.share) {
      try { await navigator.share({ title: m.subject, text }); } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(text); toast.success('اطلاعات جلسه کپی شد'); }
      catch { toast.error('اشتراک‌گذاری پشتیبانی نمی‌شود'); }
    }
  };

  const handleShareAsImage = async () => {
    setShowShareChoice(false);
    if (!shareCardRef.current) { toast.error('خطا در تولید تصویر'); return; }
    try {
      toast.loading('در حال تولید تصویر...');
      const dataUrl = await toPng(shareCardRef.current, { quality: 0.95, pixelRatio: 2 });
      toast.dismiss();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'meeting.png', { type: 'image/png' });
      if (navigator.share && (navigator.canShare?.({ files: [file] }) ?? false)) {
        await navigator.share({ title: m.subject, files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `meeting-${m.id.slice(0, 8)}.png`;
        a.click();
        toast.success('تصویر دانلود شد');
      }
    } catch {
      toast.dismiss();
      toast.error('خطا در تولید تصویر');
    }
  };

  const handleNativeShare = () => {
    setShowShareChoice(true);
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute inset-y-0 left-0 w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInLeft"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 text-white flex-shrink-0" style={{ backgroundColor: getMeetingColor(m) }}>
          <h3 className="text-lg font-bold leading-tight flex-1 ml-2">{m.subject}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Creator */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <User className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">ایجاد کننده جلسه</p>
              <p className="text-sm font-semibold dark:text-white">
                {creator?.full_name || creator?.email || 'کاربر ناشناس'}
              </p>
            </div>
          </div>

          {/* Date */}
          {m.request_date && getJalaliDate() && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <CalendarDays className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400 mb-0.5">تاریخ جلسه</p>
                <p className="text-sm font-semibold dark:text-white">{getJalaliDate()}</p>
              </div>
            </div>
          )}

          {/* Time */}
          {(m.start_time || m.end_time) && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400 mb-0.5">زمان جلسه</p>
                <p className="text-sm font-semibold dark:text-white">{m.start_time} — {m.end_time}</p>
              </div>
            </div>
          )}

          {/* Calendar */}
          {cal && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: cal.color }} />
              <div>
                <p className="text-xs text-gray-400 mb-0.5">تقویم</p>
                <p className="text-sm font-semibold dark:text-white">{cal.name}</p>
              </div>
            </div>
          )}

          {/* Location */}
          {m.location && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400 mb-0.5">محل برگزاری</p>
                <p className="text-sm font-semibold dark:text-white">{m.location}</p>
              </div>
            </div>
          )}

          {/* Representative */}
          {m.representative && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <User className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-400 mb-0.5">نماینده</p>
                <p className="text-sm font-semibold dark:text-white">{m.representative}</p>
                {m.phone && (
                  <a href={`tel:${m.phone}`} className="text-xs text-blue-500 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />{m.phone}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Participants */}
          {m.participant_user_ids && m.participant_user_ids.length > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-gray-400" />
                <p className="text-xs text-gray-400 font-medium">شرکت‌کنندگان ({m.participant_user_ids.length})</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {m.participant_user_ids.map(uid => {
                  const p = allProfiles.find(x => x.user_id === uid);
                  const status = participantStatuses[uid];
                  const statusBadge = isOwner && status ? (() => {
                    if (status === 'accepted') return (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 className="w-2.5 h-2.5" />قبول
                      </span>
                    );
                    if (status === 'declined') return (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <XCircle className="w-2.5 h-2.5" />رد
                      </span>
                    );
                    if (status === 'delegated') return (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <UserCheck className="w-2.5 h-2.5" />جانشین
                      </span>
                    );
                    return (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <HelpCircle className="w-2.5 h-2.5" />در انتظار
                      </span>
                    );
                  })() : null;
                  return (
                    <div key={uid} className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2.5 py-1 rounded-full text-xs font-medium flex-1 min-w-0">
                        <User className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{p?.full_name || p?.email || uid.slice(0, 8)}</span>
                      </span>
                      {statusBadge}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* External */}
          {m.external_participants && m.external_participants.length > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-gray-400" />
                <p className="text-xs text-gray-400 font-medium">افراد خارج سازمان</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.external_participants.map(name => (
                  <span key={name} className="inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-2.5 py-1 rounded-full text-xs font-medium">{name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Notify */}
          {m.notify_users && m.notify_users.length > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Bell className="w-4 h-4 text-gray-400" />
                <p className="text-xs text-gray-400 font-medium">مطلعین</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.notify_users.map(uid => {
                  const p = allProfiles.find(x => x.user_id === uid);
                  return (
                    <span key={uid} className="inline-flex items-center gap-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-full text-xs font-medium">
                      {p?.full_name || p?.email || uid.slice(0, 8)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reminder */}
          {m.reminder_minutes && m.reminder_minutes > 0 && (
            <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
              <Bell className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-0.5">یادآوری</p>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {m.reminder_minutes >= 60 ? `${m.reminder_minutes / 60} ساعت` : `${m.reminder_minutes} دقیقه`} قبل از جلسه
                </p>
              </div>
            </div>
          )}

          {/* Repeat */}
          {m.repeat_type && m.repeat_type !== 'none' && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
              <RefreshCw className="w-5 h-5 text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-blue-500 mb-0.5">تکرار</p>
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {m.repeat_type === 'weekly' ? 'هفتگی' : 'ماهیانه'}
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          {m.notes && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <p className="text-xs text-gray-400 mb-1.5">یادداشت</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{m.notes}</p>
            </div>
          )}

          {/* Agenda */}
          {agendaItems.length > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex items-center gap-2 mb-2.5">
                <ClipboardList className="w-4 h-4 text-gray-400" />
                <p className="text-xs text-gray-400 font-medium">دستور جلسه ({agendaItems.length} آیتم)</p>
              </div>
              <div className="space-y-2">
                {agendaItems.map((item, idx) => (
                  <div key={item.id} className="flex items-start gap-2.5 p-2.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-100 dark:border-gray-600">
                    <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {item.presenter && (
                          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <UserCheck className="w-3 h-3" />{item.presenter}
                          </span>
                        )}
                        {item.duration_minutes && (
                          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <Clock className="w-3 h-3" />{item.duration_minutes} دقیقه
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Online meeting section */}
          {m.is_online && isParticipant && (
            <div className="p-4 bg-sky-50 dark:bg-sky-900/20 rounded-xl border border-sky-200 dark:border-sky-700 space-y-3">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-sky-600 dark:text-sky-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">جلسه آنلاین</p>
                  {!joinAllowed && getMeetingTimeInfo() && (
                    <p className="text-xs text-sky-500 dark:text-sky-400 mt-0.5">{getMeetingTimeInfo()}</p>
                  )}
                </div>
              </div>

              {roomCode ? (
                <div className="space-y-2">
                  {/* Join as internal user */}
                  <button
                    onClick={handleJoinRoom}
                    disabled={!joinAllowed}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${joinAllowed ? 'bg-sky-500 hover:bg-sky-600 text-white' : 'bg-sky-200 dark:bg-sky-800/50 text-sky-400 dark:text-sky-500 cursor-not-allowed'}`}
                  >
                    <Video className="w-4 h-4" />
                    ورود مستقیم همکاران سامانه
                  </button>

                  {/* Guest link — always copyable */}
                  <div className="flex items-stretch rounded-xl border overflow-hidden border-sky-300 dark:border-sky-600">
                    <div className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 text-xs font-mono text-gray-500 dark:text-gray-400 truncate flex items-center">
                      {guestLink ? guestLink.replace('https://', '').slice(0, 40) + (guestLink.length > 50 ? '...' : '') : '—'}
                    </div>
                    <button
                      onClick={copyGuestLink}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium flex-shrink-0 transition-colors bg-sky-100 dark:bg-sky-800/60 text-sky-700 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-700/60"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedLink ? 'کپی شد' : 'لینک مهمان'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-sky-500">در حال دریافت اطلاعات اتاق...</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 grid grid-cols-2 gap-2 flex-shrink-0">
          {canEdit && (
            <button onClick={() => onEdit(m)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
              <Edit2 className="w-4 h-4" />ویرایش
            </button>
          )}
          <button onClick={handleNativeShare} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm font-medium hover:bg-green-100 transition-colors">
            <Share2 className="w-4 h-4" />اشتراک‌گذاری
          </button>
          <button onClick={() => onGoogleCalendar(m)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-sm font-medium hover:bg-orange-100 transition-colors">
            <ExternalLink className="w-4 h-4" />گوگل کلندر
          </button>
          <button onClick={() => onDelete(m.id)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-100 transition-colors">
            <Trash2 className="w-4 h-4" />
            {isOwner ? 'حذف برای همه' : 'حذف از تقویم من'}
          </button>
          {isOwner && m.repeat_type && m.repeat_type !== 'none' && (
            <button onClick={() => onDelete(m.id, true)} className="col-span-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-100 transition-colors border border-red-200 dark:border-red-800">
              <Trash2 className="w-4 h-4" />حذف تمام جلسات تکراری
            </button>
          )}
        </div>
      </div>

      {/* Share choice modal */}
      {showShareChoice && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50" onClick={() => setShowShareChoice(false)} dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl w-full max-w-md p-5 pb-8 space-y-3 animate-slideInLeft" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-gray-800 dark:text-white">اشتراک‌گذاری جلسه</h4>
              <button onClick={() => setShowShareChoice(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">نوع اشتراک‌گذاری را انتخاب کنید:</p>
            <button onClick={handleShareAsText}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-white text-sm">به صورت متن</p>
                <p className="text-xs text-gray-400 mt-0.5">ارسال متن جلسه به اپلیکیشن‌های مختلف</p>
              </div>
            </button>
            <button onClick={handleShareAsImage}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right">
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <Image className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-white text-sm">به صورت تصویر</p>
                <p className="text-xs text-gray-400 mt-0.5">دانلود یا ارسال تصویر کارت جلسه</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Hidden card used for image generation */}
      <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', zIndex: -1 }}>
        <div ref={shareCardRef} style={{ width: 360, backgroundColor: '#fff', fontFamily: 'Vazirmatn, system-ui, sans-serif', direction: 'rtl', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <div style={{ backgroundColor: getMeetingColor(m), padding: '16px 20px' }}>
            <p style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>{m.subject}</p>
            {getJalaliDate() && (
              <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, margin: '4px 0 0' }}>{getJalaliDate()}</p>
            )}
            {(m.start_time || m.end_time) && (
              <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, margin: '4px 0 0' }}>{m.start_time} — {m.end_time}</p>
            )}
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(() => {
              const creatorName = isOwner ? 'شما' : (creator?.full_name || creator?.email || '');
              const participantNames = (m.participant_user_ids || []).map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0,8)).join('، ');
              const notifyNames = ((m.notify_users || []) as string[]).map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0,8)).join('، ');
              const extNames = (m.external_participants || []).join('، ');
              const rows = [
                { label: 'ایجادکننده', value: creatorName },
                { label: 'تاریخ', value: getJalaliDate() },
                { label: 'زمان', value: m.start_time && m.end_time ? `${m.start_time} — ${m.end_time}` : '' },
                { label: 'محل برگزاری', value: m.location },
                { label: 'نماینده', value: m.representative },
                { label: 'تلفن تماس', value: m.phone },
                { label: 'شرکت‌کنندگان', value: participantNames },
                { label: 'مطلعین', value: notifyNames },
                { label: 'خارج سازمان', value: extNames },
                { label: 'لینک آنلاین', value: roomCode ? `${window.location.origin}/?conference=${roomCode}` : '' },
                { label: 'یادداشت', value: m.notes },
                { label: 'دستور جلسه', value: agendaItems.length > 0
                    ? agendaItems.map((item, idx) => {
                        const parts = [`${idx + 1}. ${item.title}`];
                        if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
                        if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
                        return parts.join(' | ');
                      }).join('\n')
                    : '' },
              ].filter(r => r.value);
              return rows.map(r => (
                <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: '#6b7280', fontSize: 12, minWidth: 96, flexShrink: 0 }}>{r.label}:</span>
                  <span style={{ color: '#111827', fontSize: 12, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{r.value}</span>
                </div>
              ));
            })()}
          </div>
          <div style={{ padding: '10px 20px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
            <p style={{ color: '#9ca3af', fontSize: 11, margin: 0, textAlign: 'center' }}>سیستم مدیریت جلسات</p>
          </div>
        </div>
      </div>
    </div>
  );
}
