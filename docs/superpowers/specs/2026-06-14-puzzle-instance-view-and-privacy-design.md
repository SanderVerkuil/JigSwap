# Unified Puzzle Card + Privacy-Aware Puzzle-Instance View — Design

**Goal:** One unified puzzle card (layout identical, only actions differ by context); a new puzzle-_instance_ (owned copy) view page showing privacy-gated provenance/history; profile-level privacy enforced **over the wire** (Convex), not just in the UI.

**Approved decisions**

- **Connected = mutual follow** ("friends"): a private participant's real identity is revealed only when viewer and participant follow each other. Otherwise → "Anonymous user".
- **Pre-ownership history = condensed named timeline** (chronological; names where connected, else "Anonymous user").
- **Instance page reachable from My Puzzles + Browse** (serves your copies and others'); owner + history privacy-gated.
- **Instance-page history identity** uses the mutual-follow gate (above).
- **Browse listing visibility (refined per follow-up):** a copy appears in Browse only when (a) it is open to swap/sale/lend (availability flag set) **and** (b) the owner is reachable — owner profile is `public`, **or** owner shares a circle with the viewer / the copy is shared into a circle the viewer belongs to. Private, non-circle owners' copies are **filtered out** (excluded), not anonymized. (Browse uses the circle/public gate; the instance-history identity reveal uses mutual-follow — two distinct surfaces, two gates.)
- **Profile `visibility` default = `public`** (opt-in to private).

## Key facts (from code map)

- Copy identity is **stable across owners**: `ownedPuzzles.aggregateId` never changes; `copyCustodyEntries` (by_copy index) records every transfer `{previousOwner,newOwner,exchangeId,occurredAt}`.
- Completions: `completions` table has `userId` + optional `ownedPuzzleId` + dates — needs a **by-copy index/query**.
- Loans: `loans` table (by_copy) `{lenderId,borrowerId,status,createdAt,returnedAt,returnedBy}`.
- Social: `follows` table is **unidirectional** (`by_follower`,`by_followee`). No mutual/friends concept yet. No profile-visibility field. `identity/toMemberView` always surfaces real identity — anonymization must be added at the query chokepoint.
- Auth/viewer: `identity/requireMember(ctx)` resolves the acting member.

## Part A — Unified card

- Single `PuzzleCard` + single `PuzzleViewProvider` (auto-fill 212px grid). Normalized view-model:
  `{ id, title, brand?, pieceCount?, difficulty?, description?, tags?, imageUrl? }`.
- Slots: `actions?: ReactNode`, `badges?: ReactNode`, `footer?: ReactNode`, `selected?`, `onSelect?`.
- No-image fallback = gradient + puzzle icon (from `ui/puzzle-card`).
- Pages map their data + provide context actions (catalog / my-copy / browse / selection).
- Consolidate to `components/puzzles/`; re-export old paths to avoid breakage.

## Part B — Instance page `/copies/$id` ($id = ownedPuzzles.\_id)

- Route `routes/_dashboard/copies/$id.tsx` + `ROUTE_META["/copies/$id"]` (fallback prefix `/copies`). Reachable from My-Puzzles card (your copy) and Browse card (others').
- Renders: cover, title/brand/pieces/condition, owner (projected), acquisition, notes, availability, viewer actions; then the **History** timeline.
- For owner viewer: split **Since you acquired it** (full detail) vs **Before you** (condensed). For non-owner: whole history gated; owner line gated.

## Part C — Privacy (over the wire)

1. **Profile visibility**: domain event `ProfileVisibilityChanged` on the social `Profile` aggregate; `profiles.visibility: "public"|"private"` (default public); mutation `social.setProfileVisibility`; toggle in profile settings UI.
2. **`areMutualFollowers(ctx,a,b)`**: both directions present in `follows`.
3. **`projectMemberIdentity(ctx, viewerId, targetId, salt)`** — the single chokepoint:
   - self → real; target public → real; mutual-follow → real;
   - else → `{ anonymous:true, label:"Anonymous user", anonRef: hash(targetId+salt) }`. No real id/name serialized. `salt = copyId` so identical hidden people group within one timeline but can't be correlated across copies.
4. **`library.getCopyInstanceView({ copyId })`** (auth-gated): snapshot + `viewerIsOwner` + timeline merged from `copyCustodyEntries` + `completions`(by-copy) + `loans`, every participant via `projectMemberIdentity(salt=copyId)`, split before/since-you. Anonymous owner → hide Message; swap-request still routes through the copy.

## Part D — Browse listing filter (refined)

Extend `library/browseOwnedPuzzles` so a candidate copy is included only when:

- `availability.forTrade || forSale || forLend` (open to swap/sale/lend) — already filtered today; keep, AND
- the owner is reachable: `owner.profile.visibility === "public"` **OR** the copy is circle-shared with the viewer (reuse the existing `collectCircleSharedCopies` / shared-circle logic).

A private, non-circle owner's copies are excluded entirely (no row over the wire). This is a filter, not anonymization, so Browse cards keep showing the (now necessarily reachable) owner. Depends on the Phase 2 `profiles.visibility` field.

## Phasing

1. ✅ Unified card + provider (frontend).
2. Profile-visibility setting (domain event + Convex field + mutation + settings toggle) → verify + tests.
3. Privacy helpers (`areMutualFollowers`, `projectMemberIdentity`) + `getCopyInstanceView` (+ completions by-copy index) → verify + tests.
4. Browse filter (Part D): gate `browseOwnedPuzzles` by public-profile-OR-circle + availability → verify + tests.
5. Instance page wired from My Puzzles + Browse → verify.
6. i18n + full CI-mirror verify + deploy.

## Test/verify

- Domain: `.spec.ts` for any new domain logic (profile visibility, mutual-follow predicate if domain-side). Mutation gate ≥95%.
- Backend: `.test.ts` at convex root for `getCopyInstanceView` privacy projection (public→real, private+no-follow→anon, private+mutual→real, self→real).
- Web: `nx run-many -t lint type-check test build arch-check` + `format:check`.
