import moment from 'moment-jalaali';
import { supabase } from '../../lib/supabase';
import { jalaliDayRange, jalaliToGregorianIso } from '../../lib/sparkDateUtils';
import type {
  ParsedCommand,
  SparkCalendarMeetingPrefill,
  SparkMeetingPrefill,
} from './SparkAssistantTypes';

async function execSendMessage(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.targetUser) throw new Error('نام گیرنده مشخص نیست');
  if (!cmd.messageBody?.trim()) throw new Error('متن پیام مشخص نیست');

  const resolvedBody = cmd.messageBody.trim();
  const messageType = cmd.messageImportance === 'urgent' ? 'urgent' : cmd.messageImportance === 'important' ? 'important' : 'normal';
  const label = messageType === 'urgent' ? ' اورژانسی' : messageType === 'important' ? ' مهم' : '';

  const { data: profiles } = await supabase.from('profiles_public').select('user_id, full_name').ilike('full_name', `%${cmd.targetUser}%`).limit(5);
  if (profiles?.length) {
    const recipient = profiles[0];
    const { data: conversationId, error: conversationError } = await supabase.rpc('find_or_create_direct_conversation', { user_a: userId, user_b: recipient.user_id });
    if (conversationError || !conversationId) throw new Error(conversationError?.message || 'خطا در ایجاد گفتگو');
    const { error } = await supabase.from('chat_messages').insert({ conversation_id: conversationId, sender_id: userId, body: resolvedBody, message_type: messageType });
    if (error) throw new Error(error.message);
    return `✅ پیام${label} به ${recipient.full_name} ارسال شد.`;
  }

  const channelQuery = cmd.targetUser.replace(/^گروه\s*/i, '').trim();
  const { data: channels } = await supabase.from('channels').select('id, name, type').ilike('name', `%${channelQuery}%`).limit(3);
  if (channels?.length) {
    const channel = channels[0];
    const { data: member } = await supabase.from('channel_members').select('id').eq('channel_id', channel.id).eq('user_id', userId).maybeSingle();
    if (!member) return `❌ شما عضو گروه "${channel.name}" نیستید.`;
    const { error } = await supabase.from('channel_messages').insert({
      channel_id: channel.id,
      sender_id: userId,
      body: resolvedBody,
      message_type: messageType,
      read_by: [],
    });
    if (error) throw new Error(error.message);
    return `✅ پیام${label} در گروه "${channel.name}" ارسال شد.`;
  }

  return `❌ کاربر یا گروهی با نام "${cmd.targetUser}" یافت نشد.`;
}

async function execCreateTask(cmd: ParsedCommand, userId: string): Promise<string> {
  const { data: myProfile } = await supabase.from('profiles_public').select('full_name').eq('user_id', userId).maybeSingle();
  let assigneeId = userId;
  let assigneeName = myProfile?.full_name || 'من';
  if (cmd.taskAssigneeName) {
    const { data: assigneeProfile } = await supabase.from('profiles_public').select('user_id, full_name').ilike('full_name', `%${cmd.taskAssigneeName}%`).limit(1).maybeSingle();
    if (assigneeProfile) {
      assigneeId = assigneeProfile.user_id;
      assigneeName = assigneeProfile.full_name || cmd.taskAssigneeName;
    } else {
      assigneeName = cmd.taskAssigneeName;
    }
  }

  const { error } = await supabase.from('tasks').insert({
    user_id: userId,
    created_by_id: userId,
    current_assignee_id: assigneeId,
    title: cmd.taskTitle || 'اقدام جدید',
    description: 'ایجاد شده توسط اسپارک',
    priority: cmd.priority || 'medium',
    status: 'pending',
    due_date: cmd.taskDueDate ? jalaliToGregorianIso(cmd.taskDueDate) : null,
    assignee: assigneeName,
    archived: false,
  });
  if (error) throw new Error(error.message);
  return `✅ اقدام "${cmd.taskTitle}" برای ${assigneeName} ثبت شد.`;
}

async function execCreateNote(cmd: ParsedCommand, userId: string): Promise<string> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, title: cmd.noteTitle || 'یادداشت جدید', content: cmd.noteContent || '' });
  if (error) throw new Error(error.message);
  return `✅ یادداشت "${cmd.noteTitle}" ثبت شد.`;
}

async function execAddContact(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.contactName && !cmd.contactPhone) throw new Error('نام یا شماره تماس الزامی است');
  const { error } = await supabase.from('contacts_email').insert({
    user_id: userId,
    name: cmd.contactName || '',
    phone: cmd.contactPhone || '',
    email: cmd.contactEmail || '',
    company: cmd.contactOrg || '',
  });
  if (error) throw new Error(error.message);
  return `✅ مخاطب "${cmd.contactName || cmd.contactPhone}" ثبت شد.`;
}

