-- ─────────────────────────────────────────────────────────────────────────────
-- 006 · Splat assets, the storage ledger, reconstruction jobs, live sessions
-- ─────────────────────────────────────────────────────────────────────────────

-- Mirrors StorageProviderId in lib/storage/provider.ts. Persisted — never
-- renumber, and never remove a value that objects still point at.
create type public.storage_provider as enum ('r2', 'supabase', 'firebase');

-- ─────────────────────────────────────────────────────────────────────────────
-- The usage ledger, read by lib/storage/ledger.ts
--
-- Neither R2 nor Supabase reports stored bytes cheaply — R2 through a separate
-- analytics API on a delay, Supabase through the dashboard — so the sum is kept
-- here, alongside the rows that describe the objects. It is a cache of a fact we
-- do not own and it can drift; HEADROOM_RESERVE in lib/storage/placement.ts is
-- sized to absorb that, and a reconcile job corrects it properly.
--
-- The natural key is the object path, so a retried upload upserts instead of
-- double-counting. That is what makes `record()` idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.storage_objects (
  provider   public.storage_provider not null,
  bucket     text   not null,
  key        text   not null,
  bytes      bigint not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  primary key (provider, bucket, key)
);

create index storage_objects_provider_idx on public.storage_objects (provider);

-- Sums are cheap here and this runs on the write path, so it stays a plain
-- aggregate rather than a materialised counter that could disagree with the rows.
create or replace function public.storage_used_bytes(p_provider public.storage_provider)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(bytes), 0)::bigint
    from public.storage_objects
   where provider = p_provider;
$$;

-- Service role only: this is fleet-wide accounting, not a per-user fact, and
-- exposing it would leak how much other people have stored.
revoke execute on function public.storage_used_bytes(public.storage_provider) from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Splat assets
--
-- Two rows per capture, linked by `derived_from`: the PLY master (archival,
-- never browser-served) and the SPZ (delivery). Keeping the PLY is what makes a
-- re-transcode at different settings possible, and it is what a user means when
-- they ask for the original at full detail.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.splat_assets (
  id           uuid primary key default extensions.gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  journey_id   text references public.journeys(id) on delete set null,
  derived_from uuid references public.splat_assets(id) on delete set null,

  format   text not null check (format in ('spz', 'ply', 'splat', 'ksplat')),
  provider public.storage_provider not null,
  bucket   text   not null,
  object_key text not null,
  bytes    bigint not null,

  point_count integer,
  sha256      bytea,
  bounds      jsonb,
  -- SplatView (lib/types.ts:192). Captures arrive in whatever frame the
  -- reconstructor used — INRIA-layout PLYs are y-down — so framing is per-asset
  -- data, not a constant in the viewer.
  view        jsonb,

  created_at timestamptz not null default now(),
  unique (provider, bucket, object_key)
);

create index splat_assets_journey_idx on public.splat_assets (journey_id);
create index splat_assets_owner_idx   on public.splat_assets (owner_id);

alter table public.moments
  add constraint moments_splat_asset_fk
  foreign key (splat_asset_id) references public.splat_assets(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reconstruction jobs
--
-- Replaces the filesystem derive in lib/splatJobs.ts, which computed status from
-- `existsSync(public/mock/splats/<id>.ply)` on every read. That was correct in a
-- way a naive status column is NOT: it told the truth after a restart and after
-- an hour idle, with no timer to leak. A plain column loses that — a worker that
-- dies mid-run leaves a row saying 'reconstructing' forever.
--
-- `splat_jobs_view.effective_status` restores the property: a job whose
-- heartbeat is stale reads as failed without anyone having to write that row.
-- Derive, don't tick — same discipline, different substrate.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.recon_status as enum (
  'draft', 'uploading', 'queued', 'reconstructing',
  'downloading', 'transcoding', 'ready', 'failed', 'cancelled'
);

create table public.splat_jobs (
  id         text primary key,   -- keeps the splat_<base36> shape
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  journey_id text references public.journeys(id) on delete set null,

  provider      text not null default 'manual',  -- kiri | local-studio | manual
  credential_id uuid,                            -- FK added in phase 2
  external_id   text,                            -- KIRI's `serialize`

  status        public.recon_status not null default 'draft',
  status_detail text not null default '',
  error_code    text,
  retryable     boolean not null default false,

  source_name  text not null,
  source_bytes bigint not null,
  source_key   text,
  duration_sec real,
  width        integer,
  height       integer,

  ply_asset_id uuid references public.splat_assets(id) on delete set null,
  spz_asset_id uuid references public.splat_assets(id) on delete set null,

  next_poll_at  timestamptz,
  poll_attempts integer not null default 0,
  credits_spent integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  heartbeat_at timestamptz
);

create trigger splat_jobs_touch
  before update on public.splat_jobs
  for each row execute function public.touch_updated_at();

create index splat_jobs_owner_idx on public.splat_jobs (owner_id, created_at desc);
create index splat_jobs_sweep_idx on public.splat_jobs (next_poll_at)
  where status in ('queued', 'reconstructing');

create or replace view public.splat_jobs_view as
select
  j.*,
  case
    when j.status in ('reconstructing', 'transcoding', 'downloading')
     and coalesce(j.heartbeat_at, j.started_at, j.created_at)
         < now() - interval '15 minutes'
    then 'failed'::public.recon_status
    else j.status
  end as effective_status
from public.splat_jobs j;

-- ─────────────────────────────────────────────────────────────────────────────
-- Live sessions — lib/liveTrip.ts, per user rather than per installation
--
-- The old module held ONE session for the whole app on globalThis and threw
-- TripConflictError from a read-then-write check. That check is a race; this
-- index is not. A second concurrent start now fails with 23505, which the route
-- handler translates back into the same 409.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.live_sessions (
  id          text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  origin      extensions.geography(Point, 4326) not null,
  place_label text not null default 'Current location',
  region      text not null default '—',
  country     text not null default '—',
  source      text not null default 'ui' check (source in ('ui', 'robot', 'phone')),
  -- LiveCounters, or null. Null ⇒ nothing has reported, so the UI must badge the
  -- numbers as simulated rather than present extrapolation as measurement.
  reported       jsonb,
  last_ingest_at timestamptz,
  journey_id     text references public.journeys(id) on delete set null
);

create unique index live_sessions_one_active
  on public.live_sessions (user_id)
  where ended_at is null;

create index live_sessions_user_idx on public.live_sessions (user_id, started_at desc);
