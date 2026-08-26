alter table public.task_workflow_steps
  drop constraint if exists task_workflow_steps_action_check;

alter table public.task_workflow_steps
  add constraint task_workflow_steps_action_check
  check (action = any (array[
    'created'::text,
    'referred'::text,
    'accepted'::text,
    'completed'::text,
    'rejected'::text,
    'note_added'::text,
    'management_update'::text
  ]));
