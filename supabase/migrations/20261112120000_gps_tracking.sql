-- IRL Career Mode: GPS tracking imports.
--
-- Run after 20261105120000_accounts.sql, the same way (SQL Editor → paste →
-- Run, or `supabase db push`). It is safe to run again.
--
-- Three tables and one private storage bucket, all owner-only:
--   gps_calibrations    named pitch calibrations a player saves and reuses
--   gps_imports         one row per uploaded source file (GPX, TCX or FIT)
--   match_gps_tracks    a processed import attached to one of the player's
--                       matches: quality, metrics and the heatmap grid
--
-- Matches themselves are never changed by anything here. Tracking rows hang
-- off a match through a composite foreign key on (user_id, match_id), so a
-- player can only ever attach tracking to a match they own, and deleting the
-- match deletes its tracking with it.

-- Tables -------------------------------------------------------------------

create table if not exists public.gps_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- The app's PitchCalibration (four corners, length, width, preset).
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, name)
);

create table if not exists public.gps_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- SHA-256 of the exact file bytes, for duplicate detection per player.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  format text not null check (format in ('gpx', 'tcx', 'fit')),
  file_name text check (file_name is null or char_length(file_name) <= 200),
  byte_size integer not null check (byte_size between 1 and 26214400),
  -- Private storage object: "<user_id>/<import id>.<format>", nothing else.
  storage_path text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  point_count integer not null check (point_count between 1 and 250000),
  -- Provenance only (creator, sport, parser version). Never coordinates.
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) < 4000),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, fingerprint),
  check (ended_at >= started_at and ended_at - started_at <= interval '12 hours'),
  check (storage_path = user_id::text || '/' || id::text || '.' || format)
);

create table if not exists public.match_gps_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  match_id text not null,
  import_id uuid not null,
  calibration_id uuid,
  -- Only one active track per match for now; the model allows several sessions later.
  is_active boolean not null default true,
  -- Which heatmap the match page shows. Manual zones stay on the match itself.
  heatmap_source text not null default 'gps' check (heatmap_source in ('gps', 'manual')),
  algorithm_version integer not null check (algorithm_version between 1 and 1000),
  quality text not null check (quality in ('usable', 'approximate')),
  -- Metrics, quality reasons, counts, intervals and calibration: enough to regenerate.
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) < 32000),
  -- The quantised density grid. Loaded only when a heatmap is drawn.
  heatmap jsonb not null check (jsonb_typeof(heatmap) = 'object' and pg_column_size(heatmap) < 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, match_id) references public.matches (user_id, id) on delete cascade,
  foreign key (user_id, import_id) references public.gps_imports (user_id, id) on delete cascade,
  foreign key (user_id, calibration_id) references public.gps_calibrations (user_id, id) on delete set null (calibration_id)
);

create unique index if not exists match_gps_tracks_one_active
  on public.match_gps_tracks (user_id, match_id) where is_active;
create index if not exists match_gps_tracks_import on public.match_gps_tracks (user_id, import_id);
create index if not exists match_gps_tracks_calibration on public.match_gps_tracks (user_id, calibration_id);

-- Access -------------------------------------------------------------------

revoke all on public.gps_calibrations, public.gps_imports, public.match_gps_tracks from anon;
grant select, insert, update, delete on public.gps_calibrations to authenticated;
-- Imports are immutable once uploaded: replace means a new import.
grant select, insert, delete on public.gps_imports to authenticated;
grant select, insert, update, delete on public.match_gps_tracks to authenticated;

alter table public.gps_calibrations enable row level security;
alter table public.gps_imports enable row level security;
alter table public.match_gps_tracks enable row level security;

drop policy if exists "Players read their own calibrations" on public.gps_calibrations;
create policy "Players read their own calibrations" on public.gps_calibrations
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players save their own calibrations" on public.gps_calibrations;
create policy "Players save their own calibrations" on public.gps_calibrations
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players edit their own calibrations" on public.gps_calibrations;
create policy "Players edit their own calibrations" on public.gps_calibrations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Players delete their own calibrations" on public.gps_calibrations;
create policy "Players delete their own calibrations" on public.gps_calibrations
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players read their own imports" on public.gps_imports;
create policy "Players read their own imports" on public.gps_imports
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players add their own imports" on public.gps_imports;
create policy "Players add their own imports" on public.gps_imports
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players delete their own imports" on public.gps_imports;
create policy "Players delete their own imports" on public.gps_imports
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players read their own tracks" on public.match_gps_tracks;
create policy "Players read their own tracks" on public.match_gps_tracks
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players add their own tracks" on public.match_gps_tracks;
create policy "Players add their own tracks" on public.match_gps_tracks
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players edit their own tracks" on public.match_gps_tracks;
create policy "Players edit their own tracks" on public.match_gps_tracks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Players delete their own tracks" on public.match_gps_tracks;
create policy "Players delete their own tracks" on public.match_gps_tracks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Tracking rows can't be moved to another match, import or player.
create or replace function public.gps_tracks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.match_id is distinct from old.match_id
    or new.import_id is distinct from old.import_id then
    raise exception 'GPS tracks cannot be moved to another match, import or player';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists match_gps_tracks_guard on public.match_gps_tracks;
