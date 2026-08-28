# Where the account wall goes

Written 2026-08-28, before there is a Supabase project to test against. Every
claim about existing behaviour below was read out of the code, and the file and
line are given so you can check rather than trust.

---

## The short version

**The wall you proposed is the inverse of the wall that is already built**, on
both axes. That is not a criticism of either — it is the one decision that has
to be made before any of this is wired, and it is a product call, not a
technical one.

|                        | You proposed        | What `007_rls.sql` enforces today |
|------------------------|---------------------|-----------------------------------|
| post to the globe      | free                | **needs an account**              |
| save to an album       | **needs an account**| free                              |

---

## What already exists (and is better than I expected)

### There is no "create an account" step, and no migration

`lib/auth/guest.ts` → `ensureWriter()` is called at the top of a write. If
nobody is signed in, it calls `signInAnonymously()`. So **the first time anyone
records or uploads anything, they silently become a real `auth.users` row** —
just an anonymous one. Everything they make is keyed to `owner_id = auth.uid()`
from that moment.

`app/auth/upgrade/route.ts` then attaches an email to **that same row**:

> `updateUser({ email })` attaches an address to the EXISTING anonymous
> `auth.users` row rather than creating a second account. […] There is no
> migration step, no "claim your walks" screen, no window in which a row belongs
> to nobody.

This kills the concern I raised when you first described the wall. I said
gating albums would mean "either migrating local albums into an account at
sign-up, or admitting two kinds of album." **Neither is true.** The id never
changes, so there is nothing to migrate — the account arrives around data that
is already owned.

What changes at upgrade is one JWT claim: `is_anonymous` flips, and
`public.is_guest()` starts returning false. Nothing in the app re-evaluates
anything; the policies read the claim on every query.

### What a guest is already blocked from

Read out of `supabase/migrations/007_rls.sql`:

| Action | Line | Guest allowed? |
|---|---|---|
| create a journey, album, walk (private) | — | **yes** |
| make a journey `visibility = 'public'` | 275, 282, 314 | no |
| share a journey with someone | 296 | no |
| add to an album *they do not own* | 355 | no |
| create a group | 230 | no |
| send a friend request | 207 | no |
| invite anyone | 386, 425 | no |

The policy at line 275 carries the reasoning in a comment:

> A guest's walk is genuinely theirs, but it does not go on the world globe
> until there is an account behind it.

So the shape already implemented is: **private is free, public and social need
an account.**

---

## The argument for each wall

### For the built one (public/social needs an account)

- **Accountability.** Anything on the globe is visible to strangers. An
  anonymous row that can publish is a spam and abuse vector with nobody behind
  it, no way to contact them, and nothing to ban that costs anything — a fresh
  guest is one request away.
- **The free action is the one that creates value for the user alone.** Nothing
  is asked of someone until they want something *from other people*.
- **It is already written, reviewed and reasoned about**, including the
  `visibility` interaction, which is the fiddly part.

### For yours (album needs an account)

- **An album is the first thing worth protecting.** A walk can be re-recorded;
  a set of walks someone named and curated is the artefact they would be upset
  to lose, so it is the natural moment to say "let's make sure this is yours."
- **Posting to the globe is the growth loop.** Every barrier in front of it
  costs reach, and asking for an email before someone has seen their capture on
  a map is asking before you have shown them why.
- It puts the prompt at a moment of *investment* rather than at a moment of
  *intent to publish*, and investment is when people accept friction.

### My reading

The two are not actually in conflict on the axis that matters, because
**"account" and "guest" are already the same row**. The real question is only
*when you ask for the email*, and the honest answer is that the database already
enforces the safety-critical half (nothing anonymous reaches the public globe)
and is silent about the rest.

So: **keep the built wall as the security boundary, and put your wall on top of
it as the prompt.** Concretely — a guest may create albums freely, and the album
screen invites them to add an email so they do not lose it, without refusing
anything if they decline. The globe stays gated because that one is not a
nudge, it is a policy.

**But that leaves the globe gated, and the globe is your growth loop.** This is
the one place the two designs genuinely collide, and no amount of layering
dissolves it: either an anonymous row can publish to the world or it cannot. If
posting is meant to be the thing that spreads, `007_rls.sql:275` has to change —
which is a deliberate decision to allow anonymous public content, and it brings
moderation, rate limiting and takedown along with it. That policy should be
changed on purpose or not at all; the one outcome to avoid is discovering it was
relaxed as a side effect of making a demo work.

---

## What is actually left to build

Everything below is blocked on a Supabase project existing.

1. **A client-side wall component.** Nothing in `components/` prompts for an
   email today. It needs to know `is_guest` — which means a session hook the app
   does not yet have — and to degrade to nothing at all when unconfigured.
2. **The unconfigured path must stay silent.** `ensureWriter()` returns
   `{ ok: false, reason: "unconfigured" }` in this deployment, and its own
   comment says callers "take that path; they do not report an error to the
   user." A wall that appears in a build with no auth server would be a dead end
   in front of a working app.
3. **Decide the globe question above.** It is the only one that changes SQL.
4. **The stores are not on Postgres yet.** `lib/albums.ts`, `lib/journey/store.ts`
   and the rest persist to `.data/` sidecars via `lib/persist.ts`. The wall is
   meaningless until ownership is a column rather than a file, because today
   there is no `owner_id` to check.

Point 4 is the real ordering constraint: **the wall cannot be built before the
stores move**, or it will be a prompt that gates nothing.

---

## What I did not do, and why

I did not write the wall. With no Supabase project I cannot run a single query
against these policies, and the whole point of a wall is what it refuses — which
is exactly the behaviour that cannot be verified here. Shipping an untested
authorization boundary is worse than shipping none, because it looks like
protection.
