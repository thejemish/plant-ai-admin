-- Farmer-assistant readiness migration.
-- Adds Supastash prerequisites (get_table_schema + arrived_at + trigger),
-- new tables (pests, ask_threads, ask_messages, action_progress),
-- column gaps on scans, pest-assets storage bucket, and indexes.

-- =========================================================================
-- 1. Supastash schema-reflection function
-- =========================================================================

create or replace function public.get_table_schema(table_name text)
returns table(column_name text, data_type text, is_nullable text)
language sql
security definer
set search_path = public
as $$
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and information_schema.columns.table_name = $1;
$$;

grant execute on function public.get_table_schema(text) to anon, authenticated;

-- =========================================================================
-- 2. arrived_at trigger function (server-side replication mode)
-- =========================================================================

create or replace function public.set_arrived_at()
returns trigger
language plpgsql
as $$
begin
  new.arrived_at = now();
  return new;
end;
$$;

-- Supastash expects every synced table to expose an `id` column. The existing
-- embedding table used `sample_id` as its primary key, so mirror it into `id`
-- for sync compatibility while keeping the original relationship intact.
alter table public.leaf_sample_embeddings
  add column if not exists id uuid;

update public.leaf_sample_embeddings
set id = sample_id
where id is null;

alter table public.leaf_sample_embeddings
  alter column id set default gen_random_uuid(),
  alter column id set not null;

create unique index if not exists leaf_sample_embeddings_id_key
  on public.leaf_sample_embeddings(id);

-- Add arrived_at column + trigger to every Supastash-synced table.
-- Backfill arrived_at = updated_at on first-time install so the replication
-- cursor reflects historical change ordering, not the migration timestamp.
do $$
declare
  t text;
  col_added boolean;
  synced_tables text[] := array[
    'crops','diseases','disease_treatments','guide_documents',
    'leaf_samples','leaf_sample_embeddings','guide_chunks',
    'translations','crop_stage_rules','user_profiles',
    'fields','scans'
  ];
begin
  foreach t in array synced_tables loop
    select not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = t
        and column_name = 'arrived_at'
    ) into col_added;

    execute format(
      'alter table public.%I add column if not exists arrived_at timestamptz not null default now()',
      t
    );

    if col_added then
      execute format(
        'update public.%I set arrived_at = updated_at where arrived_at >= updated_at',
        t
      );
    end if;

    execute format(
      'drop trigger if exists set_%I_arrived_at on public.%I',
      t, t
    );
    execute format(
      'create trigger set_%I_arrived_at before insert or update on public.%I for each row execute function public.set_arrived_at()',
      t, t
    );
  end loop;
end$$;

-- =========================================================================
-- 3. scans column gaps (outcome feedback loop, model version pinning)
-- =========================================================================

alter table public.scans
  add column if not exists outcome text,
  add column if not exists outcome_at timestamptz,
  add column if not exists model_version text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scans_outcome_check'
  ) then
    alter table public.scans
      add constraint scans_outcome_check
      check (outcome is null or outcome in ('worked','partial','didnt_work'));
  end if;
end$$;

-- =========================================================================
-- 4. Pests reference table
-- =========================================================================

create table if not exists public.pests (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  scientific_name text,
  crops text[] not null default '{}',
  image_url text,
  identification text,
  damage text,
  organic_md text,
  chemical_md text,
  beneficials text,
  region text,
  status text not null default 'draft',
  arrived_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pests_status_check check (status in ('draft','review','published','archived'))
);

drop trigger if exists set_pests_updated_at on public.pests;
create trigger set_pests_updated_at before update on public.pests
  for each row execute function public.set_updated_at();

drop trigger if exists set_pests_arrived_at on public.pests;
create trigger set_pests_arrived_at before insert or update on public.pests
  for each row execute function public.set_arrived_at();

alter table public.pests enable row level security;

drop policy if exists "public reads published pests" on public.pests;
create policy "public reads published pests" on public.pests
  for select using (status = 'published' and deleted_at is null);

drop policy if exists "admins manage pests" on public.pests;
create policy "admins manage pests" on public.pests
  for all using (public.has_admin_role(array['superadmin','agronomist','curator']))
  with check (public.has_admin_role(array['superadmin','agronomist','curator']));

-- =========================================================================
-- 5. Ask threads (chat conversations with Gemma)
-- =========================================================================

