-- ─────────────────────────────────────────────────────────────────────────────
-- 004 · Magic-link invites
--
-- TWO LAYERS, AND THEY ARE NOT THE SAME THING.
--
--   Supabase Auth's magic link AUTHENTICATES — it proves an email address and
--   mints a session. It cannot carry an application payload.
--
--   public.invites AUTHORIZES — it records which group, journey, album or
--   friendship the arriving person is being handed.
--
-- The URL is /i/<raw-token>. That page signs the visitor in if they have no
-- session (signInWithOtp), and only then calls redeem_invite(raw). Conflating
-- the two is the classic mistake here, and it fails silently: the user signs in
-- fine and simply never joins anything.
--
-- THE DATABASE NEVER HOLDS THE RAW TOKEN, only sha256 of it. The raw value
-- exists in the email that was sent and in the browser that opened it. So a
-- database leak does not hand over working invite links, and no policy needs to
-- hide a column that would otherwise be a bearer credential at rest.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.invites (
  id         uuid primary key default extensions.gen_random_uuid(),
  token_hash bytea not null unique,
  kind       text not null check (kind in ('app', 'group', 'journey', 'album', 'moment')),
  -- Null ⇒ a shareable link rather than one addressed to a person. This is the
  -- "share with friends by link" case.
  email      extensions.citext,
  inviter_id uuid not null references public.profiles(id) on delete cascade,

  group_id   uuid references public.groups(id)   on delete cascade,
  journey_id text references public.journeys(id) on delete cascade,
  album_id   uuid references public.albums(id)   on delete cascade,
  -- moments do not exist until 005; the FK is added there.
  moment_id  text,

  grant_role text not null default 'member',
  max_uses   integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0,
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  -- Each kind must name exactly the target it is for, and no other. Without
  -- this, a 'group' invite carrying a journey_id would redeem as a group join
  -- and silently drop the journey — a whole class of bug the type system on the
  -- TypeScript side cannot see.
  constraint target_matches_kind check (
    (kind = 'app'     and group_id is null and journey_id is null
                      and album_id is null and moment_id is null) or
    (kind = 'group'   and group_id   is not null and journey_id is null
                      and album_id is null and moment_id is null) or
    (kind = 'journey' and journey_id is not null and group_id is null
                      and album_id is null and moment_id is null) or
    (kind = 'album'   and album_id   is not null and group_id is null
                      and journey_id is null and moment_id is null) or
    (kind = 'moment'  and moment_id  is not null and group_id is null
                      and journey_id is null and album_id is null)
  )
);

create index invites_email_idx on public.invites (email)
  where revoked_at is null;

create index invites_inviter_idx on public.invites (inviter_id, created_at desc);

create table public.invite_redemptions (
  invite_id   uuid not null references public.invites(id)   on delete cascade,
  user_id     uuid not null references public.profiles(id)  on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Redemption
--
-- An RPC rather than a policy-guarded insert, for two reasons that both have to
-- hold at once: the caller must look a token up WITHOUT being able to `select`
-- the invites table (or they could enumerate other people's), and `used_count`
-- must increment atomically with the grant (or a shared link with max_uses = 1
-- redeems twice under concurrency). `for update` inside a single function call
-- gives both.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.redeem_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  me  uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in before redeeming an invite' using errcode = '42501';
  end if;

  select * into inv
    from public.invites
   where token_hash = extensions.digest(p_token, 'sha256')
     and revoked_at is null
     and expires_at > now()
     and used_count < max_uses
   for update;

  if not found then
    -- Deliberately one message for "no such token", "expired", "revoked" and
    -- "used up". Distinguishing them tells a probing caller which tokens exist.
    return jsonb_build_object('ok', false, 'reason', 'invalid or expired');
  end if;

  -- Inviting yourself is a no-op, not an error — it happens whenever someone
  -- opens their own share link to check what it looks like.
  if inv.inviter_id = me and inv.kind = 'app' then
    return jsonb_build_object('ok', true, 'kind', inv.kind, 'self', true);
  end if;

  case inv.kind
    when 'group' then
      insert into public.group_members (group_id, user_id, role)
      values (inv.group_id, me, inv.grant_role)
      on conflict do nothing;

    when 'journey' then
      insert into public.journey_shares (journey_id, user_id, role, granted_by)
      values (inv.journey_id, me, inv.grant_role, inv.inviter_id)
      on conflict do nothing;

    when 'album' then
      insert into public.album_shares (album_id, user_id, role, granted_by)
      values (inv.album_id, me, inv.grant_role, inv.inviter_id)
      on conflict do nothing;

    when 'moment' then
      insert into public.moment_shares (moment_id, user_id, role, granted_by)
      values (inv.moment_id, me, inv.grant_role, inv.inviter_id)
      on conflict do nothing;

    when 'app' then
      insert into public.friendships (low_id, high_id, requested_by, status, accepted_at)
      values (least(me, inv.inviter_id), greatest(me, inv.inviter_id),
              inv.inviter_id, 'accepted', now())
      on conflict (low_id, high_id)
        do update set status = 'accepted', accepted_at = now();
  end case;

  insert into public.invite_redemptions (invite_id, user_id)
  values (inv.id, me)
  on conflict do nothing;

  update public.invites set used_count = used_count + 1 where id = inv.id;

  return jsonb_build_object('ok', true, 'kind', inv.kind);
end;
$$;

-- Signed-in callers only. `anon` must not be able to burn a use off a token.
revoke execute on function public.redeem_invite(text) from anon;
revoke execute on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;
