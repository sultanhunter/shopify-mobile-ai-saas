-- SaaS runtime control-plane migration
-- Copy/paste this file in Supabase SQL editor.

begin;

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

-- Optional legacy backfill from old tables (if they exist).
do $$
begin
  if to_regclass('public.project_runtime_state') is not null then
    execute $sql$
      insert into public.project_runtime_config (project_id, config_json, version, created_at, updated_at)
      select
        project_id,
        coalesce(config_json, '{}'::jsonb),
        coalesce(version, 0),
        coalesce(created_at, now()),
        coalesce(updated_at, now())
      from public.project_runtime_state
      on conflict (project_id) do update
      set
        config_json = excluded.config_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    $sql$;

    begin
      execute $sql$
        insert into public.project_runtime_secrets (project_id, secrets_enc_json, created_at, updated_at)
        select
          project_id,
          coalesce(secrets_enc_json, '{}'::jsonb),
          coalesce(created_at, now()),
          coalesce(updated_at, now())
        from public.project_runtime_state
        on conflict (project_id) do update
        set
          secrets_enc_json = excluded.secrets_enc_json,
          updated_at = excluded.updated_at
      $sql$;
    exception
      when undefined_column then
        execute $sql$
          insert into public.project_runtime_secrets (project_id, secrets_enc_json, created_at, updated_at)
          select
            project_id,
            coalesce(secrets_json, '{}'::jsonb),
            coalesce(created_at, now()),
            coalesce(updated_at, now())
          from public.project_runtime_state
          on conflict (project_id) do update
          set
            secrets_enc_json = excluded.secrets_enc_json,
            updated_at = excluded.updated_at
        $sql$;
    end;
  end if;

  if to_regclass('public.runtime_sync_events') is not null then
    begin
      execute $sql$
        insert into public.runtime_sync_outbox (project_id, version, status, attempts, last_error, created_at, updated_at)
        select
          project_id,
          coalesce(version, 0),
          case
            when status in ('pending', 'delivered', 'failed') then status
            else 'pending'
          end,
          coalesce(attempts, 0),
          last_error,
          coalesce(created_at, now()),
          coalesce(updated_at, now())
        from public.runtime_sync_events
      $sql$;
    exception
      when undefined_column then
        execute $sql$
          insert into public.runtime_sync_outbox (project_id, version, status, attempts, created_at, updated_at)
          select
            project_id,
            coalesce(version, 0),
            'pending',
            0,
            coalesce(created_at, now()),
            coalesce(updated_at, now())
          from public.runtime_sync_events
        $sql$;
    end;
  end if;
end;
$$;

commit;
