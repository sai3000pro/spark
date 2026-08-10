-- ─────────────────────────────────────────────────────────────────────────────
-- 007 · Row level security
--
-- This file IS the authorization model. Not the API routes, not the React
-- components — those are conveniences layered on top, and every one of them can
-- be bypassed by a client talking straight to PostgREST with the anon key. If a
-- rule is not expressed here, it is not enforced.
--
-- THREE RULES THAT LOOK LIKE STYLE AND ARE NOT:
--
--  1. Membership checks go through `security definer` helpers, never through a
--     direct subquery on the protected table. A policy on group_members that
--     reads group_members recurses infinitely and the planner will not save you.
--
--  2. Every `security definer` function sets `search_path = public`. Without it
--     a caller can shadow `journeys` or `digest` with their own and have a
--     definer-rights function resolve theirs. That is privilege escalation, not
--     a style nit.
--
--  3. `auth.uid()` is wrapped as `(select auth.uid())`. Bare, it is a volatile
--     function call evaluated PER ROW; wrapped in a subselect the planner hoists
--     it into an InitPlan evaluated once. On an object_sightings scan that is
--     roughly two orders of magnitude.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.is_member(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_group is not null
     and p_user is not null
     and exists (
       select 1 from public.group_members gm
        where gm.group_id = p_group and gm.user_id = p_user
     );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null and b is not null and a <> b
     and exists (
       select 1 from public.friendships f
        where f.status = 'accepted'
          and f.low_id  = least(a, b)
          and f.high_id = greatest(a, b)
     );
$$;

-- The four scopes, in ONE place. Every child table defers to this rather than
-- restating the rule, so there is exactly one definition of "can read".
create or replace function public.can_read_journey(
  p_journey text,
  p_user    uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.journeys j
     where j.id = p_journey
       and j.deleted_at is null
       and (j.hidden_at is null or j.owner_id = p_user)
       and (
            j.visibility = 'public'                                    -- 1 · the world
         or j.visibility = 'link'                                      -- 2 · anyone with the link
         or (j.visibility = 'group' and public.is_member(j.group_id, p_user))  -- 3 · friend group
         or j.owner_id = p_user                                        -- 4 · yours
         or exists (
              select 1 from public.journey_shares s
               where s.journey_id = j.id and s.user_id = p_user        --     added people
            )
       )
  );
$$;

-- A moment inherits its journey's answer UNLESS it expresses an opinion of its
-- own. That is what the nullable `moments.visibility` buys: sharing one moment
-- out of a private walk, or hiding one moment inside a public one, without
-- touching the walk. Note the owner check reads the JOURNEY's owner — a moment
-- has no separate owner and inventing one would let the two disagree.
create or replace function public.can_read_moment(
  p_moment text,
  p_user   uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.moments m
      join public.journeys j on j.id = m.journey_id
     where m.id = p_moment
       and j.deleted_at is null
       and (m.hidden_at is null or j.owner_id = p_user)
       and (
            j.owner_id = p_user
         or exists (
              select 1 from public.moment_shares s
               where s.moment_id = m.id and s.user_id = p_user
            )
         or case
              -- No opinion → inherit. The common case by far.
              when m.visibility is null then public.can_read_journey(m.journey_id, p_user)
              when m.visibility in ('public', 'link') then true
              when m.visibility = 'group' then public.is_member(m.group_id, p_user)
              else false   -- explicitly private, and we are not the owner
            end
       )
  );
$$;

create or replace function public.can_read_album(
  p_album uuid,
  p_user  uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.albums a
     where a.id = p_album
       and a.deleted_at is null
       and (a.hidden_at is null or a.owner_id = p_user)
       and (
            a.visibility in ('public', 'link')
         or (a.visibility = 'group' and public.is_member(a.group_id, p_user))
         or a.owner_id = p_user
         or exists (
              select 1 from public.album_shares s
               where s.album_id = a.id and s.user_id = p_user
            )
       )
  );
$$;

create or replace function public.owns_journey(p_journey text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.journeys j
     where j.id = p_journey
       and j.owner_id = (select auth.uid())
       and j.deleted_at is null
  );
$$;

-- Guests may keep a walk; they may not put one on the world's globe, and they
-- may not invite anyone. Both restrictions are enforced in the policies below.
create or replace function public.is_guest()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- ── profiles ─────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

-- Profiles are public-facing: a shared album has to render its owner's name.
-- Nothing sensitive lives on this table; email stays in auth.users.
create policy profiles_read on public.profiles
  for select using (true);

create policy profiles_update_own on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── friendships ──────────────────────────────────────────────────────────────

alter table public.friendships enable row level security;

create policy friendships_read on public.friendships
  for select using (
    low_id = (select auth.uid()) or high_id = (select auth.uid())
  );

create policy friendships_request on public.friendships
  for insert with check (
    requested_by = (select auth.uid())
    and (low_id = (select auth.uid()) or high_id = (select auth.uid()))
    and not public.is_guest()
  );

-- Either party may accept or block; only the OTHER party can accept a request,
-- which the API enforces. Blocking your own outbound request is a valid cancel.
create policy friendships_respond on public.friendships
  for update using (
    low_id = (select auth.uid()) or high_id = (select auth.uid())
  );

create policy friendships_remove on public.friendships
  for delete using (
    low_id = (select auth.uid()) or high_id = (select auth.uid())
  );

-- ── groups / group_members ───────────────────────────────────────────────────

alter table public.groups enable row level security;

create policy groups_read on public.groups
  for select using (deleted_at is null and public.is_member(id));

create policy groups_create on public.groups
  for insert with check (owner_id = (select auth.uid()) and not public.is_guest());

create policy groups_update on public.groups
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter table public.group_members enable row level security;

-- Reads go through is_member(), never through a subquery on this table — see
-- rule 1 in the header.
create policy gm_read on public.group_members
  for select using (
    user_id = (select auth.uid()) or public.is_member(group_id)
  );

-- Joining happens ONLY through redeem_invite(), which is security definer and
-- bypasses this. There is deliberately no insert policy: a self-insert here
-- would be a group-membership vulnerability with no invite required.
create policy gm_leave on public.group_members
  for delete using (user_id = (select auth.uid()));

-- ── journeys ─────────────────────────────────────────────────────────────────

alter table public.journeys enable row level security;

create policy journeys_read on public.journeys
  for select using (
    deleted_at is null
    and (hidden_at is null or owner_id = (select auth.uid()))
    and (
         visibility in ('public', 'link')
      or owner_id = (select auth.uid())
      or (visibility = 'group' and public.is_member(group_id))
      or exists (
           select 1 from public.journey_shares s
            where s.journey_id = journeys.id and s.user_id = (select auth.uid())
         )
    )
  );

create policy journeys_insert on public.journeys
  for insert with check (
    owner_id = (select auth.uid())
    -- A guest's walk is genuinely theirs, but it does not go on the world globe
    -- until there is an account behind it.
    and (visibility <> 'public' or not public.is_guest())
  );

create policy journeys_update on public.journeys
  for update using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (visibility <> 'public' or not public.is_guest())
  );

