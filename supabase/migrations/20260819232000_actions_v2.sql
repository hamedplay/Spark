-- Actions V2: extend the existing Tasks module with project links, personal
-- projects, checklists, attachments, dependencies, reminders and time tracking.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

grant select on public.projects to authenticated;

create policy "Authenticated users can view projects"
on public.projects
for select
to authenticated
using (true);

create policy "auth_global_full_access_gate"
on public.projects
as restrictive
for all
to authenticated
using ((select private.is_current_session_fully_authorized()))
with check ((select private.is_current_session_fully_authorized()));

create table public.task_personal_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text,
  created_at timestamptz not null default now(),
  constraint task_personal_projects_owner_name_key unique (owner_id, name)
);

create index task_personal_projects_owner_created_idx
  on public.task_personal_projects (owner_id, created_at desc);

alter table public.task_personal_projects enable row level security;

grant select, insert, update, delete on public.task_personal_projects to authenticated;

create policy "Users can view own task personal projects"
on public.task_personal_projects
for select
to authenticated
using (owner_id = auth.uid());

create policy "Users can insert own task personal projects"
on public.task_personal_projects
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Users can update own task personal projects"
on public.task_personal_projects
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users can delete own task personal projects"
on public.task_personal_projects
for delete
to authenticated
using (owner_id = auth.uid());

create policy "auth_global_full_access_gate"
on public.task_personal_projects
as restrictive
for all
to authenticated
using ((select private.is_current_session_fully_authorized()))
with check ((select private.is_current_session_fully_authorized()));

alter table public.tasks
  add column start_date timestamptz,
  add column progress_percent integer not null default 0,
  add column estimated_minutes integer,
  add column actual_minutes integer,
  add column tags text[] not null default '{}'::text[],
  add column project_id uuid references public.projects(id) on delete set null,
  add column personal_project_id uuid references public.task_personal_projects(id) on delete set null,
  add column reminder_at timestamptz,
  add column parent_task_id uuid references public.tasks(id) on delete set null,
  add constraint tasks_progress_percent_check check (progress_percent between 0 and 100),
  add constraint tasks_estimated_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  add constraint tasks_actual_minutes_check check (actual_minutes is null or actual_minutes >= 0),
  add constraint tasks_parent_not_self_check check (parent_task_id is null or parent_task_id <> id);

create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_personal_project_id_idx on public.tasks (personal_project_id);
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);
create index tasks_reminder_at_idx on public.tasks (reminder_at) where reminder_at is not null;

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index task_checklist_items_task_sort_idx
  on public.task_checklist_items (task_id, sort_order, created_at);

alter table public.task_checklist_items enable row level security;
grant select, insert, update, delete on public.task_checklist_items to authenticated;

create policy "Task members can read checklist items"
on public.task_checklist_items
for select
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_checklist_items.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can insert checklist items"
on public.task_checklist_items
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = task_checklist_items.task_id
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);

create policy "Task members can update checklist items"
on public.task_checklist_items
for update
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_checklist_items.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
))
with check (exists (
  select 1 from public.tasks t
  where t.id = task_checklist_items.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can delete checklist items"
on public.task_checklist_items
for delete
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_checklist_items.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "auth_global_full_access_gate"
on public.task_checklist_items
as restrictive
for all
to authenticated
using ((select private.is_current_session_fully_authorized()))
with check ((select private.is_current_session_fully_authorized()));

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null unique,
  file_size bigint,
  mime_type text,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_attachments_file_size_check check (file_size is null or file_size >= 0)
);

create index task_attachments_task_created_idx
  on public.task_attachments (task_id, created_at desc);

alter table public.task_attachments enable row level security;
grant select, insert, update, delete on public.task_attachments to authenticated;

create policy "Task members can read attachment metadata"
on public.task_attachments
for select
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_attachments.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can insert attachment metadata"
on public.task_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);

create policy "Task members can update attachment metadata"
on public.task_attachments
for update
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_attachments.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
))
with check (exists (
  select 1 from public.tasks t
  where t.id = task_attachments.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can delete attachment metadata"
on public.task_attachments
for delete
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_attachments.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "auth_global_full_access_gate"
on public.task_attachments
as restrictive
for all
to authenticated
using ((select private.is_current_session_fully_authorized()))
with check ((select private.is_current_session_fully_authorized()));

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_dependencies_pair_key unique (task_id, depends_on_task_id),
  constraint task_dependencies_not_self_check check (task_id <> depends_on_task_id)
);

create index task_dependencies_task_idx on public.task_dependencies (task_id);
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on_task_id);

alter table public.task_dependencies enable row level security;
grant select, insert, update, delete on public.task_dependencies to authenticated;

create policy "Task members can read dependencies"
on public.task_dependencies
for select
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_dependencies.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can insert dependencies"
on public.task_dependencies
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = task_dependencies.task_id
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
  and exists (
    select 1 from public.tasks t
    where t.id = task_dependencies.depends_on_task_id
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);

create policy "Task members can update dependencies"
on public.task_dependencies
for update
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_dependencies.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
))
with check (exists (
  select 1 from public.tasks t
  where t.id = task_dependencies.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "Task members can delete dependencies"
on public.task_dependencies
for delete
to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_dependencies.task_id
    and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
));

create policy "auth_global_full_access_gate"
on public.task_dependencies
as restrictive
for all
to authenticated
using ((select private.is_current_session_fully_authorized()))
with check ((select private.is_current_session_fully_authorized()));

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

create policy "Task members can read task attachment objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);

create policy "Task members can upload task attachment objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);

create policy "Task members can delete task attachment objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[2]
      and (t.user_id = auth.uid() or t.created_by_id = auth.uid() or t.current_assignee_id = auth.uid())
  )
);