async function execQueryMeetings(cmd: ParsedCommand, userId: string): Promise<string> {
  const filter = cmd.queryFilter || 'all';
  const { count } = await supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const filterLabel: Record<string, string> = { all: 'کل', open: 'باز', closed: 'بسته', today: 'امروز', this_week: 'این هفته' };
  return `📊 تعداد جلسات ${filterLabel[filter] || ''}: ${count ?? 0} جلسه`;
}

async function execListMeetingsOnDate(cmd: ParsedCommand, userId: string): Promise<string> {
  const dateString = cmd.queryDate || cmd.date;
  const jalaliString = dateString || moment().format('jYYYY/jMM/jDD');
  const [rangeStart, rangeEnd] = jalaliDayRange(jalaliString);
  if (!rangeStart) return `📭 تاریخ «${jalaliString}» معتبر نیست.`;

  const [{ data: owned }, { data: participating }, { data: notified }] = await Promise.all([
    supabase.from('meetings').select('id, subject, start_time, location')
      .eq('user_id', userId).gte('request_date', rangeStart).lt('request_date', rangeEnd).order('start_time', { ascending: true }),
    supabase.from('meetings').select('id, subject, start_time, location')
      .filter('participant_user_ids', 'cs', `{"${userId}"}`).neq('user_id', userId)
      .gte('request_date', rangeStart).lt('request_date', rangeEnd).order('start_time', { ascending: true }),
    supabase.from('meetings').select('id, subject, start_time, location')
      .filter('notify_users', 'cs', `{"${userId}"}`).neq('user_id', userId)
      .gte('request_date', rangeStart).lt('request_date', rangeEnd).order('start_time', { ascending: true }),
  ]);

  const meetingMap = new Map<string, any>();
  for (const meeting of [...(owned || []), ...(participating || []), ...(notified || [])]) meetingMap.set(meeting.id, meeting);
  const meetings = Array.from(meetingMap.values()).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  if (meetings.length === 0) return `📭 جلسه‌ای برای تاریخ ${jalaliString} ثبت نشده.`;
  const lines = meetings.map((meeting: any) => `• ${meeting.subject}${meeting.start_time ? ' — ساعت ' + meeting.start_time : ''}${meeting.location ? ' — ' + meeting.location : ''}`).join('\n');
  return `📅 ${meetings.length} جلسه در تاریخ ${jalaliString}:\n${lines}`;
}

async function execRescheduleMeeting(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.meetingSubjectQuery) throw new Error('موضوع جلسه مشخص نشده');
  if (cmd.timeDeltaMinutes === undefined || cmd.timeDeltaMinutes === 0) throw new Error('مقدار جابجایی زمانی مشخص نشده');
  const { data: meetings } = await supabase.from('meetings')
    .select('id, subject, start_time, end_time, user_id, participant_user_ids, notify_users')
    .ilike('subject', `%${cmd.meetingSubjectQuery}%`)
    .or(`user_id.eq.${userId},participant_user_ids.cs.{"${userId}"}`)
    .limit(1);
  if (!meetings?.length) return `❌ جلسه‌ای با موضوع "${cmd.meetingSubjectQuery}" یافت نشد.`;
  const meeting = meetings[0];
  if (!meeting.start_time) return `⚠️ جلسه "${meeting.subject}" زمان ثبت‌شده‌ای ندارد.`;

  const [hours, minutes] = meeting.start_time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + cmd.timeDeltaMinutes;
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const newStart = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
  let newEnd = meeting.end_time;
  if (meeting.end_time) {
    const [endHours, endMinutes] = meeting.end_time.split(':').map(Number);
    const endTotal = endHours * 60 + endMinutes + cmd.timeDeltaMinutes;
    const normalizedEnd = ((endTotal % 1440) + 1440) % 1440;
    newEnd = `${String(Math.floor(normalizedEnd / 60)).padStart(2, '0')}:${String(normalizedEnd % 60).padStart(2, '0')}`;
  }

  const { error } = await supabase.from('meetings').update({ start_time: newStart, end_time: newEnd }).eq('id', meeting.id);
  if (error) throw new Error(error.message);
  const direction = cmd.timeDeltaMinutes > 0 ? 'جلو' : 'عقب';
  const mins = Math.abs(cmd.timeDeltaMinutes);
  return `✅ جلسه "${meeting.subject}" ${mins} دقیقه ${direction} کشیده شد.\n⏰ زمان جدید: ${newStart}${newEnd ? ' تا ' + newEnd : ''}`;
}

async function execCancelMeeting(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.meetingSubjectQuery) throw new Error('موضوع جلسه مشخص نشده');
  const { data: meetings } = await supabase.from('meetings')
    .select('id, subject, start_time, user_id, participant_user_ids, notify_users')
    .ilike('subject', `%${cmd.meetingSubjectQuery}%`)
    .or(`user_id.eq.${userId},participant_user_ids.cs.{"${userId}"}`)
    .limit(1);
  if (!meetings?.length) return `❌ جلسه‌ای با موضوع "${cmd.meetingSubjectQuery}" یافت نشد.`;
  const meeting = meetings[0];
  const { error } = await supabase.from('meetings').update({ status_type: 'cancelled', status: 'لغو شد' }).eq('id', meeting.id);
  if (error) throw new Error(error.message);
  return `✅ جلسه "${meeting.subject}" لغو شد.`;
}