create policy journeys_delete on public.journeys
  for delete using (owner_id = (select auth.uid()));

alter table public.journey_shares enable row level security;

create policy journey_shares_read on public.journey_shares
  for select using (
    user_id = (select auth.uid()) or public.owns_journey(journey_id)
  );

create policy journey_shares_grant on public.journey_shares
  for insert with check (public.owns_journey(journey_id) and not public.is_guest());

create policy journey_shares_revoke on public.journey_shares
  for delete using (
    public.owns_journey(journey_id) or user_id = (select auth.uid())
  );

-- ── albums ───────────────────────────────────────────────────────────────────

alter table public.albums enable row level security;

create policy albums_read on public.albums
  for select using (public.can_read_album(id));

create policy albums_write on public.albums
  for all using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (visibility <> 'public' or not public.is_guest())
  );

alter table public.album_journeys enable row level security;

-- Read the MEMBERSHIP if you can read the album. Whether you can read the
-- journey itself is a separate question, answered by journeys_read — which is
-- what makes an unreadable entry render as a locked tile instead of 404-ing the
-- whole album.
create policy album_journeys_read on public.album_journeys
  for select using (public.can_read_album(album_id));

create policy album_journeys_write on public.album_journeys
  for all using (
    exists (select 1 from public.albums a
             where a.id = album_id and a.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.albums a
             where a.id = album_id and a.owner_id = (select auth.uid()))
    -- You may only file journeys you own into your own album.
    and public.owns_journey(journey_id)
  );

alter table public.album_shares enable row level security;

create policy album_shares_read on public.album_shares
  for select using (
    user_id = (select auth.uid())
    or exists (select 1 from public.albums a
                where a.id = album_id and a.owner_id = (select auth.uid()))
  );

