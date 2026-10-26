-- Statement-level invalidations contain table names only: no row IDs, user
-- identifiers or document content. Existing table/RPC RLS still governs reads.
create function private.broadcast_app_data_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('table', tg_table_name), 'data_changed', 'app-data-changes', true);
  return null;
end;
$$;
revoke all on function private.broadcast_app_data_change() from public, anon, authenticated;
create policy app_data_changes_receive on realtime.messages
for select to authenticated using (
  extension = 'broadcast'
  and (select realtime.topic()) = 'app-data-changes'
  and (select private.is_current_session_fully_authorized())
);
-- One event per statement avoids emitting every row of bulk imports/retention.
do $$
declare v_table text;
begin
  foreach v_table in array array['actions','all_day_events','audit_log','auth_security_settings','broadcast_messages','broadcast_recipients','calendar_occasions','calendar_subscriptions','calendars','channel_group_task_activities','channel_group_task_assignments','channel_group_tasks','channel_members','channel_message_reactions','channel_message_stars','channel_messages','channels','chat_conversations','chat_message_stars','chat_message_tag_assignments','chat_messages','chat_reminders','chat_tags','contacts_email','daily_report_config','daily_report_runs','hr_sso_config','meeting_agenda_items','meeting_calendar_exclusions','meeting_inbox','meetings','minutes','minutes_agenda_results','minutes_approval_comments','minutes_approvals','minutes_attachments','minutes_audit_log','minutes_decision_reminders','minutes_decision_updates','minutes_decisions','minutes_external_participants','minutes_participants','notes','notification_event_registry','notification_group_rules','notification_templates','notifications','org_level_definitions','org_level_permissions','org_organizations','org_position_members','org_position_permissions','org_positions','org_units','participants','profiles','projects','shared_meetings','sms_delivery_policies','sms_dispatch_logs','sms_group_rules','sms_providers','sms_templates','spark_ai_settings','spark_assistant_logs','spark_config','spark_field_keywords','spark_memory','system_config','task_attachments','task_checklist_items','task_dependencies','task_personal_projects','task_workflow_steps','tasks','user_access_relations','user_group_members','user_groups','user_preferences'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('create trigger spark_live_data_change after insert or update or delete or truncate on public.%I for each statement execute function private.broadcast_app_data_change()', v_table);
    end if;
  end loop;
end;
$$;
