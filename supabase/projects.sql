create table if not exists public.projects (
  id text primary key,
  project jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_updated_at_idx on public.projects (updated_at desc);

create table if not exists public.tasks (
  id text primary key,
  type text not null,
  status text not null,
  project_id text,
  payload jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_status_updated_at_idx on public.tasks (status, updated_at desc);

-- Optional trigger to keep updated_at fresh for direct SQL edits.
create or replace function public.set_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row
execute function public.set_projects_updated_at();

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_tasks_updated_at();
