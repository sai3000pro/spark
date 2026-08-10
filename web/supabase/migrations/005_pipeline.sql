-- ─────────────────────────────────────────────────────────────────────────────
-- 005 · The pipeline's output
--
-- WHERE THE THREE STAGES LAND. lib/types.ts describes a funnel —
-- Detection[] → MomentCandidate[] → Moment[] — and calls stage 1 "disposable"
-- in as many words (types.ts:53). That is load-bearing here.
--
--   detection_bins     Postgres, 1 row/journey,      ~2 KB   the timeline, every page load
--   object_sightings   Postgres, 50–200 rows/journey ~30 KB  object index, ⌘K, cross-trip search
--   raw Detection[]    object storage, ndjson.gz     ~200 KB re-running the pipeline, export
--
-- Raw detections are NOT in this database. ~10k rows per journey at ~250 B with
-- tuple header and index entry is 2.5 MB per journey, which exhausts a 500 MB
-- tier at ~200 journeys — of data that nothing reads a row of. The two
-- aggregations above are what every consumer actually queries, and the pipeline
-- already produces both.
--
-- And do NOT put the raw array in a jsonb column on `journeys`: a 2 MB TOASTed
-- value is fully detoasted on any read of that row, so `select title from
-- journeys` silently becomes a 2 MB read.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.moments (
  id           text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  journey_id   text not null references public.journeys(id) on delete cascade,
  candidate_id text,
  ordinal      integer not null,

  title   text not null,
  summary text not null,
  t_start double precision not null,
  t_end   double precision not null,

  place_label text not null,
  -- Vec2, LOCAL METRES. Not lat/lng — see the contract note in lib/types.ts:22.
  place_pos   double precision[2] not null,

  people     text[] not null default '{}',
  vibe       jsonb  not null,
  music      jsonb,
  -- keyframes[0] is the thumbnail. Never empty.
  keyframes  jsonb  not null,
  transcript jsonb  not null default '[]'::jsonb,

  splat_asset_id uuid,  -- FK added in 006, which creates splat_assets
  splat_note     text,

  -- ── Sharing, at moment granularity ────────────────────────────────────────
  -- NULLABLE ON PURPOSE, and the nullability is the whole feature: null means
  -- "no opinion, inherit the journey", which is different from an explicit
  -- 'private'. Sharing one moment out of a private walk must not require
  -- changing the walk, and hiding one moment from a public walk must not be
  -- indistinguishable from never having decided.
  visibility public.visibility,
  group_id   uuid references public.groups(id) on delete set null,
  posted_at  timestamptz,
  hidden_at  timestamptz,

  created_at timestamptz not null default now(),

  constraint moment_group_scope
    check (visibility is distinct from 'group' or group_id is not null),
  constraint moment_ends_after_it_starts
    check (t_end >= t_start),
  unique (journey_id, ordinal)
);

create index moments_journey_idx on public.moments (journey_id, t_start);

-- A moment shared out of an otherwise-unreadable journey still has to be found
-- by the globe, so its own posted set gets its own partial index.
create index moments_posted_idx on public.moments (posted_at desc)
  where visibility = 'public' and posted_at is not null and hidden_at is null;

create table public.moment_shares (
  moment_id  text not null references public.moments(id)  on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('viewer', 'editor')),
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index moment_shares_user_idx on public.moment_shares (user_id);

-- Deferred from 004: invites.moment_id could not reference a table that did not
-- exist yet, and redeem_invite() already writes moment_shares.
alter table public.invites
  add constraint invites_moment_fk
  foreign key (moment_id) references public.moments(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 2, kept for the pipeline timeline
--
-- Discarded candidates are stored, not dropped. The timeline shows what the
-- scorer rejected and why, which is the feature that makes the pipeline legible
-- rather than magic — see `discardReason` in lib/types.ts:125.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.moment_candidates (
  id             text primary key,
  journey_id     text not null references public.journeys(id) on delete cascade,
  t_start        double precision not null,
  t_end          double precision not null,
  score          double precision not null,
  status         text not null check (status in ('promoted', 'discarded', 'pending')),
  discard_reason text,
  triggers       jsonb not null default '[]'::jsonb
);

create index moment_candidates_journey_idx
  on public.moment_candidates (journey_id, t_start);

-- ─────────────────────────────────────────────────────────────────────────────
-- The one detection-derived thing that is genuinely relational: it is queried
-- ACROSS journeys by label. This is what answers "where is my water bottle".
-- ─────────────────────────────────────────────────────────────────────────────

create table public.object_sightings (
  id              bigserial primary key,
  journey_id      text not null references public.journeys(id) on delete cascade,
  moment_id       text not null references public.moments(id)  on delete cascade,
  track_id        text not null,
  label           text not null,
  family          text not null,          -- familyOf(), lib/mock/labels.ts
  -- Peak across the track, not the mean: we want the best evidence.
  confidence      real not null,
  first_seen_t    double precision not null,
  last_seen_t     double precision not null,
  -- The BEST-LOOKING frame, which is not the highest-confidence one. See the
  -- note in lib/types.ts:154-159 and lib/detect/viewQuality.ts.
  best_t          double precision,
  best_bbox       real[4] not null,
  view_score      real,
  keyframe_id     text not null,
  detection_count integer not null,
  world_pos       real[3],
  nav_target      jsonb,
  -- Absolute, so "when did I last see this" compares across journeys. The `t`
  -- columns above are seconds-into-trip and cannot answer that.
  last_seen_at    timestamptz not null,
  unique (moment_id, track_id)
);

create index object_sightings_label_idx   on public.object_sightings (label);
create index object_sightings_family_idx  on public.object_sightings (family);
create index object_sightings_journey_idx on public.object_sightings (journey_id);

-- ⌘K fuzzy search: "watter bottle" should still find it.
create index object_sightings_trgm on public.object_sightings
  using gin (label extensions.gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- Precomputed histogram — the ONLY thing the timeline reads.
--
-- `counts` is flat rather than 2-D: Postgres arrays are rectangular anyway, and
-- a flat array with an explicit bin_count is unambiguous to index from
-- TypeScript. Row-major, families × bin_count.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.detection_bins (
  journey_id text primary key references public.journeys(id) on delete cascade,
  bin_count  integer not null check (bin_count > 0),
  bin_sec    double precision not null,
  families   text[] not null,
  counts     integer[] not null,
  peak       integer not null,
  constraint counts_is_rectangular
    check (array_length(counts, 1) = bin_count * array_length(families, 1))
);
