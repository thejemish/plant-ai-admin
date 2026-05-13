create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.crops (
  id text primary key,
  display_name text not null,
  aliases jsonb not null default '{}'::jsonb,
  family text,
  icon_url text,
  status text not null default 'published',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crops_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.diseases (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  scientific_name text,
  crops text[] not null,
  aliases jsonb not null default '{}'::jsonb,
  cause text,
  symptoms text[] not null default '{}',
  symptoms_md text,
  prevention_md text,
  severity_levels jsonb not null default '[]'::jsonb,
  is_healthy boolean not null default false,
  status text not null default 'draft',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diseases_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.disease_treatments (
  id uuid primary key default gen_random_uuid(),
  disease_id uuid references public.diseases(id) on delete cascade,
  crop text references public.crops(id),
  severity text not null default 'any',
  method text not null,
  title text not null,
  steps_md text not null,
  dosage jsonb,
  safety_notes_md text,
  days_to_recover int,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disease_treatments_method_check check (method in ('organic', 'chemical', 'cultural', 'prevention')),
  constraint disease_treatments_severity_check check (severity in ('any', 'mild', 'moderate', 'severe')),
  constraint disease_treatments_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.guide_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,
  source_url text,
  source_type text,
  crops text[] not null default '{}',
  region text,
  lang text not null default 'en',
  raw_text text,
  status text not null default 'draft',
  uploaded_by uuid references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_documents_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.leaf_samples (
  id uuid primary key default gen_random_uuid(),
  disease_id uuid references public.diseases(id) on delete set null,
  crop text not null references public.crops(id),
  disease_label text not null,
  source text not null default 'manual',
  source_file_name text,
  caption text,
  symptoms_text text,
  image_url text not null,
  image_thumb_url text,
  region text,
  crop_stage text,
  verified boolean not null default false,
  verified_by uuid references auth.users(id),
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaf_samples_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.leaf_sample_embeddings (
  sample_id uuid primary key references public.leaf_samples(id) on delete cascade,
  model_id text not null,
  preprocess_id text not null,
  dim int not null,
  normalized boolean not null default true,
  embedding_base64 text not null,
  embedding vector(512),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaf_sample_embeddings_dim_check check (dim > 0)
);

create table if not exists public.guide_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.guide_documents(id) on delete cascade,
  chunk_idx int not null,
  chunk_text text not null,
  heading_path text[] not null default '{}',
  page_number int,
  crop text references public.crops(id),
  disease_id uuid references public.diseases(id) on delete set null,
  category text,
  stage text,
  symptoms text[] not null default '{}',
  lang text not null default 'en',
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_chunks_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.translations (
  id uuid primary key default gen_random_uuid(),
  ref_table text not null,
  ref_id uuid not null,
  field_name text not null,
  source_lang text not null default 'en',
  target_lang text not null,
  source_text text not null,
  machine_text text,
  human_text text,
  status text not null default 'pending',
  translator_id uuid references auth.users(id),
  approved_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint translations_status_check check (status in ('pending', 'review', 'approved', 'archived'))
);

create table if not exists public.crop_stage_rules (
  id uuid primary key default gen_random_uuid(),
  crop text not null references public.crops(id),
  stage text not null,
  day_start int not null,
  day_end int not null,
  tasks jsonb not null default '[]'::jsonb,
  region text,
  status text not null default 'published',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_stage_rules_day_range_check check (day_start <= day_end),
  constraint crop_stage_rules_status_check check (status in ('draft', 'review', 'published', 'archived'))
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  village text,
  district text,
  state text,
  preferred_lang text not null default 'en',
  primary_crops text[] not null default '{}',
  farm_size_acres numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  crop text references public.crops(id),
  variety text,
  sowing_date date,
  area_acres numeric,
  lat double precision,
  lng double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field_id uuid references public.fields(id) on delete set null,
  local_image_uri text,
  image_url text,
  predicted_crop text references public.crops(id),
  predicted_disease_id uuid references public.diseases(id),
  predicted_disease_label text,
  severity text,
  confidence numeric,
  top_matches jsonb,
  embedding_model_id text,
  embedding_preprocess_id text,
  symptoms text[] not null default '{}',
  model_json jsonb,
  user_correction text,
  shared_anon boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint admin_users_role_check check (role in ('superadmin', 'agronomist', 'curator', 'translator', 'viewer'))
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb,
  status text not null default 'queued',
  progress numeric not null default 0,
  error text,
  attempts int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled'))
);

create table if not exists public.embedding_models (
  id text primary key,
  display_name text not null,
  dim int not null,
  preprocess_id text not null,
  image_encoder_path text,
  text_encoder_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kb_snapshots (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  size_bytes bigint,
  storage_path text not null,
  manifest jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diseases_status_idx on public.diseases(status) where deleted_at is null;
create index if not exists diseases_crops_idx on public.diseases using gin(crops);
create index if not exists disease_treatments_lookup_idx on public.disease_treatments(disease_id, crop, severity, method) where deleted_at is null;
create index if not exists guide_documents_status_idx on public.guide_documents(status) where deleted_at is null;
create index if not exists leaf_samples_lookup_idx on public.leaf_samples(status, crop, disease_label) where deleted_at is null;
create index if not exists leaf_samples_disease_idx on public.leaf_samples(disease_id);
create index if not exists leaf_sample_embeddings_model_idx on public.leaf_sample_embeddings(model_id, preprocess_id) where deleted_at is null;
create index if not exists guide_chunks_filter_idx on public.guide_chunks(status, crop, category, stage, lang) where deleted_at is null;
create index if not exists guide_chunks_disease_idx on public.guide_chunks(disease_id);
create index if not exists translations_lookup_idx on public.translations(ref_table, ref_id, target_lang, field_name) where deleted_at is null;
create index if not exists crop_stage_rules_lookup_idx on public.crop_stage_rules(crop, stage, region) where deleted_at is null;
create index if not exists fields_user_idx on public.fields(user_id) where deleted_at is null;
create index if not exists scans_user_idx on public.scans(user_id, created_at desc) where deleted_at is null;
create index if not exists jobs_status_idx on public.jobs(status, type, created_at);
create index if not exists kb_snapshots_version_idx on public.kb_snapshots(version desc);

drop trigger if exists set_crops_updated_at on public.crops;
create trigger set_crops_updated_at before update on public.crops for each row execute function public.set_updated_at();
drop trigger if exists set_diseases_updated_at on public.diseases;
create trigger set_diseases_updated_at before update on public.diseases for each row execute function public.set_updated_at();
drop trigger if exists set_disease_treatments_updated_at on public.disease_treatments;
create trigger set_disease_treatments_updated_at before update on public.disease_treatments for each row execute function public.set_updated_at();
drop trigger if exists set_guide_documents_updated_at on public.guide_documents;
create trigger set_guide_documents_updated_at before update on public.guide_documents for each row execute function public.set_updated_at();
drop trigger if exists set_leaf_samples_updated_at on public.leaf_samples;
create trigger set_leaf_samples_updated_at before update on public.leaf_samples for each row execute function public.set_updated_at();
drop trigger if exists set_leaf_sample_embeddings_updated_at on public.leaf_sample_embeddings;
create trigger set_leaf_sample_embeddings_updated_at before update on public.leaf_sample_embeddings for each row execute function public.set_updated_at();
drop trigger if exists set_guide_chunks_updated_at on public.guide_chunks;
create trigger set_guide_chunks_updated_at before update on public.guide_chunks for each row execute function public.set_updated_at();
drop trigger if exists set_translations_updated_at on public.translations;
create trigger set_translations_updated_at before update on public.translations for each row execute function public.set_updated_at();
drop trigger if exists set_crop_stage_rules_updated_at on public.crop_stage_rules;
create trigger set_crop_stage_rules_updated_at before update on public.crop_stage_rules for each row execute function public.set_updated_at();
drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
drop trigger if exists set_fields_updated_at on public.fields;
create trigger set_fields_updated_at before update on public.fields for each row execute function public.set_updated_at();
drop trigger if exists set_scans_updated_at on public.scans;
create trigger set_scans_updated_at before update on public.scans for each row execute function public.set_updated_at();
drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at before update on public.jobs for each row execute function public.set_updated_at();
drop trigger if exists set_embedding_models_updated_at on public.embedding_models;
create trigger set_embedding_models_updated_at before update on public.embedding_models for each row execute function public.set_updated_at();
drop trigger if exists set_kb_snapshots_updated_at on public.kb_snapshots;
create trigger set_kb_snapshots_updated_at before update on public.kb_snapshots for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.has_admin_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

alter table public.crops enable row level security;
alter table public.diseases enable row level security;
alter table public.disease_treatments enable row level security;
alter table public.guide_documents enable row level security;
alter table public.leaf_samples enable row level security;
alter table public.leaf_sample_embeddings enable row level security;
alter table public.guide_chunks enable row level security;
alter table public.translations enable row level security;
alter table public.crop_stage_rules enable row level security;
alter table public.user_profiles enable row level security;
alter table public.fields enable row level security;
alter table public.scans enable row level security;
alter table public.admin_users enable row level security;
alter table public.jobs enable row level security;
alter table public.embedding_models enable row level security;
alter table public.kb_snapshots enable row level security;

create policy "public reads published crops" on public.crops
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage crops" on public.crops
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "public reads published diseases" on public.diseases
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage diseases" on public.diseases
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "public reads published treatments" on public.disease_treatments
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage treatments" on public.disease_treatments
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "public reads published guide documents" on public.guide_documents
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage guide documents" on public.guide_documents
  for all using (public.has_admin_role(array['superadmin', 'curator'])) with check (public.has_admin_role(array['superadmin', 'curator']));

create policy "public reads verified published leaf samples" on public.leaf_samples
  for select using (status = 'published' and verified = true and deleted_at is null);
create policy "admins manage leaf samples" on public.leaf_samples
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "public reads verified published leaf embeddings" on public.leaf_sample_embeddings
  for select using (
    deleted_at is null
    and exists (
      select 1
      from public.leaf_samples
      where leaf_samples.id = leaf_sample_embeddings.sample_id
        and leaf_samples.status = 'published'
        and leaf_samples.verified = true
        and leaf_samples.deleted_at is null
    )
  );
create policy "admins manage leaf embeddings" on public.leaf_sample_embeddings
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "public reads published guide chunks" on public.guide_chunks
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage guide chunks" on public.guide_chunks
  for all using (public.has_admin_role(array['superadmin', 'curator'])) with check (public.has_admin_role(array['superadmin', 'curator']));

create policy "public reads approved translations" on public.translations
  for select using (status = 'approved' and deleted_at is null);
create policy "admins manage translations" on public.translations
  for all using (public.has_admin_role(array['superadmin', 'curator', 'translator'])) with check (public.has_admin_role(array['superadmin', 'curator', 'translator']));

create policy "public reads published crop stage rules" on public.crop_stage_rules
  for select using (status = 'published' and deleted_at is null);
create policy "admins manage crop stage rules" on public.crop_stage_rules
  for all using (public.has_admin_role(array['superadmin', 'agronomist', 'curator'])) with check (public.has_admin_role(array['superadmin', 'agronomist', 'curator']));

create policy "users manage own profile" on public.user_profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy "admins read profiles" on public.user_profiles
  for select using (public.is_admin());

create policy "users manage own fields" on public.fields
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins read fields" on public.fields
  for select using (public.is_admin());

create policy "users manage own scans" on public.scans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins read shared scans" on public.scans
  for select using (public.is_admin() and shared_anon = true and deleted_at is null);

create policy "admins read admin users" on public.admin_users
  for select using (public.is_admin());
create policy "superadmins manage admin users" on public.admin_users
  for all using (public.has_admin_role(array['superadmin'])) with check (public.has_admin_role(array['superadmin']));

create policy "admins manage jobs" on public.jobs
  for all using (public.has_admin_role(array['superadmin', 'curator'])) with check (public.has_admin_role(array['superadmin', 'curator']));

create policy "public reads active embedding models" on public.embedding_models
  for select using (active = true);
create policy "admins manage embedding models" on public.embedding_models
  for all using (public.has_admin_role(array['superadmin', 'curator'])) with check (public.has_admin_role(array['superadmin', 'curator']));

create policy "public reads snapshots" on public.kb_snapshots
  for select using (true);
create policy "admins manage snapshots" on public.kb_snapshots
  for all using (public.has_admin_role(array['superadmin', 'curator'])) with check (public.has_admin_role(array['superadmin', 'curator']));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('leaves', 'leaves', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('guides-raw', 'guides-raw', false, 52428800, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown', 'text/plain']),
  ('guide-assets', 'guide-assets', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('scans', 'scans', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('kb-snapshots', 'kb-snapshots', true, 209715200, array['application/octet-stream', 'application/x-sqlite3', 'application/gzip'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public reads published plant assets" on storage.objects
  for select using (bucket_id in ('leaves', 'guide-assets', 'kb-snapshots'));

create policy "admins manage curated plant assets" on storage.objects
  for all using (
    bucket_id in ('leaves', 'guides-raw', 'guide-assets', 'kb-snapshots')
    and public.has_admin_role(array['superadmin', 'agronomist', 'curator'])
  ) with check (
    bucket_id in ('leaves', 'guides-raw', 'guide-assets', 'kb-snapshots')
    and public.has_admin_role(array['superadmin', 'agronomist', 'curator'])
  );

create policy "users manage own scan uploads" on storage.objects
  for all using (
    bucket_id = 'scans'
    and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'scans'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

