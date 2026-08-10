-- ─────────────────────────────────────────────────────────────────────────────
-- 002 · Friendships and groups
--
-- Friendship is symmetric, so it is stored as ONE canonically-ordered row per
-- pair rather than two mirrored rows. The two-row shape looks friendlier to
-- query ("where user_id = me") but it makes every write a pair that can half-
-- fail, and every read an OR that the planner handles worse. With
-- `low_id < high_id` enforced by a check constraint, "are these two friends" is
-- a single primary-key lookup and there is no state in which A follows B but
-- not the reverse.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.friendships (
  low_id       uuid not null references public.profiles(id) on delete cascade,
  high_id      uuid not null references public.profiles(id) on delete cascade,
  -- Who asked. Needed to render "X wants to be friends" on the right side, and
  -- it is NOT derivable from the canonical ordering, which is by uuid.
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'blocked')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (low_id, high_id),
  constraint ordered_pair check (low_id < high_id)
);

-- The pkey already covers low_id-leading lookups; this covers the other direction.
create index friendships_high_idx
  on public.friendships (high_id)
  where status = 'accepted';

-- Call this rather than inserting directly, so the ordering invariant is applied
-- in one place instead of at every call site.
create or replace function public.friendship_pair(a uuid, b uuid)
returns record
language sql
immutable
as $$
  select least(a, b) as low_id, greatest(a, b) as high_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Groups — the "friend group album" scope
-- ─────────────────────────────────────────────────────────────────────────────

create table public.groups (
  id         uuid primary key default extensions.gen_random_uuid(),
  slug       extensions.citext unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name       text not null,
  blurb      text,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.group_members (
  group_id  uuid not null references public.groups(id)   on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member'
            check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- "Which groups am I in" is on the hot path of every group-scoped read, and the
-- pkey is group-leading, so this is not redundant with it.
create index group_members_user_idx on public.group_members (user_id);

-- The owner is a member from the start. Without this, a freshly created group is
-- invisible to its own creator, because every read policy goes through
-- is_member() rather than through groups.owner_id.
create or replace function public.seed_group_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger groups_seed_owner
  after insert on public.groups
  for each row execute function public.seed_group_owner();
