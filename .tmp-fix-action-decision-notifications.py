from pathlib import Path
from datetime import datetime, timezone


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Task notification helper: route each task lifecycle event to its own template.
Path('src/components/Tasks/utils.ts').write_text("""import moment from 'moment-jalaali';
import { insertNotification } from '../../lib/notifications';
import { Task } from '../../types';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

export const toJalali = (iso: string) => moment(iso).format('jYYYY/jMM/jDD HH:mm');

export type TaskNotificationEventType =
  | 'assign'
  | 'complete'
  | 'note_added'
  | 'referred'
  | 'reminder'
  | 'status_in_progress'
  | 'status_pending';

export interface TaskNotificationOptions {
  eventType?: TaskNotificationEventType;
  placeholders?: Record<string, string>;
}

export async function sendTaskNotification(
  recipientId: string,
  actorId: string,
  title: string,
  message: string,
  senderName?: string,
  senderAvatarUrl?: string,
  taskTitle?: string,
  options: TaskNotificationOptions = {},
) {
  if (!recipientId) return;
  try {
    await insertNotification({
      userId: recipientId,
      category: 'task',
      eventType: options.eventType ?? 'assign',
      fallbackTitle: title,
      fallbackMessage: message,
      placeholders: {
        task_title: taskTitle || title,
        sender_name: senderName || '',
        ...(options.placeholders || {}),
      },
      senderId: actorId || null,
      senderName: senderName || null,
      senderAvatarUrl: senderAvatarUrl || null,
      actionUrl: 'tasks',
    });
  } catch { /* non-critical — silently ignore */ }
}

export function getTaskRecipients(task: Task, _actorId?: string): string[] {
  const ids = new Set<string>();
  if (task.created_by_id) ids.add(task.created_by_id);
  if (task.current_assignee_id) ids.add(task.current_assignee_id);
  return Array.from(ids);
}
""", encoding='utf-8')

# 2) Group configuration must use the same canonical task event keys as templates/producers.
replace_once(
    'src/components/NotificationsConfig/constants.ts',
    "  { key: 'task_assign',       label: 'تخصیص اقدام',            category: 'اقدامات' },\n  { key: 'task_reminder',     label: 'یادآور اقدام',           category: 'اقدامات' },\n  { key: 'task_complete',     label: 'تکمیل اقدام',            category: 'اقدامات' },",
    "  { key: 'assign',             label: 'تخصیص اقدام',            category: 'اقدامات' },\n  { key: 'reminder',           label: 'یادآور اقدام',           category: 'اقدامات' },\n  { key: 'complete',           label: 'تکمیل اقدام',            category: 'اقدامات' },\n  { key: 'note_added',         label: 'ثبت گزارش اقدام',         category: 'اقدامات' },\n  { key: 'referred',           label: 'ارجاع اقدام',             category: 'اقدامات' },\n  { key: 'status_in_progress', label: 'شروع اقدام',              category: 'اقدامات' },\n  { key: 'status_pending',     label: 'بازگشت اقدام به انتظار', category: 'اقدامات' },",
)

# 3) Decision/minutes types come from the registry; exclude their Persian display categories
# from the static list to prevent duplicate React keys/toggles.
replace_once(
    'src/components/NotificationsConfig/GroupsTab.tsx',
    "const REGISTRY_CATEGORIES = ['minutes', 'decision'];",
    "const REGISTRY_CATEGORIES = ['minutes', 'decision'];\nconst REGISTRY_CATEGORY_LABELS = new Set(['صورت‌جلسات', 'مصوبات']);",
)
replace_once(
    'src/components/NotificationsConfig/GroupsTab.tsx',
    "    const staticTypes = NOTIFICATION_TYPES.filter(n => !REGISTRY_CATEGORIES.includes(n.category));",
    "    const staticTypes = NOTIFICATION_TYPES.filter(n => !REGISTRY_CATEGORY_LABELS.has(n.category));",
)

# 4) Make the shared template catalog aware of every real task lifecycle event.
replace_once(
    'src/config/templateCatalog.ts',
    "  { key: 'assign',        label: 'تخصیص' },\n  { key: 'complete',      label: 'تکمیل' },",
    "  { key: 'assign',             label: 'تخصیص' },\n  { key: 'complete',           label: 'تکمیل' },\n  { key: 'note_added',         label: 'ثبت گزارش اقدام' },\n  { key: 'referred',           label: 'ارجاع اقدام' },\n  { key: 'status_in_progress', label: 'شروع اقدام' },\n  { key: 'status_pending',     label: 'بازگشت اقدام به انتظار' },",
)

