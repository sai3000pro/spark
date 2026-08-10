-- ─────────────────────────────────────────────────────────────────────────────
-- 001 · Extensions and identity
--
-- Every `security definer` function in this schema sets `search_path` explicitly.
-- Without it, a caller can prepend a schema they control to the search path and
-- have the function resolve THEIR `digest()` or THEIR `journeys` instead of
-- ours — which, in a function running with the definer's rights, is privilege
-- escalation rather than a bug. Extensions therefore live in their own schema
-- and are always referenced as `extensions.<fn>`.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists extensions;

create extension if not exists pgcrypto  with schema extensions;  -- gen_random_uuid, digest
create extension if not exists postgis   with schema extensions;  -- geography(Point/LineString)
create extension if not exists citext    with schema extensions;  -- case-insensitive handles/emails
create extension if not exists pg_trgm   with schema extensions;  -- ⌘K fuzzy object search

-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles
--
-- `auth.users` is Supabase's and we do not own its shape, so everything this app
-- knows about a person lives here, keyed 1:1. Anonymous users get a row too —
-- see the trigger below — because the whole guest story depends on `auth.uid()`
-- being non-null for a walker who has not signed up yet. That way not one policy
-- in 007 needs a "or is a guest" branch.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  -- Nullable: a guest has no handle until they choose one, and a unique index
  -- over nulls permits as many guests as we like.
  handle       extensions.citext unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Walker',
  avatar_url   text,
  -- The seeded demo walker (scripts/seed-demo.ts). Marked so the UI can say
  -- "this is someone else's walk" honestly, and so a purge never touches it.
  is_demo      boolean not null default false,
  -- Per-user Reconstruction Studio address. NOT a build-time env var: on a
  -- hosted deployment `localhost:8899` inside a serverless function is that
  -- function's own loopback, so a baked value cannot be correct for anyone.
  studio_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.studio_url is
  'User-configured local GPU studio. Per-user runtime config, never NEXT_PUBLIC_.';

-- Keeps profiles in lockstep with auth.users, including anonymous sign-ins.
-- `on conflict do nothing` because Supabase can re-fire this on an anonymous
-- user being converted to permanent, and that must not error.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Walker')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Generic updated_at, reused by later migrations.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();