export async function executeCommand(
  cmd: ParsedCommand,
  userId: string,
  onNavigate: (page: string) => void,
  onSetCalendarView: ((view: string) => void) | undefined,
  onOpenMeetingForm: ((prefill: SparkMeetingPrefill) => void) | undefined,
  onOpenCalendarMeetingForm: ((prefill: SparkCalendarMeetingPrefill) => void) | undefined,
  onNavigateToDate: ((jy: number, jm: number, jd: number, view?: string) => void) | undefined,
): Promise<{ success: boolean; message: string }> {
  switch (cmd.type) {
    case 'navigate':
      onNavigate(cmd.page!);
      return { success: true, message: `✅ صفحه ${cmd.page} باز شد.` };
    case 'calendar_view': {
      const view = cmd.calendarView || 'week';
      if (onSetCalendarView) onSetCalendarView(view);
      else onNavigate('calendar');
      const labels: Record<string, string> = { day: 'روزانه', week: 'هفتگی', month: 'ماهانه', 'list-week': 'لیست هفتگی', 'list-month': 'لیست ماهانه' };
      return { success: true, message: `✅ تقویم ${labels[view] || view} نمایش داده شد.` };
    }
    case 'calendar_list_today':
      return { success: true, message: await execListMeetingsOnDate({ ...cmd, queryDate: moment().format('jYYYY/jMM/jDD') }, userId) };
    case 'calendar_list_date':
      return { success: true, message: await execListMeetingsOnDate(cmd, userId) };
    case 'meeting_request': {
      const parts = cmd.date ? cmd.date.split('/').map(Number) : [];
      const prefill: SparkMeetingPrefill = {
        subject: cmd.subject,
        representative: cmd.representative,
        phone: cmd.phone,
        location: cmd.location,
        priority: cmd.priority || 'medium',
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        dateJy: parts[0], dateJm: parts[1], dateJd: parts[2], participantNames: cmd.participantNames,
      };
      if (onOpenMeetingForm) {
        onOpenMeetingForm(prefill);
        return { success: true, message: '✅ فرم درخواست جلسه باز شد.' };
      }
      return { success: false, message: '❌ فرم درخواست جلسه در دسترس نیست.' };
    }
    case 'reschedule_meeting':
      return { success: true, message: await execRescheduleMeeting(cmd, userId) };
    case 'cancel_meeting':
      return { success: true, message: await execCancelMeeting(cmd, userId) };
    case 'chat_send_message':
      return { success: true, message: await execSendMessage(cmd, userId) };
    case 'create_task':
      return { success: true, message: await execCreateTask(cmd, userId) };
    case 'create_note':
      return { success: true, message: await execCreateNote(cmd, userId) };
    case 'add_contact':
      return { success: true, message: await execAddContact(cmd, userId) };
    case 'query_meetings_count':
      return { success: true, message: await execQueryMeetings(cmd, userId) };
    case 'calendar_navigate_date': {
      const dateString = cmd.calendarDate || cmd.date;
      if (dateString && onNavigateToDate) {
        const parts = dateString.split('/').map(Number);
        if (parts.length === 3) {
          onNavigateToDate(parts[0], parts[1], parts[2], cmd.calendarView || 'day');
          return { success: true, message: `✅ تقویم به تاریخ ${dateString} رفت.` };
        }
      }
      onNavigate('calendar');
      return { success: true, message: '✅ تقویم باز شد.' };
    }
    case 'calendar_meeting_form': {
      const parts = cmd.date ? cmd.date.split('/').map(Number) : [];
      const prefill: SparkCalendarMeetingPrefill = {
        subject: cmd.subject,
        representative: cmd.representative,
        phone: cmd.phone,
        location: cmd.location,
        priority: cmd.priority || 'medium',
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        dateJy: parts[0], dateJm: parts[1], dateJd: parts[2], participantNames: cmd.participantNames,
      };
      if (onOpenCalendarMeetingForm) {
        onOpenCalendarMeetingForm(prefill);
        return { success: true, message: '✅ فرم تنظیم جلسه در تقویم باز شد.' };
      }
      onNavigate('calendar');
      return { success: true, message: '✅ به تقویم رفتید.' };
    }
    case 'conversational':
      return { success: true, message: cmd.answer || cmd.response || 'پاسخی یافت نشد.' };
    case 'explain':
      return { success: true, message: cmd.explanation || cmd.response || 'اطلاعات بیشتری در دسترس نیست.' };
    default:
      return { success: false, message: cmd.response || '❌ دستور شناخته نشد.' };
  }
}