# 5) Assignment placeholders and status event routing.
replace_once(
    'src/components/TasksPage.tsx',
    "      await sendTaskNotification(\n        payload.assigneeId,\n        userId,\n        `اقدام جدید برای شما: ${payload.title.trim()}`,\n        `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(payload.dueDate.toISOString())}`,\n        creatorName,\n        creatorProfile?.avatar_url || undefined,\n        payload.title.trim(),\n      );",
    "      await sendTaskNotification(\n        payload.assigneeId,\n        userId,\n        `اقدام جدید برای شما: ${payload.title.trim()}`,\n        `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(payload.dueDate.toISOString())}`,\n        creatorName,\n        creatorProfile?.avatar_url || undefined,\n        payload.title.trim(),\n        {\n          eventType: 'assign',\n          placeholders: {\n            full_name: payload.assigneeName || 'همکار',\n            priority: payload.priority === 'high' ? 'بالا' : payload.priority === 'medium' ? 'متوسط' : 'پایین',\n            due_date: toJalali(payload.dueDate.toISOString()),\n          },\n        },\n      );",
)

old_status = """      if (updatedData.status && userId) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = {
          completed: 'completed',
          in_progress: 'accepted',
        };
        const action = actionMap[updatedData.status];
        const statusFa: Record<string, string> = {
          completed: 'تکمیل شد',
          in_progress: 'شروع شد',
          pending: 'به حالت انتظار برگشت',
        };
        const actorProfile = users.find(u => u.user_id === userId);
        const actorName = actorProfile?.full_name || 'کاربر';
        const fullTask = tasks.find(t => t.id === taskId);

        if (action && fullTask) {
          await supabase.from('task_workflow_steps').insert({
            task_id: taskId,
            actor_id: userId,
            action,
            note: `وضعیت اقدام ${statusFa[updatedData.status] || updatedData.status}`,
          });

          const recipients = getTaskRecipients(fullTask, userId);
          const statusLabel = statusFa[updatedData.status] || updatedData.status;
          await Promise.all(recipients.map(recipientId => sendTaskNotification(
            recipientId,
            userId,
            `تغییر وضعیت اقدام: ${fullTask.title}`,
            `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
            actorName,
            actorProfile?.avatar_url || undefined,
            fullTask.title,
          )));
        }
      }
"""
new_status = """      if (updatedData.status && userId) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = {
          completed: 'completed',
          in_progress: 'accepted',
        };
        const action = actionMap[updatedData.status];
        const notificationEventType = updatedData.status === 'completed'
          ? 'complete'
          : updatedData.status === 'in_progress'
            ? 'status_in_progress'
            : updatedData.status === 'pending'
              ? 'status_pending'
              : null;
        const statusFa: Record<string, string> = {
          completed: 'تکمیل شد',
          in_progress: 'شروع شد',
          pending: 'به حالت انتظار برگشت',
        };
        const actorProfile = users.find(u => u.user_id === userId);
        const actorName = actorProfile?.full_name || 'کاربر';
        const fullTask = tasks.find(t => t.id === taskId);

        if (fullTask) {
          if (action) {
            await supabase.from('task_workflow_steps').insert({
              task_id: taskId,
              actor_id: userId,
              action,
              note: `وضعیت اقدام ${statusFa[updatedData.status] || updatedData.status}`,
            });
          }

          if (notificationEventType) {
            const recipients = getTaskRecipients(fullTask, userId);
            const statusLabel = statusFa[updatedData.status] || updatedData.status;
            await Promise.all(recipients.map(recipientId => sendTaskNotification(
              recipientId,
              userId,
              `تغییر وضعیت اقدام: ${fullTask.title}`,
              `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
              actorName,
              actorProfile?.avatar_url || undefined,
              fullTask.title,
              { eventType: notificationEventType },
            )));
          }
        }
      }
"""
replace_once('src/components/TasksPage.tsx', old_status, new_status)

# 6) Referral and report/note events must use their own templates and placeholders.
replace_once(
    'src/components/Tasks/ReferModal.tsx',
    "      await sendTaskNotification(\n        toUserId, currentUserId,\n        `اقدام به شما ارجاع داده شد: ${task.title}`,\n        `${actorName} این اقدام را به شما ارجاع داد${note ? ` — ${note.slice(0, 80)}` : ''}`,\n        actorName, actorAvatarUrl,\n      );",
    "      await sendTaskNotification(\n        toUserId, currentUserId,\n        `اقدام به شما ارجاع داده شد: ${task.title}`,\n        `${actorName} این اقدام را به شما ارجاع داد${note ? ` — ${note.slice(0, 80)}` : ''}`,\n        actorName, actorAvatarUrl, task.title,\n        {\n          eventType: 'referred',\n          placeholders: {\n            assignee_name: toUserName || 'کاربر',\n            note_excerpt: note.trim(),\n          },\n        },\n      );",
)
replace_once(
    'src/components/Tasks/ReferModal.tsx',
    "        await sendTaskNotification(\n          task.created_by_id, currentUserId,\n          `ارجاع اقدام: ${task.title}`,\n          `${actorName} اقدام را به ${toUserName} ارجاع داد`,\n          actorName, actorAvatarUrl,\n        );",
    "        await sendTaskNotification(\n          task.created_by_id, currentUserId,\n          `ارجاع اقدام: ${task.title}`,\n          `${actorName} اقدام را به ${toUserName} ارجاع داد`,\n          actorName, actorAvatarUrl, task.title,\n          {\n            eventType: 'referred',\n            placeholders: {\n              assignee_name: toUserName || 'کاربر',\n              note_excerpt: note.trim(),\n            },\n          },\n        );",
)
replace_once(
    'src/components/Tasks/AddNoteModal.tsx',
    "        sendTaskNotification(rid, userId,\n          `اقدام جدید روی: ${task.title}`,\n          `${actorName} اقدام ثبت کرد: ${note.trim().slice(0, 100)}${note.length > 100 ? '…' : ''}`,\n          actorName, actorAvatarUrl, task.title\n        )",
    "        sendTaskNotification(rid, userId,\n          `اقدام جدید روی: ${task.title}`,\n          `${actorName} اقدام ثبت کرد: ${note.trim().slice(0, 100)}${note.length > 100 ? '…' : ''}`,\n          actorName, actorAvatarUrl, task.title,\n          {\n            eventType: 'note_added',\n            placeholders: { note_excerpt: note.trim().slice(0, 100) },\n          }\n        )",
)