create trigger match_gps_tracks_guard
  before update on public.match_gps_tracks
  for each row execute function public.gps_tracks_guard();

drop trigger if exists gps_calibrations_touch_updated_at on public.gps_calibrations;
create trigger gps_calibrations_touch_updated_at
  before update on public.gps_calibrations
  for each row execute function public.touch_updated_at();

-- Attaching -------------------------------------------------------------------

-- Attaches a processed import to one of the caller's matches, replacing any
-- active track on that match in the same transaction, so a failure leaves
-- the previous track in place. It runs with the caller's rights (security
-- invoker), so row-level security applies to every statement inside it.
-- Returns the new track id and the import the replaced track used (if any),
-- so the app can clean up a source file nothing refers to any more.
create or replace function public.attach_gps_track(
  p_match_id text,
  p_import_id uuid,
  p_calibration_id uuid,
  p_algorithm_version integer,
  p_quality text,
  p_summary jsonb,
  p_heatmap jsonb
)
returns table (track_id uuid, replaced_import_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_previous_import uuid;
  v_source text := 'gps';
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- Ownership is checked here for a clear error; the foreign keys enforce it regardless.
  if not exists (select 1 from public.matches m where m.user_id = v_user and m.id = p_match_id) then
    raise exception 'Match not found for this player' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.gps_imports i where i.user_id = v_user and i.id = p_import_id) then
    raise exception 'Import not found for this player' using errcode = 'P0002';
  end if;
  if p_summary ->> 'schemaVersion' is distinct from '1'
    or (p_summary ->> 'algorithmVersion')::integer is distinct from p_algorithm_version
    or p_summary -> 'quality' ->> 'level' is distinct from p_quality
    or jsonb_typeof(p_summary -> 'intervals') is distinct from 'array'
    or jsonb_array_length(p_summary -> 'intervals') not between 1 and 20 then
    raise exception 'Tracking summary is invalid' using errcode = '22023';
  end if;
  if p_heatmap ->> 'encoding' is distinct from 'u16-base64'
    or jsonb_typeof(p_heatmap -> 'data') is distinct from 'string' then
    raise exception 'Heatmap is invalid' using errcode = '22023';
  end if;

  select t.import_id, t.heatmap_source into v_previous_import, v_source
  from public.match_gps_tracks t
  where t.user_id = v_user and t.match_id = p_match_id and t.is_active
  for update;

  delete from public.match_gps_tracks t
  where t.user_id = v_user and t.match_id = p_match_id and t.is_active;

  insert into public.match_gps_tracks
    (user_id, match_id, import_id, calibration_id, algorithm_version, quality, summary, heatmap, heatmap_source)
  values
    (v_user, p_match_id, p_import_id, p_calibration_id, p_algorithm_version, p_quality, p_summary, p_heatmap, coalesce(v_source, 'gps'))
  returning id into track_id;

  replaced_import_id := case when v_previous_import is distinct from p_import_id then v_previous_import end;
  return next;
end;
$$;

revoke all on function public.attach_gps_track(text, uuid, uuid, integer, text, jsonb, jsonb) from public, anon;
grant execute on function public.attach_gps_track(text, uuid, uuid, integer, text, jsonb, jsonb) to authenticated;

-- Source files ------------------------------------------------------------------

-- A private bucket: no public URLs, 25 MB per file, uploaded as opaque bytes
-- (the app checks the real format from the contents, never the MIME type).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gps-files', 'gps-files', false, 26214400, array['application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects live at "<user_id>/<import id>.<format>". Players can read, add and
-- delete only inside their own folder, and can't overwrite (no update policy).
drop policy if exists "Players read their own GPS files" on storage.objects;
create policy "Players read their own GPS files" on storage.objects
  for select to authenticated
  using (bucket_id = 'gps-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Players upload their own GPS files" on storage.objects;
create policy "Players upload their own GPS files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gps-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(gpx|tcx|fit)$'
  );

drop policy if exists "Players delete their own GPS files" on storage.objects;
create policy "Players delete their own GPS files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'gps-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