create table if not exists public.ask_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  crop text references public.crops(id),
  disease_id uuid references public.diseases(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  lang text not null default 'en',
  last_message_at timestamptz,
  arrived_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_ask_threads_updated_at on public.ask_threads;
create trigger set_ask_threads_updated_at before update on public.ask_threads
  for each row execute function public.set_updated_at();

drop trigger if exists set_ask_threads_arrived_at on public.ask_threads;
create trigger set_ask_threads_arrived_at before insert or update on public.ask_threads
  for each row execute function public.set_arrived_at();

alter table public.ask_threads enable row level security;

drop policy if exists "users manage own threads" on public.ask_threads;
create policy "users manage own threads" on public.ask_threads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "admins read threads" on public.ask_threads;
create policy "admins read threads" on public.ask_threads
  for select using (public.is_admin());

-- =========================================================================
-- 6. Ask messages
-- =========================================================================

create table if not exists public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ask_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  text text not null,
  citations jsonb,
  image_uri text,
  tokens_in int,
  tokens_out int,
  model_version text,
  arrived_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ask_messages_role_check check (role in ('user','assistant','system'))
);

drop trigger if exists set_ask_messages_updated_at on public.ask_messages;
create trigger set_ask_messages_updated_at before update on public.ask_messages
  for each row execute function public.set_updated_at();

drop trigger if exists set_ask_messages_arrived_at on public.ask_messages;
create trigger set_ask_messages_arrived_at before insert or update on public.ask_messages
  for each row execute function public.set_arrived_at();

alter table public.ask_messages enable row level security;

drop policy if exists "users manage own messages" on public.ask_messages;
create policy "users manage own messages" on public.ask_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "admins read messages" on public.ask_messages;
create policy "admins read messages" on public.ask_messages
  for select using (public.is_admin());

-- =========================================================================
-- 7. Action progress (treatment plan checkboxes + outcomes)
-- =========================================================================

create table if not exists public.action_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete cascade,
  field_id uuid references public.fields(id) on delete set null,
  treatment_id uuid references public.disease_treatments(id) on delete set null,
  step_key text not null,
  step_label text,
  done_at timestamptz,
  outcome text,
  notify_id text,
  scheduled_for timestamptz,
  arrived_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_progress_outcome_check check (
    outcome is null or outcome in ('worked','partial','didnt_work','skipped')
  )
);

drop trigger if exists set_action_progress_updated_at on public.action_progress;
create trigger set_action_progress_updated_at before update on public.action_progress
  for each row execute function public.set_updated_at();

drop trigger if exists set_action_progress_arrived_at on public.action_progress;
create trigger set_action_progress_arrived_at before insert or update on public.action_progress
  for each row execute function public.set_arrived_at();

alter table public.action_progress enable row level security;

drop policy if exists "users manage own progress" on public.action_progress;
create policy "users manage own progress" on public.action_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "admins read progress" on public.action_progress;
create policy "admins read progress" on public.action_progress
  for select using (public.is_admin());

-- =========================================================================
-- 8. Indexes for mobile-first reads
-- =========================================================================

create index if not exists scans_field_idx
  on public.scans(field_id) where deleted_at is null;
create index if not exists scans_user_field_idx
  on public.scans(user_id, field_id, created_at desc) where deleted_at is null;

create index if not exists action_progress_user_idx
  on public.action_progress(user_id, scan_id) where deleted_at is null;
create index if not exists action_progress_scheduled_idx
  on public.action_progress(scheduled_for) where deleted_at is null and done_at is null;

create index if not exists ask_messages_thread_idx
  on public.ask_messages(thread_id, created_at) where deleted_at is null;
create index if not exists ask_threads_user_idx
  on public.ask_threads(user_id, last_message_at desc) where deleted_at is null;

create index if not exists pests_status_idx
  on public.pests(status) where deleted_at is null;
create index if not exists pests_crops_idx
  on public.pests using gin(crops);

-- =========================================================================
-- 9. Pest assets storage bucket
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pest-assets', 'pest-assets', true, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads pest assets" on storage.objects;
create policy "public reads pest assets" on storage.objects
  for select using (bucket_id = 'pest-assets');

drop policy if exists "admins manage pest assets" on storage.objects;
create policy "admins manage pest assets" on storage.objects
  for all using (
    bucket_id = 'pest-assets'
    and public.has_admin_role(array['superadmin','agronomist','curator'])
  ) with check (
    bucket_id = 'pest-assets'
    and public.has_admin_role(array['superadmin','agronomist','curator'])
  );

-- =========================================================================
-- 10. Realtime publication
-- Supastash useSupastashData({ realtime: true }) requires tables in the
-- supabase_realtime publication. Add them idempotently.
-- =========================================================================

do $$
declare
  t text;
  realtime_tables text[] := array[
    'crops','diseases','disease_treatments','guide_documents',
    'leaf_samples','leaf_sample_embeddings','guide_chunks',
    'translations','crop_stage_rules','pests',
    'fields','scans','ask_threads','ask_messages','action_progress'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array realtime_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