# 7) Add a new migration; never modify historical migrations.
stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
migration = Path(f'supabase/migrations/{stamp}_fix_action_notification_group_rules.sql')
migration.write_text("""-- Keep legacy task notifications compatible with notification group controls.
-- Other notification categories keep their existing delivery path unchanged.
create or replace function private.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_action_url text default null::text,
  p_template_category text default null::text,
  p_template_event_type text default null::text,
  p_template_audience text default null::text,
  p_entity_type text default null::text,
  p_entity_id uuid default null::uuid,
  p_minute_id uuid default null::uuid,
  p_revision_number integer default null::integer,
  p_metadata jsonb default null::jsonb,
  p_event_key text default null::text
)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_created boolean := true;
  v_sender_name text;
  v_sender_avatar text;
  v_sender_org text;
  v_recipient_org text;
  v_recipient_active boolean;
  v_recipient_hidden boolean;
  v_user_group_ids uuid[];
  v_rule record;
  v_any_enabled boolean := false;
  v_any_rule_exists boolean := false;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select full_name, avatar_url, organization
  into v_sender_name, v_sender_avatar, v_sender_org
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if v_sender_org is null or btrim(v_sender_org) = '' then
    raise exception 'sender_organization_required';
  end if;

  select organization, coalesce(is_active, false), coalesce(is_hidden, false)
  into v_recipient_org, v_recipient_active, v_recipient_hidden
  from public.profiles
  where user_id = p_user_id
  limit 1;

  if v_recipient_org is null or btrim(v_recipient_org) = '' then
    raise exception 'recipient_not_found';
  end if;
  if v_recipient_active is not true then
    raise exception 'recipient_not_active';
  end if;
  if v_recipient_hidden is true then
    raise exception 'recipient_hidden';
  end if;
  if v_recipient_org <> v_sender_org then
    raise exception 'recipient_outside_organization';
  end if;

  if p_template_category = 'task' and p_template_event_type is not null then
    select array_agg(group_id)
    into v_user_group_ids
    from public.user_group_members
    where user_id = p_user_id;

    if v_user_group_ids is not null and array_length(v_user_group_ids, 1) > 0 then
      for v_rule in
        select enabled
        from public.notification_group_rules
        where notification_type = p_template_event_type
          and group_id = any(v_user_group_ids)
      loop
        v_any_rule_exists := true;
        if v_rule.enabled then
          v_any_enabled := true;
        end if;
      end loop;

      if v_any_rule_exists and not v_any_enabled then
        return json_build_object(
          'notification_id', null,
          'created', false,
          'reason', 'GROUP_RULE_DISABLED'
        );
      end if;
    end if;
  end if;

  insert into public.notifications (
    user_id, title, message, type, read,
    sender_id, sender_name, sender_avatar_url, action_url,
    template_category, template_event_type, template_audience,
    entity_type, entity_id, minute_id, revision_number, metadata, event_key
  ) values (
    p_user_id, p_title, p_message, p_type, false,
    auth.uid(), v_sender_name, v_sender_avatar, p_action_url,
    p_template_category, p_template_event_type, p_template_audience,
    p_entity_type, p_entity_id, p_minute_id, p_revision_number, p_metadata, p_event_key
  )
  on conflict (event_key) where event_key is not null
  do update set event_key = excluded.event_key
  returning id, (xmax = 0) as was_inserted into v_id, v_created;

  return json_build_object(
    'notification_id', v_id,
    'created', v_created
  );
end;
$function$;
""", encoding='utf-8')
Path('.tmp-action-decision-migration-path').write_text(str(migration), encoding='utf-8')

print(migration)
