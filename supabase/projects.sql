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

create table if not exists public.project_runtime_config (
  project_id text primary key,
  config_json jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_runtime_secrets (
  project_id text primary key,
  secrets_enc_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runtime_sync_outbox (
  id bigserial primary key,
  project_id text not null,
  version bigint not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_sync_outbox_project_status_idx
  on public.runtime_sync_outbox (project_id, status, updated_at desc);

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

create or replace function public.set_project_runtime_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_project_runtime_secrets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_runtime_sync_outbox_updated_at()
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

drop trigger if exists trg_project_runtime_config_updated_at on public.project_runtime_config;
create trigger trg_project_runtime_config_updated_at
before update on public.project_runtime_config
for each row
execute function public.set_project_runtime_config_updated_at();

drop trigger if exists trg_project_runtime_secrets_updated_at on public.project_runtime_secrets;
create trigger trg_project_runtime_secrets_updated_at
before update on public.project_runtime_secrets
for each row
execute function public.set_project_runtime_secrets_updated_at();

drop trigger if exists trg_runtime_sync_outbox_updated_at on public.runtime_sync_outbox;
create trigger trg_runtime_sync_outbox_updated_at
before update on public.runtime_sync_outbox
for each row
execute function public.set_runtime_sync_outbox_updated_at();
