-- ─────────────────────────────────────────────────────────────────────────────
-- 003 · Journeys and albums
--
-- The hierarchy the product groups by:  album → journey → moment.
-- An album collects journeys; a journey holds moments. All three can be shared
-- independently, which is why `visibility` appears on each of them rather than
-- only at the top.
--
-- IDS ARE TEXT, not uuid, and deliberately so. The app already mints and greps
-- `trip_upload_*` (lib/uploadedTrips.ts) and slugs like `stackt-market`
-- (lib/mock/trips/), and `isUploadedTripId()` reads provenance straight off the
-- id. Switching to uuid would rewrite `resolveTripId` and every mock spec for no
-- benefit. New tables that have no such history use uuid.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.visibility as enum (
  'private',  -- owner only
  'group',    -- one friend group; requires group_id
  'link',     -- anyone holding the link (shared but not on the world globe)
  'public'    -- the world; eligible for the global globe once posted
);

create table public.journeys (
  id         text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'recorded'
             check (kind in ('recorded', 'uploaded', 'authored')),

  title      text not null,
  started_at timestamptz not null,
  ended_at   timestamptz not null,

  place_label text not null,
  region      text not null default '—',
  country     text not null default '—',
  -- Trip.place.origin — the globe pin. The ONE real-world coordinate, per the
  -- contract in lib/types.ts:22-33.
  origin      extensions.geography(Point, 4326) not null,
  map_origin  extensions.geography(Point, 4326),
  bearing_deg double precision not null default 0,
  -- Derived from `path` at write time, for "walks near me" and viewport queries.
  -- Kept separate because `path` is in LOCAL METRES and PostGIS cannot help with
  -- that frame at all.
  track       extensions.geography(LineString, 4326),

  -- uploadedTrips.ts's honesty flag: position was synthesised, not measured.
  synthetic  boolean not null default false,

  visibility public.visibility not null default 'private',
  group_id   uuid references public.groups(id) on delete set null,
  -- Non-null ⇒ on the globe. This column replaces lib/postedWalks.ts entirely.
  posted_at  timestamptz,
  -- Owner-only hide, independent of visibility. Lets you take something off your
  -- own shelf without changing who it was shared with.
  hidden_at  timestamptz,
  deleted_at timestamptz,

  -- Denormalised so the shelf and the globe never have to touch `moments`.
  stats           jsonb not null default '{}'::jsonb,
  distance_m      double precision not null default 0,
  detection_count integer not null default 0,
  cover           jsonb,

  -- TrackPoint[]. Local metres — see the note on `track` above.
  path            jsonb,
  -- Raw Detection[] lives in object storage, not here. ~10k rows/journey that
  -- nothing ever reads individually; see the three-tier note in 005.
  detections_key  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_scope_needs_group
    check (visibility <> 'group' or group_id is not null),
  constraint ends_after_it_starts
    check (ended_at >= started_at)
);

create trigger journeys_touch
  before update on public.journeys
  for each row execute function public.touch_updated_at();

create index journeys_owner_idx on public.journeys (owner_id)
  where deleted_at is null;

create index journeys_group_idx on public.journeys (group_id)
  where visibility = 'group' and deleted_at is null;

-- The global globe. Partial so the index holds only what that query returns —
-- at scale the posted-public set is a small fraction of all journeys.
create index journeys_globe_gix on public.journeys using gist (origin)
  where visibility = 'public'
    and posted_at is not null
    and hidden_at is null
    and deleted_at is null;

create index journeys_recent_idx on public.journeys (started_at desc)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Explicit per-person sharing — the "add people" that is neither friend nor group
-- ─────────────────────────────────────────────────────────────────────────────

create table public.journey_shares (
  journey_id text not null references public.journeys(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('viewer', 'editor')),
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (journey_id, user_id)
);

create index journey_shares_user_idx on public.journey_shares (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Albums
--
-- An album's scope is INDEPENDENT of the scopes of the journeys inside it. That
-- is not an oversight: a friend-group album may legitimately contain one private
-- walk, and the right behaviour is to show that walk as a locked tile rather
-- than to 404 the whole album or to silently widen the walk's audience.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.albums (
  id               uuid primary key default extensions.gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  title            text not null,
  blurb            text,
  cover_journey_id text references public.journeys(id) on delete set null,
  visibility       public.visibility not null default 'private',
  group_id         uuid references public.groups(id) on delete set null,
  posted_at        timestamptz,
  hidden_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint album_group_scope
    check (visibility <> 'group' or group_id is not null)
);

create trigger albums_touch
  before update on public.albums
  for each row execute function public.touch_updated_at();

create index albums_owner_idx on public.albums (owner_id) where deleted_at is null;

create table public.album_journeys (
  album_id   uuid not null references public.albums(id)   on delete cascade,
  journey_id text not null references public.journeys(id) on delete cascade,
  position   integer not null default 0,
  added_at   timestamptz not null default now(),
  primary key (album_id, journey_id)
);

create index album_journeys_journey_idx on public.album_journeys (journey_id);

create table public.album_shares (
  album_id   uuid not null references public.albums(id)   on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('viewer', 'editor')),
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (album_id, user_id)
);

create index album_shares_user_idx on public.album_shares (user_id);
