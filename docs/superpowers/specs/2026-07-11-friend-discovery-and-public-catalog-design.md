# Friend Discovery & Public Catalog — Design

**Date:** 2026-07-11
**Status:** Approved (rev. 2 — incorporates UI Designer / UX Architect / UX Researcher review)

## Goal

Make it easy for people to find their friends on JigSwap, and give the platform
public, indexable surfaces that convert non-members. Five phases, each
independently shippable, in dependency order:

1. Public member profile page (`/members/$handle`) — the keystone
2. Follow requests + follow notifications
3. QR code + share link + logged-out growth loop
4. "Find people" directory tab
5. Public (unauthenticated) puzzle catalog

## Decisions made

| Decision                            | Choice                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow model                        | **Hybrid**: public profiles keep instant follows (as today); private profiles get a follow-request/approval flow.                                         |
| Growth loop scope                   | **Included**: logged-out teaser pages, signup attribution via invite token, auto-mutual-follow after invite signup, "show your QR" onboarding step.       |
| Directory shape                     | **Search-first**: search box (min 2 chars) + small "recently joined" seed of public profiles. Never a browse-all grid.                                    |
| Public review authors               | **Public profile → named** (including pre-existing reviews); private-profile authors shown as "A JigSwap member" on unauthenticated pages.                |
| Private profile, logged-out visitor | **Name shown, not indexed**: Instagram-style interstitial with name/username, but `noindex` robots meta and excluded from the sitemap.                    |
| Handle scheme                       | `users.username` for display/canonical URLs; **QR and share links encode the stable member-id URL** so renames never break them. Stale-username URLs 404. |

## Existing foundation (build on, don't duplicate)

- `profiles.visibility` public/private already ships (absent = public), enforced
  via the `social/privacy.ts` chokepoint: `profileVisibilityOf`,
  `areMutualFollowers`, `projectMemberIdentity`.
- Directed `follows` system (instant, no requests); **mutual follow** is the
  trust tier that unlocks private profiles and DMs (`connectionPolicy`).
- Privacy-gated fuzzy member search (`identity/searchUsers.ts`,
  `search/globalSearch.ts` — the ⌘K People results currently link to the
  `/people` placeholder).
- People hub (`_dashboard/people.tsx`) and reusable `MemberTile`.
- `profiles.featuredCopyIds` (curated shelf) already exists.
- Catalog queries `listAllPuzzles`, `getPuzzleById`, `getRecentPuzzles`,
  categories/brands/tags are **already unauthenticated** (approved-only).
  `getPuzzleById` has the canonical `optionalActingMember` optional-auth helper.
- `getPuzzleDefinitionView` already aggregates availability + rating breakdown,
  but is auth-gated and uses viewer-dependent circle reachability.
- Notification pipeline is event-driven; new kinds touch five sync points
  (domain `notification-type.ts`, schema validator, `notifications/subscriber.ts`,
  web `notification-meta.ts` KIND_META, `locales/en.json` + `nl.json`).
- Web components to reuse: `PuzzleCardShell`, the detail idiom
  (`SectionHead`, `Stat`, `CommunityRating` in `catalog-detail-parts.tsx`),
  `MemberTile`, `FollowButton`, `MessageButton`, the marketing shell
  (`mk-` tokens), `EmptyState`, skeleton loaders, `PuzzleCoverFallback`.

---

## Phase 1 — Public member profile page

**Route:** `/members/$handle` — standalone route (like the public home page,
which renders its own marketing shell outside `_public`). Logged-out visitors
get the marketing shell; logged-in members get the dashboard experience.

**Handle resolution:** username first, then member aggregate id. Pages for a
member with a username canonicalize to the username URL for display, but the
member-id URL always resolves (it is what QR/share links encode). A stale or
unknown handle renders a 404: "Member not found" + link to Find people.
Username-rename link-hijack risk is accepted for typed URLs (canonical
QR/share links are id-based and immune). Visiting your own handle redirects to
`/profile` (one own-profile surface only).

**Backend:**

- Reuse `getProfile(memberId)` (already ACL-gated) for authenticated viewers;
  add handle→member resolution.
