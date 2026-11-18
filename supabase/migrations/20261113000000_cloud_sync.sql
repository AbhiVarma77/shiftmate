-- ShiftMate cloud sync schema.
-- Mirrors the syncable local SQLite tables (src/database/migrations.ts) so rows
-- round-trip unchanged. Differences from local:
--   • owner_id  — the Supabase user; every row is private to its owner (RLS).
--   • server_updated_at — set by the server; devices pull changes after it.
--   • no user_id / sync_status (device-local) and no cross-table foreign keys,
--     so uploads never fail on ordering.
-- Conflicts: last writer wins by the client's updated_at (older writes are ignored).
-- Safe to run more than once.

-- ── Shared triggers ──────────────────────────────────────────────────────────

create or replace function public.shiftmate_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Last writer wins: ignore a write older than what the server already has.
    if new.updated_at < old.updated_at then
      return null;
    end if;
    new.owner_id := old.owner_id;
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;

-- Hard deletes leave a tombstone so other devices remove their copy too.
create table if not exists public.deleted_records (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity text not null,
  entity_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, entity, entity_id)
);
create index if not exists idx_deleted_records_since on public.deleted_records (owner_id, deleted_at);

-- security definer: needs to check auth.users, which clients can't read. It
-- only ever records the deleted row's own owner/id.
create or replace function public.shiftmate_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skip when the account itself is being deleted (rows cascade away with it).
  if not exists (select 1 from auth.users where id = old.owner_id) then
    return old;
  end if;
  insert into public.deleted_records (owner_id, entity, entity_id, deleted_at)
  values (old.owner_id, tg_table_name, old.id, now())
  on conflict (owner_id, entity, entity_id) do update set deleted_at = excluded.deleted_at;
  return old;
end;
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.jobs (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_name text not null,
  company_logo text,
  job_title text not null default '',
  workplace_address text,
  employment_type text not null default 'part_time',
  currency text not null default 'GBP',
  color text not null default '#10B981',
  default_start_time text,
  default_end_time text,
  default_paid_break_seconds integer not null default 0,
  default_unpaid_break_seconds integer not null default 0,
  is_active integer not null default 1,
  employment_start_date text,
  employment_end_date text,
  notes text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.job_pay_rates (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text not null,
  hourly_rate text not null,
  currency text not null,
  effective_from text not null,
  effective_until text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.job_overtime_rules (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text not null,
  daily_threshold_seconds integer,
  weekly_threshold_seconds integer,
  multiplier text not null default '1.5',
  effective_from text not null,
  effective_until text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.job_schedules (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text not null,
  name text not null default 'Weekly schedule',
  is_active integer not null default 1,
  reminders_enabled integer not null default 0,
  reminder_lead_minutes integer not null default 30,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.job_schedule_days (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  schedule_id text not null,
  job_id text not null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time text not null,
  end_time text not null,
  planned_break_seconds integer not null default 0,
  is_active integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text,
  shift_date text not null,
  start_at bigint,
  end_at bigint,
  timezone text not null,
  entry_type text not null,
  status text not null,
  planned_duration_seconds integer,
  total_duration_seconds integer not null default 0,
  paid_break_seconds integer not null default 0,
  unpaid_break_seconds integer not null default 0,
  net_work_seconds integer not null default 0,
  hourly_rate_snapshot text,
  estimated_gross_pay text,
  currency text,
  notes text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.breaks (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  shift_id text not null,
  break_type text not null,
  start_at bigint,
  end_at bigint,
  duration_seconds integer not null default 0,
  status text not null,
  notes text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.weekly_targets (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text,
  target_seconds integer not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default now()
);

-- ── Per-table wiring: triggers, pull index, row-level security ───────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'jobs', 'job_pay_rates', 'job_overtime_rules', 'job_schedules',
    'job_schedule_days', 'shifts', 'breaks', 'weekly_targets'
  ]
  loop
    execute format('drop trigger if exists shiftmate_before_write on public.%I', t);
    execute format(
      'create trigger shiftmate_before_write before insert or update on public.%I
         for each row execute function public.shiftmate_before_write()', t);

    execute format('drop trigger if exists shiftmate_after_delete on public.%I', t);
    execute format(
      'create trigger shiftmate_after_delete after delete on public.%I
         for each row execute function public.shiftmate_after_delete()', t);

    execute format(
      'create index if not exists %I on public.%I (owner_id, server_updated_at)',
      'idx_' || t || '_pull', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner can read" on public.%I', t);
    execute format('drop policy if exists "owner can insert" on public.%I', t);
    execute format('drop policy if exists "owner can update" on public.%I', t);
    execute format('drop policy if exists "owner can delete" on public.%I', t);
    execute format(
      'create policy "owner can read" on public.%I for select to authenticated
         using ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated
         with check ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "owner can update" on public.%I for update to authenticated
         using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated
         using ((select auth.uid()) = owner_id)', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

alter table public.deleted_records enable row level security;
drop policy if exists "owner can read" on public.deleted_records;
drop policy if exists "owner can insert" on public.deleted_records;
drop policy if exists "owner can update" on public.deleted_records;
create policy "owner can read" on public.deleted_records for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owner can insert" on public.deleted_records for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "owner can update" on public.deleted_records for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.deleted_records from anon;
grant select, insert, update on public.deleted_records to authenticated;

-- ── User settings (theme, week start, currency, …) — one row per account ────

create table if not exists public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at bigint not null,
  server_updated_at timestamptz not null default now()
);

drop trigger if exists shiftmate_before_write on public.user_settings;
create trigger shiftmate_before_write before insert or update on public.user_settings
  for each row execute function public.shiftmate_before_write();

alter table public.user_settings enable row level security;
drop policy if exists "owner can read" on public.user_settings;
drop policy if exists "owner can insert" on public.user_settings;
drop policy if exists "owner can update" on public.user_settings;
create policy "owner can read" on public.user_settings for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owner can insert" on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "owner can update" on public.user_settings for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;
