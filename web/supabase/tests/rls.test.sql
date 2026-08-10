-- ─────────────────────────────────────────────────────────────────────────────
-- RLS regression suite.
--
-- Policies are the authorization model, so "it compiles" proves nothing. This
-- asserts the read matrix directly, as each user, through the same
-- `request.jwt.claim.sub` mechanism PostgREST uses in production.
--
-- Run:  psql -v ON_ERROR_STOP=1 -f auth-shim.sql -f ../migrations/*.sql -f rls.test.sql
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
-- `notice`, not `warning`: every assertion below reports through RAISE NOTICE,
-- and at `warning` the suite passes in silence whether or not it checked
-- anything. A green run must show its work.
set client_min_messages = notice;

create or replace function public.expect(
  label text, actual boolean, wanted boolean
) returns void language plpgsql as $$
begin
  if actual is distinct from wanted then
    raise exception 'FAIL  %  (got %, wanted %)', label, actual, wanted;
  end if;
  raise notice '  ok   %', label;
end;
$$;

-- Act as a user for the rest of the transaction.
create or replace function public.become(u uuid, guest boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  perform set_config('request.jwt.claim.is_anonymous', guest::text, false);
end;
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Built as superuser (RLS is not enforced for the table owner), then read back
-- as each role with RLS on.

do $$
declare
  owner_id uuid := '11111111-1111-1111-1111-111111111111';
  friend   uuid := '22222222-2222-2222-2222-222222222222';
  member   uuid := '33333333-3333-3333-3333-333333333333';
  stranger uuid := '44444444-4444-4444-4444-444444444444';
  grp      uuid;
begin
  insert into auth.users (id, email) values
    (owner_id, 'owner@x'), (friend, 'friend@x'),
    (member, 'member@x'), (stranger, 'stranger@x');

  insert into public.groups (slug, name, owner_id) values ('crew', 'Crew', owner_id)
    returning id into grp;
  insert into public.group_members (group_id, user_id, role) values (grp, member, 'member')
    on conflict do nothing;

  insert into public.friendships (low_id, high_id, requested_by, status, accepted_at)
  values (least(owner_id, friend), greatest(owner_id, friend), owner_id, 'accepted', now());

  -- One journey per visibility, all owned by `owner`.
  insert into public.journeys
    (id, owner_id, title, started_at, ended_at, place_label, origin, visibility, group_id, posted_at)
  values
    ('j_private', owner_id, 'Private', now(), now(), 'P',
      extensions.st_point(0,0)::extensions.geography, 'private', null, null),
    ('j_group',   owner_id, 'Group',   now(), now(), 'G',
      extensions.st_point(0,0)::extensions.geography, 'group',   grp,  null),
    ('j_link',    owner_id, 'Link',    now(), now(), 'L',
      extensions.st_point(0,0)::extensions.geography, 'link',    null, null),
    ('j_public',  owner_id, 'Public',  now(), now(), 'W',
      extensions.st_point(0,0)::extensions.geography, 'public',  null, now());

  -- Explicit per-person share on the otherwise-private journey.
  insert into public.journey_shares (journey_id, user_id, role, granted_by)
  values ('j_private', stranger, 'viewer', owner_id);

  -- Moments: one inheriting, one overriding in each direction.
  insert into public.moments
    (id, journey_id, ordinal, title, summary, t_start, t_end, place_label,
     place_pos, vibe, keyframes, visibility)
  values
    ('m_inherit_private', 'j_private', 0, 'inherits private', '', 0, 1, 'p',
      '{0,0}', '{}'::jsonb, '[]'::jsonb, null),
    ('m_shared_out',      'j_private', 1, 'public inside private', '', 1, 2, 'p',
      '{0,0}', '{}'::jsonb, '[]'::jsonb, 'public'),
    ('m_inherit_public',  'j_public',  0, 'inherits public', '', 0, 1, 'w',
      '{0,0}', '{}'::jsonb, '[]'::jsonb, null),
    ('m_hidden_in_public','j_public',  1, 'private inside public', '', 1, 2, 'w',
      '{0,0}', '{}'::jsonb, '[]'::jsonb, 'private');
end
$$;

select public.__grant_test_roles();

-- ── Assertions ───────────────────────────────────────────────────────────────

set role authenticated;

do $$
declare
  owner_id uuid := '11111111-1111-1111-1111-111111111111';
  friend   uuid := '22222222-2222-2222-2222-222222222222';
  member   uuid := '33333333-3333-3333-3333-333333333333';
  stranger uuid := '44444444-4444-4444-4444-444444444444';
  seen     int;
begin
  raise notice 'Journeys — owner sees everything of their own';
  perform public.become(owner_id);
  select count(*) into seen from public.journeys;
  perform public.expect('owner sees all 4 of their journeys', seen = 4, true);

  raise notice 'Journeys — a stranger sees only public, link, and what was shared to them';
  perform public.become(stranger);
  perform public.expect('stranger CANNOT read j_private''s siblings',
    exists(select 1 from public.journeys where id='j_group'), false);
  perform public.expect('stranger CAN read j_public',
    exists(select 1 from public.journeys where id='j_public'), true);
  perform public.expect('stranger CAN read j_link',
    exists(select 1 from public.journeys where id='j_link'), true);
  perform public.expect('stranger CAN read j_private via explicit share',
    exists(select 1 from public.journeys where id='j_private'), true);

  raise notice 'Journeys — group scope';
  perform public.become(member);
  perform public.expect('group member CAN read j_group',
    exists(select 1 from public.journeys where id='j_group'), true);
  perform public.expect('group member CANNOT read j_private',
    exists(select 1 from public.journeys where id='j_private'), false);

  raise notice 'Journeys — a friend is not automatically a viewer';
  perform public.become(friend);
  perform public.expect('friend CANNOT read j_private (friendship != access)',
    exists(select 1 from public.journeys where id='j_private'), false);
  perform public.expect('friend CANNOT read j_group (not a member)',
    exists(select 1 from public.journeys where id='j_group'), false);

  raise notice 'Moments — inheritance and override, the point of nullable visibility';
  perform public.become(member);
  perform public.expect('moment inherits its private journey → hidden',
    exists(select 1 from public.moments where id='m_inherit_private'), false);
  perform public.expect('moment shared OUT of a private journey → visible',
    exists(select 1 from public.moments where id='m_shared_out'), true);
  perform public.expect('moment inherits its public journey → visible',
    exists(select 1 from public.moments where id='m_inherit_public'), true);
  perform public.expect('moment hidden INSIDE a public journey → hidden',
    exists(select 1 from public.moments where id='m_hidden_in_public'), false);

  perform public.become(owner_id);
  select count(*) into seen from public.moments;
  perform public.expect('owner still sees all 4 of their moments', seen = 4, true);

  raise notice 'Guests may keep a walk but may not post one to the world';
  perform public.become(owner_id, true);
  begin
    insert into public.journeys
      (id, owner_id, title, started_at, ended_at, place_label, origin, visibility, posted_at)
    values ('j_guest_public', owner_id, 'Guest', now(), now(), 'X',
      extensions.st_point(0,0)::extensions.geography, 'public', now());
    perform public.expect('guest CANNOT create a public journey', true, false);
  exception when insufficient_privilege or check_violation then
    perform public.expect('guest CANNOT create a public journey', true, true);
  end;

  perform public.become(owner_id, true);
  insert into public.journeys
    (id, owner_id, title, started_at, ended_at, place_label, origin, visibility)
  values ('j_guest_private', owner_id, 'Guest private', now(), now(), 'X',
    extensions.st_point(0,0)::extensions.geography, 'private');
  perform public.expect('guest CAN create a private journey', true, true);
end
$$;

reset role;

-- ── Logged out ───────────────────────────────────────────────────────────────
-- The landing page must render with no session at all and no auth.users row
-- created. That means `anon` sees exactly the public set.

set role anon;
select public.become(null);

do $$
declare seen int;
begin
  raise notice 'Anonymous (no session at all)';
  select count(*) into seen from public.journeys;
  perform public.expect('anon sees exactly the public + link journeys', seen = 2, true);
  perform public.expect('anon CANNOT read a private journey',
    exists(select 1 from public.journeys where id='j_private'), false);
end
$$;

reset role;

\echo 'RLS suite passed.'