- New **unauthenticated** query `getPublicMemberTeaser(handle)` returning a
  strictly limited payload routed through `profileVisibilityOf`:
  display name, username, avatar **only if** `users.shareAvatarPublicly`,
  member-since, and a coarse "collects ~N puzzles" count for public profiles.
  Never bio, shelf, stats, or location for private profiles.

**Page structure (all tiers share the identity header):** avatar (size-20),
display name (heading), `@username` muted mono, member-since, location
(public/full tier only); Follow/Message actions right-aligned (same pair as
`MemberTile`).

**Viewer tiers:**

- **Public profile, or mutual follower (logged in):** identity header → stat
  strip (owned / swaps completed / avg rating) → featured shelf
  (`featuredCopyIds`, `SectionHead` + puzzle-card grid) → bio.
- **Private + logged-in non-mutual — interstitial:** identity header (real
  avatar, name, username, member-since — the person feels present, not
  withheld), then one centered quiet card: muted lock icon,
  "**{Name}'s profile is private**", one line — "Follow each other to see
  their collection and swap." (mutuality framing, never paywall framing; no
  blurred-content silhouettes) — and the follow action. No Message button
  (connection-gated anyway). Nothing else on the page.
- **Logged out — teaser:** marketing shell, identity header (avatar
  consent-gated), "Collects **~N** puzzles on JigSwap" (public profiles only;
  omitted for private), brand CTA "Join JigSwap to follow {Name}" + ghost
  "Log in". Private profiles: same interstitial card as above with
  join/log-in CTA, plus **`noindex` robots meta**; excluded from sitemap.

**Auth round-trip:** every join/log-in CTA carries a `returnTo` through Clerk
back to the originating page, and the pending intent (follow / request)
completes after auth.

**Integration fixes:** ⌘K People results and `MemberTile` names link to
`/members/$handle`.

## Phase 2 — Follow requests + notifications

**Domain:** new `FollowRequest` aggregate in the social context
(requester, target, status `pending|approved|declined`, timestamps),
pair-unique, self-request rejected. Domain events
`FollowRequested`, `FollowRequestApproved`, `FollowRequestDeclined`.

**Schema:** `followRequests` table with indexes `by_requester`, `by_target`,
`by_requester_target`, `by_aggregate_id`.

**Behavior:**

- `followMember` becomes visibility-aware: target public → instant follow
  (unchanged); target private → create/refresh a pending request (idempotent).
- Approve → creates the requester→target follow edge; the approval UI offers a
  one-tap follow-back (mutuality unlocks content). Decline → silent; requester
  keeps seeing the requested state until a 7-day cooldown allows re-requesting.
- **Requester-facing states (honest, never stuck):** "Request to follow" →
  "Requested" with a caret menu to **Cancel request**; after ~48h (or a silent
  decline) the label reads "Requested — {name} hasn't responded yet".
- Owner making their profile private does not retroactively remove followers.

**Notifications — three new types** (all five sync points each):

