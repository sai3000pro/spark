-- ─────────────────────────────────────────────────────────────────────────────
-- A minimal stand-in for the parts of Supabase that our migrations depend on.
--
-- Supabase provides `auth.users`, `auth.uid()` and `auth.jwt()`; a plain
-- Postgres does not, so migrations referencing them cannot even parse against
-- one. This shim supplies just enough to apply the schema and then to EXERCISE
-- it — which is the point. The RLS regression suite needs to answer "what can
-- this user see" for four different users, and the only honest way to do that is
-- to actually be them.
--
-- `auth.uid()` reads a session GUC rather than a real JWT, so a test can switch
-- identity with `set local request.jwt.claim.sub = '<uuid>'`. That is the same
-- mechanism PostgREST uses in production, so policies are exercised through the
-- real code path and not a mock.
--
-- FOR TESTS AND LOCAL VALIDATION ONLY. Never applied to a Supabase project,
-- where all of this already exists and is not ours to redefine.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Make this container look like Supabase before anything else runs ────────
--
-- Supabase installs PostGIS (and pgcrypto, citext, pg_trgm) into the
-- `extensions` schema, so the migrations qualify types as
-- `extensions.geography(...)`. The stock postgis/postgis image instead installs
-- PostGIS into `public` at build time, which makes those references fail with
-- `type "extensions.geography" does not exist`.
--
-- That is a mismatch in the HARNESS, not in the schema, so it is corrected here
-- rather than by unqualifying the production SQL. Relocating the extension is
-- what makes the local run exercise the same names Supabase will.
create schema if not exists extensions;

do $$
begin
  if exists (
    select 1 from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'postgis' and n.nspname <> 'extensions'
  ) then
    execute 'alter extension postgis set schema extensions';
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous       boolean not null default false,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now()
);

-- Whoever the current transaction is acting as. Null ⇒ anonymous/logged out,
-- which is exactly the state the public landing page must work in.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Only `is_anonymous` is read by our policies (via public.is_guest()), so that
-- is all this needs to carry.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'is_anonymous',
      coalesce(current_setting('request.jwt.claim.is_anonymous', true), 'false')::boolean
  );
$$;

-- PostgREST's roles. Policies are written against `authenticated` and `anon`,
-- and RLS is not enforced for superusers, so tests must run as one of these.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;

-- Applied again after the migrations run, to cover tables created by them.
create or replace function public.__grant_test_roles()
returns void
language plpgsql
as $$
begin
  execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
  execute 'grant select on all tables in schema public to anon';
  execute 'grant all on all tables in schema public to service_role';
  execute 'grant usage, select on all sequences in schema public to authenticated, service_role';
  execute 'grant execute on all functions in schema public to authenticated, service_role';
end;
$$;