create policy album_shares_write on public.album_shares
  for all using (
    exists (select 1 from public.albums a
             where a.id = album_id and a.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.albums a
             where a.id = album_id and a.owner_id = (select auth.uid()))
    and not public.is_guest()
  );

-- ── moments and the rest of the pipeline ─────────────────────────────────────

alter table public.moments enable row level security;

create policy moments_read on public.moments
  for select using (public.can_read_moment(id));

create policy moments_write on public.moments
  for all using (public.owns_journey(journey_id))
  with check (public.owns_journey(journey_id));

alter table public.moment_shares enable row level security;

create policy moment_shares_read on public.moment_shares
  for select using (
    user_id = (select auth.uid())
    or exists (select 1 from public.moments m
                where m.id = moment_id and public.owns_journey(m.journey_id))
  );

create policy moment_shares_write on public.moment_shares
  for all using (
    exists (select 1 from public.moments m
             where m.id = moment_id and public.owns_journey(m.journey_id))
  )
  with check (
    exists (select 1 from public.moments m
             where m.id = moment_id and public.owns_journey(m.journey_id))
    and not public.is_guest()
  );

-- Candidates, sightings and bins follow the JOURNEY, not the moment: they are
-- pipeline telemetry about the walk as a whole, and the timeline that renders
-- them is a journey-level view.
alter table public.moment_candidates enable row level security;
create policy moment_candidates_read on public.moment_candidates
  for select using (public.can_read_journey(journey_id));
create policy moment_candidates_write on public.moment_candidates
  for all using (public.owns_journey(journey_id))
  with check (public.owns_journey(journey_id));

alter table public.object_sightings enable row level security;
create policy object_sightings_read on public.object_sightings
  for select using (public.can_read_journey(journey_id));
create policy object_sightings_write on public.object_sightings
  for all using (public.owns_journey(journey_id))
  with check (public.owns_journey(journey_id));

alter table public.detection_bins enable row level security;
create policy detection_bins_read on public.detection_bins
  for select using (public.can_read_journey(journey_id));
create policy detection_bins_write on public.detection_bins
  for all using (public.owns_journey(journey_id))
  with check (public.owns_journey(journey_id));

-- ── invites ──────────────────────────────────────────────────────────────────

alter table public.invites enable row level security;

-- Never selectable BY TOKEN from the client — only your own, by inviter_id. The
-- lookup by token_hash happens exclusively inside redeem_invite().
create policy invites_read_own on public.invites
  for select using (inviter_id = (select auth.uid()));

create policy invites_create on public.invites
  for insert with check (
    inviter_id = (select auth.uid())
    and not public.is_guest()
    -- You can only hand out what you actually control.
    and (kind <> 'group'   or public.is_member(group_id))
    and (kind <> 'journey' or public.owns_journey(journey_id))
    and (kind <> 'album'   or exists (
          select 1 from public.albums a
           where a.id = album_id and a.owner_id = (select auth.uid())))
    and (kind <> 'moment'  or exists (
          select 1 from public.moments m
           where m.id = moment_id and public.owns_journey(m.journey_id)))
  );

create policy invites_revoke on public.invites
  for update using (inviter_id = (select auth.uid()));

alter table public.invite_redemptions enable row level security;

create policy invite_redemptions_read on public.invite_redemptions
  for select using (
    user_id = (select auth.uid())
    or exists (select 1 from public.invites i
                where i.id = invite_id and i.inviter_id = (select auth.uid()))
  );

-- ── splats, jobs, sessions, storage ──────────────────────────────────────────

alter table public.splat_assets enable row level security;

-- An asset is readable when the journey it belongs to is. An asset with no
-- journey yet (mid-reconstruction) is owner-only.
create policy splat_assets_read on public.splat_assets
  for select using (
    owner_id = (select auth.uid())
    or (journey_id is not null and public.can_read_journey(journey_id))
  );

-- Writes are service-role only: assets are created by the worker after a
-- reconstruction lands, never by a browser.

alter table public.splat_jobs enable row level security;

create policy splat_jobs_read on public.splat_jobs
  for select using (owner_id = (select auth.uid()));

alter table public.live_sessions enable row level security;

create policy live_sessions_own on public.live_sessions
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The storage ledger is fleet-wide accounting. No client policy at all: reads go
-- through storage_used_bytes(), which is service-role only, and writes happen in
-- the worker. RLS is enabled with zero policies, which denies everything —
-- enabling it is the point, since a table without RLS is readable by anon.
alter table public.storage_objects enable row level security;