- `follow.new_follower` — instant follows; includes one-tap follow-back action.
  (Fixes today's gap: following notifies no one.)
- `follow.request.received` — with approve/decline actions.
- `follow.request.approved`.

**UI placement:** incoming pending requests render as a dismissible strip
**above** the grid on the People page's default tab, with a count badge on
that tab (tabs arrive in Phase 4; until then the strip sits atop the page).

## Phase 3 — QR + share link + growth loop

**Show my QR:** full-viewport overlay (Dialog), entry points on own profile
and the People page. Content, vertically centered: avatar + display name (the
scanner confirms the face matches the phone) → the QR on an **always-white**
rounded card (dark mode must never invert the modules), sized
`min(70vw, 320px)` with ≥16px quiet-zone padding → the profile URL spelled
out in mono type (manual fallback for failed scans) → bottom row: outline
"Copy link" (with copied feedback) + brand "Share" (only when
`navigator.share` exists). Client-rendered (small QR lib), no backend call at
render time.

**QR/share URL:** `https://<host>/members/<memberId>?invite=<token>` — the
stable id URL (rename-proof); the page canonicalizes display to the username.
If the member has no username yet, prompt to set one before first showing the
QR (the mono caption and typeable URL depend on it).

**Invite tokens:** new small table `inviteLinks` — one stable token per member
(owner, token, createdAt, revokedAt?, counters). Token rather than bare
`?ref=memberId` for revocability and clean attribution. A "Reset invite link"
action lives in profile/settings; old token is revoked, new one issued.

**Landing behavior by visitor:**

- **Logged out, valid token:** Phase 1 teaser upgraded — "**{Name} invited you
  to JigSwap**" framing, sign-up as the only primary button.
- **Logged out, revoked/invalid token:** silently degrade to the plain teaser
  (no error banner).
- **Logged in, valid token (the modal meetup case — two existing members):**
  the profile page shows a one-tap prompt: "{Name} shared their code with
  you — follow each other?" → single tap establishes the mutual follow
  (auto-accepting any needed request; physically showing your QR is mutual
  intent). Invalid/own token: silently ignored.

**Attribution through signup (make-or-break detail):** the invite token is
persisted client-side (localStorage) before the Clerk sign-up redirect; after
account creation, a `redeemInvite` mutation runs once: records the
attribution, establishes the **mutual follow** between inviter and new member,
and is idempotent/ignores revoked or self tokens. `returnTo` handles
navigation back; the token handles the relationship.
**Fallback for lost attribution** (cross-device scan, in-app browsers,
private mode): if no token is found post-signup, onboarding shows a one-time
"Did someone invite you? Find them by name" prompt wired to people search.

**Loop closure:** immediately after an invite-based signup, the new member is
offered their own QR ("Anyone else here? Show them this") — **skippable,
shown once**.

**Instrumentation (lightweight, no analytics platform):** per-token counters —
landing views, signups attributed, follows established. Enough for:
scans → signup conversion, attribution survival, invites-per-inviter.

## Phase 4 — "Find people" directory tab

People page gets two tabs (existing Tabs component), URL-addressable via
`?tab=find` so other surfaces can deep-link:

- **Your network** (default): current content, with the Phase 2 pending
  strip above the grid and a count badge on the tab.
- **Find people:** search input (icon, placeholder "Search by name or
  @username"), min 2 characters — below that a muted helper line, not results.
  Reuses the gated `searchUsers` (public-or-mutual results only — unchanged
  semantics), rate-limited server-side. Results: single-column `MemberTile`
  list, names linking to `/members/$handle`, **location omitted** on
  discovery tiles (stats build trust; street-level context for strangers
  doesn't). Idle state below the box: "Recently joined" — up to 5 newest
  **public** profiles (new query routed through `profileVisibilityOf`), with
  its own cold-start empty state. Empty search result: "Can't find them?" +
  "Ask for their profile link — or scan their QR" + a "Show my QR" button.
- A "Show my QR" entry sits beside the search box, not only in the page
  header — it is the answer to "can't find them".
- One-time dismissible notice above the tabs at launch (info-toned, not
  warning-toned): "Your profile is discoverable — keep or change?" with an
  inline "Review visibility" link to the existing setting (public-by-default
  becomes _visible_ for the first time; don't flip the default).

## Phase 5 — Public puzzle catalog

**Routes:** `_public/catalog/` (list) and `_public/catalog/$id` (detail).
**Bidirectional redirect:** unauthenticated `/puzzles/$id` → `/catalog/$id`;
authenticated `/catalog/$id` → `/puzzles/$id` (members always get the richer
dashboard page with their own actions). **Entry point:** "Browse puzzles" in
the marketing header nav and footer — the catalog must not be SEO-orphaned.

**List page:** marketing shell; h1 + one-line sub; one toolbar row — search
input (debounced, flex-1), Brand select, Piece-count select (bucketed
<500 / 500 / 1000 / 1500+), sort (Newest default / Top rated). No filter
sidebar. Grid 2-col ≥sm / 3 ≥md / 4 ≥lg, "Load more" (not numbered pages;
SSR renders the first page for SEO). Empty search: puzzle glyph, "No puzzles
match '{query}'", "Try a brand name or fewer words", Clear-search button.

**Definition card (new component — do NOT reuse `PuzzleCard`, which renders
an owned-copy DTO with owner actions):** box art (fallback gradient), 2-line
clamped title, muted "Brand · **1,000** pieces" (mono count), badge row:
difficulty pill + star rating "4.6 (23)", and an outline **"N to swap"**
badge **only when N > 0** — never show "0 to swap". No condition/availability
copy-level badges. Stretched-link to `/catalog/$id`.

**Detail page:** reuse the dashboard detail skeleton (hero → stats strip →
rating/reviews), minus member-only pieces:

- Hero: box-art cover; eyebrow, title, "Brand · pieces", rating + difficulty +
  topic pills. **One** primary brand CTA — "Join JigSwap to request a swap"
  (→ sign-up with `returnTo`), plus a ghost "Log in". No
  favorite/review/suggest-edit actions.
- Stats strip: **Available to swap first** (it's the hook), then Community
  owners, then completions/avg-days **only when non-zero** — hide empty stats,
  never render dashes.
- Availability panel (replaces the per-copy owner list): `SectionHead`
  ("Available in the community"), soft brand-tinted card: big number, label
  "copies available to swap right now", per-type chips ("2 swap · 1 lend" —
  the public payload includes the per-type breakdown), a stack of 3 generic
  overlapping avatar circles (muted, non-identifying — signals people), inline
  CTA "Join to see who". **Zero availability:** omit the panel; if owners > 0
  show "N members have this in their collection" instead (avoid a
  broken-promise first session).
- Reviews: existing `CommunityRating` breakdown + read-only review list.
  Author display via a new public identity projection: named + avatar iff the
  author's profile is public; otherwise generic avatar glyph + italic
  "A JigSwap member". Applies to all reviews including pre-launch ones (per
  decision). In place of the composer: one muted "Log in to write a review"
  line. The member-facing review composer gains a small permanent note that
  reviews also appear on public catalog pages.
- **Known asymmetry (by design, note for tests):** the public availability
  count (public-profile owners only, no circle reachability) will differ from
  the member-facing count. Do not "fix" this.

**Hidden publicly:** all copy- and member-level data — owner identities, copy
photos, conditions, prices, locations, per-owner reputation cards.

**Guard rails:** every public query filters `status === "approved"` (existing
leak-prevention pattern) and uses the `optionalActingMember` pattern. Backend
tests assert public payloads contain no owner ids/names/copy data.

**SEO scaffolding (none exists today):**

- Per-route meta description + OpenGraph tags on catalog pages (extend the
  existing `head()` pattern; box-art image as `og:image` via storage URL).
- `robots.txt` (static) and a sitemap endpoint (Nitro route) listing
  **catalog URLs only**. Public member profiles are indexable but not
  sitemap-listed; private member teasers carry `noindex`.
- SSR the catalog pages via the existing public-loader pattern
  (`ensureQueryData` on an unauthenticated query, as the home page does).
  Prerender stays docs-only; catalog is SSR-on-demand.

---

## Cross-cutting

- **No new visibility logic:** every new read path routes through
  `profileVisibilityOf` / `areMutualFollowers` / a public projection built on
  them. The public review/teaser projection lives in `social/privacy.ts` next
  to `projectMemberIdentity` (note: `cyrb53`/`anonRefOf` are currently private
  to that module).
- **Testing (repo conventions):** domain `.spec.ts` for the FollowRequest
  aggregate and invite-redemption policy; backend `.test.ts` at `convex/` root
  for gated queries/mutations — including assertions that logged-out payloads
  never leak bio/shelf/stats/owner data, and that pending/rejected definitions
  never appear publicly.
- **i18n:** all new strings in `en.json` + `nl.json` (+ `source.json`),
  including the three notification copy blocks.
- **Enum sync points:** new notification types fan out across the five known
  locations; verify each (some are not type-enforced).

## Deferred (explicitly out of scope)

- Shareable public collection pages ("here's what I have to swap")
- Group/meetup pages with a group QR
- Completion share cards (social image generation)
- Suggested-people recommendations (mutuals-of-mutuals, location, circles)
- Contact/address-book import (rejected: trust-corrosive), follower counts on
  profiles (rejected: status-seeking), incentivized referrals (rejected)
- Pre-launch email / login-time modal for the discoverability announcement
  (banner + inline visibility link chosen instead; revisit if feedback warrants)

## Build order & rough effort

1. Member profile route — **M**
2. Follow requests + notifications — **M**
3. QR + growth loop — **M/L** (QR screen itself is S; attribution flow,
   logged-in scanner prompt, and fallbacks are the bulk)
4. Directory tab — **S/M**
5. Public catalog + SEO — **M/L**
