-- IRL Career Mode: player accounts and career data.
--
-- Run this once in the Supabase dashboard (SQL Editor → New query → paste → Run),
-- or with `supabase db push` if you use the Supabase CLI. It is safe to run again.
--
-- Each player owns one profile row and one row per match. Row-level security
-- means a signed-in player can only ever read or change their own rows, even
-- though the browser talks to the database directly with the publishable key.

-- Tables -------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The app's PlayerProfile, validated in the browser before it is written.
  -- The size cap leaves room for a compressed profile picture.
  data jsonb not null
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 600000),
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  -- The app's Match record, validated in the browser before it is written.
  data jsonb not null
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 64000),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Access -------------------------------------------------------------------

-- Only signed-in players reach these tables, and only through the policies below.
revoke all on public.profiles, public.matches from anon;
grant select, insert, update, delete on public.profiles, public.matches to authenticated;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;

drop policy if exists "Players read their own profile" on public.profiles;
create policy "Players read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players create their own profile" on public.profiles;
create policy "Players create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Players update their own profile" on public.profiles;
create policy "Players update their own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Players delete their own profile" on public.profiles;
create policy "Players delete their own profile" on public.profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players read their own matches" on public.matches;
create policy "Players read their own matches" on public.matches
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Players log their own matches" on public.matches;
create policy "Players log their own matches" on public.matches
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Players edit their own matches" on public.matches;
create policy "Players edit their own matches" on public.matches
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Players delete their own matches" on public.matches;
create policy "Players delete their own matches" on public.matches
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Bookkeeping ----------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists matches_touch_updated_at on public.matches;
create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function public.touch_updated_at();

-- Self-service account deletion -----------------------------------------------

-- Deletes the calling player's login. Their profile and matches go with it
-- through the cascading foreign keys above.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
