-- ─────────────────────────────────────────────────────────────────────────────
-- 008 · Push registration tokens (Firebase Cloud Messaging)
--
-- WHY FIREBASE IS IN THIS STACK AT ALL, given Supabase is the database:
-- the two free tiers are not fungible, and each of these is something the other
-- genuinely cannot do without a card.
--
--   Firebase RTDB  1 GB stored, 10 GB/month egress, 100 concurrent connections.
--                  Carries live reconstruction progress, so Supabase Realtime's
--                  budget is left entirely for everything else. Nothing is
--                  persisted there that matters — it is a fan-out channel, and
--                  splat_jobs remains the source of truth.
--
--   Firebase FCM   Free, unbounded, no billing account. Supabase has no
--                  equivalent at any tier. This is what tells someone their
--                  reconstruction finished after they closed the tab, which for
--                  a job measured in minutes is the difference between a feature
--                  and a spinner nobody waits on.
--
-- NOT Firebase Storage: since 2024-10-30 a new project cannot provision a bucket
-- without Blaze, and since 2026-02-02 non-Blaze projects lost access to existing
-- ones. It cannot contribute free blob capacity, so blobs shard across R2 and
-- Supabase Storage instead (lib/storage/placement.ts).
--
-- Only FCM needs a table. RTDB holds no durable state by design.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.push_tokens (
  -- The FCM registration token. It is the natural key: FCM reissues per
  -- browser/device install, and the same token must never register twice.
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text not null default 'web' check (platform in ('web', 'ios', 'android')),
  user_agent text,
  created_at timestamptz not null default now(),
  -- Bumped whenever the client re-registers. FCM tokens go stale silently, so
  -- the send path prunes anything not seen for a long while rather than
  -- accumulating dead endpoints forever.
  seen_at    timestamptz not null default now(),
  -- Set when FCM replies UNREGISTERED / INVALID_ARGUMENT for this token. Kept
  -- rather than deleted so a token cannot be resurrected by a stale client
  -- retrying its registration.
  revoked_at timestamptz
);

create index push_tokens_user_idx on public.push_tokens (user_id)
  where revoked_at is null;

create index push_tokens_stale_idx on public.push_tokens (seen_at)
  where revoked_at is null;

alter table public.push_tokens enable row level security;

-- A user manages only their own registrations. Sends happen service-role side,
-- which is also why there is no policy granting anyone a read across users:
-- the token list is a device inventory and nobody else's business.
create policy push_tokens_read on public.push_tokens
  for select using (user_id = (select auth.uid()));

create policy push_tokens_register on public.push_tokens
  for insert with check (user_id = (select auth.uid()));

create policy push_tokens_refresh on public.push_tokens
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_tokens_unregister on public.push_tokens
  for delete using (user_id = (select auth.uid()));
