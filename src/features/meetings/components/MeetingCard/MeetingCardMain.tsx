import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, CreditCard as Edit2, Send, Share2, UserPlus, CalendarPlus, RefreshCw, TriangleAlert as AlertTriangle, Trash2, Image, FileText } from 'lucide-react';
import { DeleteMeetingModal } from './DeleteMeetingModal';
import { MeetingDetails } from './MeetingDetails';
import { ParticipantStatusPanel } from './ParticipantStatusPanel';
import { MeetingShareDialog } from './MeetingShareDialog';
import { MeetingShareCard } from './MeetingShareCard';
import { Meeting } from '../../../../types';
import type { AgendaItem } from '../../../../types';
import { supabase } from '../../../../lib/supabase';
import { sendMeetingToTelegram } from '../../../../lib/telegram';
import { insertNotification } from '../../../../lib/notifications';
import { getMeetingTemplateKey } from '../../../../config/templateCatalog';
import toast from 'react-hot-toast';
import { toPng } from 'html-to-image';
import { ActionsSection } from './ActionsSection';
import { UserSelectorModal } from './UserSelectorModal';
import { CreateMeetingForm } from '../CreateMeetingForm';
import moment from 'moment-jalaali';

interface MeetingCardMainProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
}

// ─── MeetingCardMain ──────────────────────────────────────────────────────────
export function MeetingCardMain({ meeting, onUpdate, onScheduleInCalendar }: MeetingCardMainProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editPrefill, setEditPrefill] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showUserSelector, setShowUserSelector] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Participant inbox statuses (for creator view)
  const [participantStatuses, setParticipantStatuses] = useState<
    Record<string, { status: 'pending' | 'accepted' | 'declined' | 'delegated'; delegate_to?: string | null }>
  >({});
  const [delegateNames, setDelegateNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  React.useEffect(() => {
    if (!meeting.id) return;
    supabase
      .from('meeting_agenda_items')
      .select('*')
      .eq('meeting_id', meeting.id)
      .order('sort_order')
      .then(({ data }) => { if (data) setAgendaItems(data as AgendaItem[]); });
  }, [meeting.id]);

  React.useEffect(() => {
    const isCreator = meeting.user_id && currentUserId && meeting.user_id === currentUserId;
    if (!isCreator || !meeting.id) return;
    const participantIds: string[] = (meeting as any).participant_user_ids ?? [];
    if (participantIds.length === 0) return;

    supabase
      .from('meeting_inbox')
      .select('user_id, status, delegate_to')
      .eq('meeting_id', meeting.id)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, { status: any; delegate_to?: string | null }> = {};
        const delegateIds: string[] = [];
        for (const row of data) {
          map[row.user_id] = { status: row.status, delegate_to: row.delegate_to };
          if (row.delegate_to) delegateIds.push(row.delegate_to);
        }
        setParticipantStatuses(map);

        if (delegateIds.length > 0) {
          supabase.from('profiles').select('user_id, full_name, email').in('user_id', delegateIds).then(({ data: profiles }) => {
            if (!profiles) return;
            const names: Record<string, string> = {};
            for (const p of profiles) names[p.user_id] = p.full_name || p.email || p.user_id;
            setDelegateNames(names);
          });
        }
      });
  }, [meeting.id, currentUserId, meeting.user_id, (meeting as any).participant_user_ids?.join(',')]);


  const priorityColors = {
    high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  };

  const statusTypeColors = {
    requested: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };

  const handleResend = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Reset declined inbox entries to pending and clear the rejected flag (via SECURITY DEFINER)
      const { error } = await supabase.rpc('resend_meeting_invitations', { p_meeting_id: meeting.id });
      if (error) throw error;

      // Notify participants who had declined
      const { data: declinedRows } = await supabase
        .from('meeting_inbox')
        .select('user_id')
        .eq('meeting_id', meeting.id)
        .eq('status', 'pending'); // freshly reset to pending

      const notifyIds = (declinedRows || []).map((r: any) => r.user_id);
      if (notifyIds.length > 0) {
        const { data: notifyProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const nameMap: Record<string, string> = {};
        for (const p of (notifyProfiles || [])) nameMap[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map((uid: string) =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey('participant', 'invite'),
            audience: 'participants',
            fallbackTitle: `دعوت مجدد به جلسه: ${meeting.subject}`,
            fallbackMessage: `شما مجدداً به جلسه «${meeting.subject}» دعوت شده‌اید`,
            placeholders: { meeting_subject: meeting.subject, full_name: nameMap[uid] || '', recipient_greeting: nameMap[uid] ? `${nameMap[uid]} گرامی` : 'همکار گرامی' },
            senderId: user.id,
            actionUrl: 'meetings',
          })
        ));
      }

      toast.success('دعوت‌نامه مجدداً برای شرکت‌کنندگان ارسال شد');
      onUpdate();
    } catch {
      toast.error('خطا در ارسال مجدد دعوت‌نامه');
    } finally {
      setLoading(false);
    }
  };

  const handleShareImage = async () => {
    setShowShareMenu(false);
    if (!shareCardRef.current) { toast.error('خطا در ایجاد تصویر'); return; }
    try {
      setLoading(true);
      toast.loading('در حال تولید تصویر...');
      const dataUrl = await toPng(shareCardRef.current, { quality: 0.95, pixelRatio: 2 });
      toast.dismiss();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'meeting.png', { type: 'image/png' });
      if (navigator.share && (navigator.canShare?.({ files: [file] }) ?? false)) {
        await navigator.share({ title: meeting.subject, files: [file] });
      } else {
        setShareImageUrl(dataUrl);
        setShowShareDialog(true);
      }
    } catch {
      toast.dismiss();
      toast.error('خطا در اشتراک‌گذاری');
    } finally {
      setLoading(false);
    }
  };

  const handleShareText = async () => {
    setShowShareMenu(false);
    const dateStr = new Date(meeting.requestDate).toLocaleDateString('fa-IR');
    const timeStr = meeting.start_time && meeting.end_time
      ? `${meeting.start_time} - ${meeting.end_time}`
      : meeting.duration;
    const agendaText = agendaItems.length > 0
      ? `📌 دستور جلسه:\n` + agendaItems.map((item, idx) => {
          const parts = [`${idx + 1}. ${item.title}`];
          if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
          if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
          return parts.join(' | ');
        }).join('\n')
      : '';
    const lines = [
      `📋 جلسه: ${meeting.subject}`,
      `📅 تاریخ: ${dateStr}`,
      `⏰ زمان: ${timeStr}`,
      `📍 محل: ${meeting.location}`,
      `👤 نماینده: ${meeting.representative}`,
      `📞 تلفن: ${meeting.phone}`,
      meeting.participants.length > 0 ? `👥 شرکت‌کنندگان: ${meeting.participants.join('، ')}` : '',
      meeting.notes ? `📝 یادداشت: ${meeting.notes}` : '',
      agendaText,
      `\nسیستم مدیریت جلسات اسپارک`,
    ].filter(Boolean).join('\n');

    try {
      if (navigator.share) {
        await navigator.share({ title: meeting.subject, text: lines });
      } else {
        await navigator.clipboard.writeText(lines);
        toast.success('متن جلسه در کلیپ‌بورد کپی شد');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(lines);
        toast.success('متن جلسه در کلیپ‌بورد کپی شد');
      } catch {
        toast.error('خطا در اشتراک‌گذاری متن');
      }
    }
  };

  const handleSendToTelegram = async () => {
    if (meeting.status_type !== 'requested') {
      toast.error('فقط جلسات در وضعیت درخواست شده قابل ارسال به مدیر هستند');
      return;
    }
    try {
      setLoading(true);
      const imageData = await toPng(cardRef.current, { quality: 0.95, backgroundColor: 'white' });
      await sendMeetingToTelegram(meeting.id, imageData);
      toast.success('جلسه با موفقیت به مدیر ارسال شد');
    } catch (error: any) {
      toast.error('خطا در ارسال به مدیر');
    } finally {
      setLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Notify participants before deleting
      const pIds = (meeting.participant_user_ids || []) as string[];
      const notifyIds = [...pIds, ...((meeting.notify_users || []) as string[])].filter(uid => uid !== user?.id);
      if (notifyIds.length) {
        const { data: cancelProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const cancelNameMap: Record<string, string> = {};
        for (const p of (cancelProfiles || [])) cancelNameMap[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map(uid =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey(pIds.includes(uid) ? 'participant' : 'observer', 'cancel'),
            audience: pIds.includes(uid) ? 'participants' : 'observers',
            fallbackTitle: 'جلسه لغو شد',
            fallbackMessage: `جلسه «${meeting.subject}» لغو شده است`,
            placeholders: { meeting_subject: meeting.subject, full_name: cancelNameMap[uid] || '', recipient_greeting: cancelNameMap[uid] ? `${cancelNameMap[uid]} گرامی` : 'همکار گرامی' },
            senderId: user?.id ?? null,
            actionUrl: 'meetings',
          })
        ));
      }
      await supabase.from('meeting_inbox').delete().eq('meeting_id', meeting.id);
      const { error } = await supabase.from('meetings').delete().eq('id', meeting.id);
      if (error) throw error;
      toast.success('جلسه به طور کامل حذف شد');
      onUpdate();
    } catch {
      toast.error('خطا در حذف جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAndRevert = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('unauthenticated');

      // Fetch the full meeting data before deleting
      const { data: fullMtg } = await supabase
        .from('meetings')
        .select('subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, meeting_manager')
        .eq('id', meeting.id)
        .maybeSingle();
      if (!fullMtg) throw new Error('جلسه یافت نشد');

      // Fetch participants and actions to copy
      const { data: oldParticipants } = await supabase
        .from('participants')
        .select('name')
        .eq('meeting_id', meeting.id);
      const { data: oldActions } = await supabase
        .from('actions')
        .select('title, status, assignee')
        .eq('meeting_id', meeting.id);

      // Create new meeting record with scheduling fields nulled out
      const { data: newMtg, error: insertErr } = await supabase
        .from('meetings')
        .insert([{
          subject: fullMtg.subject,
          location: fullMtg.location ?? null,
          representative: fullMtg.representative ?? null,
          phone: fullMtg.phone ?? null,
          notes: fullMtg.notes ?? null,
          priority: fullMtg.priority,
          participant_user_ids: fullMtg.participant_user_ids ?? [],
          notify_users: fullMtg.notify_users ?? [],
          external_participants: fullMtg.external_participants ?? [],
          meeting_manager: fullMtg.meeting_manager ?? null,
          user_id: user.id,
          status: 'open',
          status_type: 'approved',
          request_date: null,
          start_time: null,
          end_time: null,
          duration: null,
          repeat_type: null,
          repeat_interval: null,
          repeat_end_date: null,
          repeat_weekday: null,
        }])
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      const newId = newMtg.id;

      // Copy participants table rows
      if ((oldParticipants ?? []).length > 0) {
        await supabase.from('participants').insert(
          (oldParticipants!).map(p => ({ meeting_id: newId, name: p.name }))
        );
      }

      // Copy actions table rows
      if ((oldActions ?? []).length > 0) {
        await supabase.from('actions').insert(
          (oldActions!).map(a => ({ meeting_id: newId, title: a.title, status: a.status, assignee: a.assignee }))
        );
      }

      // Notify participants that the scheduled meeting was cancelled (new unscheduled request will be created)
      const pIds = (fullMtg.participant_user_ids || []) as string[];
      const notifyIds = [...pIds, ...((fullMtg.notify_users || []) as string[])].filter(uid => uid !== user.id);
      if (notifyIds.length) {
        const { data: cancelProfiles2 } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const cancelNameMap2: Record<string, string> = {};
        for (const p of (cancelProfiles2 || [])) cancelNameMap2[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map(uid =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey(pIds.includes(uid) ? 'participant' : 'observer', 'cancel'),
            audience: pIds.includes(uid) ? 'participants' : 'observers',
            fallbackTitle: 'جلسه لغو شد',
            fallbackMessage: `جلسه «${fullMtg.subject}» لغو شده است`,
            placeholders: { meeting_subject: fullMtg.subject, full_name: cancelNameMap2[uid] || '', recipient_greeting: cancelNameMap2[uid] ? `${cancelNameMap2[uid]} گرامی` : 'همکار گرامی' },
            senderId: user.id,
            actionUrl: 'meetings',
          })
        ));
      }

      // Delete old meeting_inbox entries then the meeting itself
      await supabase.from('meeting_inbox').delete().eq('meeting_id', meeting.id);
      const { error: delErr } = await supabase.from('meetings').delete().eq('id', meeting.id);
      if (delErr) throw delErr;

      toast.success('جلسه حذف شد و درخواست جدید ایجاد گردید');
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در حذف و بازگشت جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToGoogleCalendar = () => {
    try {
      const startDate = new Date(meeting.requestDate);
      const durationInMinutes = parseInt(meeting.duration) || 60;
      const endDate = new Date(startDate.getTime() + durationInMinutes * 60000);
      const details = [
        `نماینده: ${meeting.representative}`,
        `شماره تماس: ${meeting.phone}`,
        `شرکت‌کنندگان: ${meeting.participants.join('، ')}`,
        meeting.notes ? `یادداشت‌ها: ${meeting.notes}` : '',
        agendaItems.length > 0
          ? `دستور جلسه:\n` + agendaItems.map((item, idx) => {
              const parts = [`${idx + 1}. ${item.title}`];
              if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
              if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
              return parts.join(' | ');
            }).join('\n')
          : ''
      ].filter(Boolean).join('\n');
      const params = new URLSearchParams({
        action: 'TEMPLATE', text: meeting.subject, details, location: meeting.location,
        dates: `${startDate.toISOString().replace(/(-|:|\.)/g, '')}/${endDate.toISOString().replace(/(-|:|\.)/g, '')}`,
        ctz: 'Asia/Tehran', add: (meeting.guest_emails || []).join(',')
      });
      window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
    } catch {
      toast.error('خطا در ایجاد رویداد تقویم');
    }
  };

  if (isEditing) {
    const meetingJalaaliDate = (() => {
      if (!editPrefill) {
        const src = (meeting as any).request_jalaali_date;
        if (src) return src;
        if (meeting.requestDate) {
          const m = moment(meeting.requestDate);
          if (m.isValid()) return `${m.jYear()}/${String(m.jMonth() + 1).padStart(2, '0')}/${String(m.jDate()).padStart(2, '0')}`;
        }
      }
      return '';
    })();
    const prefill = editPrefill || {
      subject: meeting.subject,
      location: meeting.location,
      representative: meeting.representative,
      phone: meeting.phone,
      notes: meeting.notes || '',
      priority: meeting.priority,
      meetingId: meeting.id,
      startTime: meeting.start_time || '',
      endTime: meeting.end_time || '',
      requestJalaaliDate: meetingJalaaliDate,
    };

    const handleEditFormSuccess = async () => {
      if (meeting.status_type === 'rejected') {
        // Edit from a rejected-meeting state: reset declined entries and resend
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.rpc('resend_meeting_invitations', { p_meeting_id: meeting.id });
            const { data: savedMtg } = await supabase
              .from('meetings')
              .select('participant_user_ids')
              .eq('id', meeting.id)
              .maybeSingle();
            const participantIds: string[] = (savedMtg?.participant_user_ids ?? []).filter((uid: string) => uid !== user.id);
            if (participantIds.length > 0) {
              const { data: reInviteProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', participantIds);
              const reInviteNameMap: Record<string, string> = {};
              for (const p of (reInviteProfiles || [])) reInviteNameMap[p.user_id] = p.full_name || '';
              await Promise.all(participantIds.map(uid =>
                insertNotification({
                  userId: uid,
                  category: 'meeting',
                  eventType: getMeetingTemplateKey('participant', 'invite'),
                  audience: 'participants',
                  fallbackTitle: `دعوت مجدد به جلسه: ${meeting.subject}`,
                  fallbackMessage: `جلسه «${meeting.subject}» ویرایش شد و مجدداً برای شما ارسال گردید`,
                  placeholders: { meeting_subject: meeting.subject, full_name: reInviteNameMap[uid] || '', recipient_greeting: reInviteNameMap[uid] ? `${reInviteNameMap[uid]} گرامی` : 'همکار گرامی' },
                  senderId: user.id,
                  actionUrl: 'meetings',
                })
              ));
            }
            toast.success('جلسه ویرایش شد و مجدداً برای شرکت‌کنندگان ارسال گردید');
          }
        } catch {
          toast.error('خطا در ارسال مجدد');
        }
      }
      setIsEditing(false);
      setEditPrefill(null);
      onUpdate();
    };

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-2">
        <CreateMeetingForm
          onSuccess={handleEditFormSuccess}
          prefillData={prefill}
          onCancel={() => { setIsEditing(false); setEditPrefill(null); }}
        />
      </div>
    );
  }

  return (
    <div ref={cardRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow flex flex-col min-h-[500px]">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${priorityColors[meeting.priority]}`}>
            {meeting.priority === 'high' ? 'اولویت بالا' : meeting.priority === 'medium' ? 'اولویت متوسط' : 'اولویت پایین'}
          </span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusTypeColors[meeting.status_type] ?? 'bg-gray-100 text-gray-800'}`}>
            {meeting.status_type === 'requested' ? 'درخواست شده' : meeting.status_type === 'rejected' ? 'رد شده توسط شرکت‌کننده' : 'تایید شده'}
          </span>
        </div>

        <div className="flex items-center gap-1 action-buttons">
          {meeting.status === 'open' && (
            <>
              {meeting.status_type === 'rejected' && (
                <>
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors disabled:opacity-50"
                    title="ارسال مجدد دعوت‌نامه"
                  >
                    <RefreshCw className="w-4 h-4" />
                    ارسال مجدد
                  </button>
                  <button
                    onClick={() => setIsEditing(true)}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors disabled:opacity-50"
                    title="ویرایش و ارسال مجدد"
                  >
                    <Edit2 className="w-4 h-4" />
                    ویرایش و ارسال
                  </button>
                </>
              )}
              <button onClick={() => setShowUserSelector(true)} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="ارسال به کاربران">
                <UserPlus className="w-5 h-5" />
              </button>
              <div ref={shareMenuRef} className="relative">
                <button
                  onClick={() => setShowShareMenu(v => !v)}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  title="اشتراک‌گذاری"
                >
                  <Share2 className="w-5 h-5" />
                </button>
                {showShareMenu && (
                  <div className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl">
                    <button
                      onClick={handleShareImage}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                        <Image className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">اشتراک‌گذاری تصویر</span>
                    </button>
                    <div className="mx-3 border-t border-gray-100 dark:border-gray-700" />
                    <button
                      onClick={handleShareText}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">اشتراک‌گذاری متن</span>
                    </button>
                  </div>
                )}
              </div>
              <button onClick={handleSendToTelegram} disabled={loading || meeting.status_type !== 'requested'} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-50 transition-colors" title="ارسال به مدیر">
                <Send className="w-5 h-5" />
              </button>
              {meeting.status_type !== 'rejected' && (
                <button onClick={() => setIsEditing(true)} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="ویرایش">
                  <Edit2 className="w-5 h-5" />
                </button>
              )}
              {onScheduleInCalendar && (
                <button onClick={handleAddToGoogleCalendar} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="افزودن به تقویم گوگل">
                  <CalendarPlus className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setShowDeleteModal(true)} disabled={loading} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="حذف جلسه">
                <Trash2 className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      <h3 className="text-xl font-semibold mb-4 dark:text-white">{meeting.subject}</h3>

      {meeting.status_type === 'rejected' && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">
            یک یا چند شرکت‌کننده این دعوت را رد کرده‌اند. می‌توانید دعوت‌نامه را مجدداً ارسال کنید یا ابتدا جلسه را ویرایش نمایید.
          </p>
        </div>
      )}

      <div className="flex-1">
        <MeetingDetails meeting={meeting} agendaItems={agendaItems} />

        <ParticipantStatusPanel
          meeting={meeting}
          participantUserIds={(meeting as any).participant_user_ids ?? []}
          participantStatuses={participantStatuses}
          delegateNames={delegateNames}
          isCreator={!!(meeting.user_id && currentUserId && meeting.user_id === currentUserId)}
        />
      </div>

      {meeting.status === 'open' && (
        <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <button
              onClick={() => setShowActions(!showActions)}
              className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-sm font-medium"
            >
              {showActions ? 'پنهان کردن اقدامات' : 'نمایش/افزودن اقدامات'}
            </button>
            {meeting.status_type === 'approved' && onScheduleInCalendar && (
              <button
                onClick={() => onScheduleInCalendar(meeting)}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
                title="برنامه‌ریزی در تقویم"
              >
                <CalendarIcon className="w-5 h-5" />
                <span className="text-sm">برنامه‌ریزی در تقویم</span>
              </button>
            )}
          </div>
          {showActions && (
            <ActionsSection meetingId={meeting.id} actions={meeting.actions} onUpdate={onUpdate} />
          )}
        </div>
      )}

      {/* Modals */}
      {showDeleteModal && (
        <DeleteMeetingModal
          meeting={meeting}
          onClose={() => setShowDeleteModal(false)}
          onPermanentDelete={handlePermanentDelete}
          loading={loading}
        />
      )}

      {showUserSelector && (
        <UserSelectorModal
          meetingId={meeting.id}
          onClose={() => setShowUserSelector(false)}
          onSuccess={() => {
            setShowUserSelector(false);
            toast.success('درخواست جلسه با موفقیت ارسال شد');
          }}
        />
      )}

      {showShareDialog && shareImageUrl && (
        <MeetingShareDialog
          imageUrl={shareImageUrl}
          onClose={() => setShowShareDialog(false)}
          onDownload={() => {
            const a = document.createElement('a');
            a.href = shareImageUrl;
            a.download = `meeting-${meeting.id.slice(0, 8)}.png`;
            a.click();
            toast.success('تصویر دانلود شد');
            setShowShareDialog(false);
          }}
        />
      )}

      {/* Hidden share card for image generation */}
      <MeetingShareCard ref={shareCardRef} meeting={meeting} agendaItems={agendaItems} />
    </div>
  );
}
