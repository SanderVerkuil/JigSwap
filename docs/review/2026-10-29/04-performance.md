# JigSwap: performance and scalability review (2026-10-29)

**Audience:** owner/developer.
**Scope:** frontend bundle, rendering, images and caching (part A), and the cost and scalability of the Convex backend (part B).

**Path conventions:**

- Frontend paths are relative to the repo root.
- Backend paths in part B are relative to `packages/backend/convex/` unless they start with `apps/` or `packages/`.

**Evidence:**

- Frontend: a production build of the deployed commit `f2503d0963` (`ANALYZE=1 pnpm build`), with sizes from node `zlib` and per-route weights from the TanStack Start manifest. It was cross-checked with read-only `curl` against https://jigswap.site, and one temporary experiment build was made and reverted (A1).
- Backend: static reading of the code at `6b04171e55`. **No load tests were run.**
- Cited line numbers are the same at both commits.

---

## TL;DR

**Frontend: three changes give most of the gain.**

1. **A1.** Move `CopyInstanceScreen` out of a route file. This was **measured** to cut every page's entry from 395.5 to 274.0 KB gz (−31%).
2. **B1.** Pin Vercel functions to an EU region. SSR currently runs in `iad1` (Washington) against Convex in eu-west-1.
3. **A2.** Stop downloading the 819 KB gz rapier physics bundle on every profile view.

After those, the next wins are inline i18n (204 KB of the 277 KB home HTML), full-size images everywhere (3.4 MB on `/catalog`) and eager three.js on mobile.

**Backend: fine at today's scale, but several reads grow with the whole platform.**

- Production is tiny: the sitemap lists 9 approved catalog entries.
- Several reads are unbounded or cover the whole platform. They will either fail at Convex's per-function read limit or multiply bandwidth with every write.
- The top three are:
  - **Browse** scans `ownedPuzzles` and only ever sees the oldest 500 open copies.
  - **Landing stats** read every row of three tables, and the home page loader waits on them.
  - The **activity feed** reads up to 2,000 platform-wide events for each viewer and re-runs on every feed event.

---

## A. Frontend

### A.0 Bundle overview

The client build has 321 JS files and 2 CSS files: **6.54 MB raw, 2.09 MB gzip, 1.70 MB brotli**. Of the JS files, 142 are under 1 KB and 86 are 1–5 KB.

| Chunk                 | raw KB | gzip KB | Contents                                                                                                           | Loaded by                                            |
| --------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `scene-physics`       | 2,211  | **819** | `@dimforge/rapier3d-compat` with WASM inlined as base64, plus `@react-three/rapier`                                | Lazy, profile shelf (`/profile`, `/members/$handle`) |
| `box`                 | 911    | **241** | `three`, `@react-three/fiber`, maath, some drei                                                                    | Lazy, landing hero, dashboard shelf, profile shelf   |
| `index` (**entry**)   | 432    | **119** | Clerk localizations (41 gz), the cropper (42 gz), all of `routes/_dashboard/copies/$id.tsx`, cmdk, dialogs, router | **Every page**                                       |
| `insights`            | 372    | 106     | recharts, d3, redux toolkit                                                                                        | `/insights` only                                     |
| `_virtual_docs`       | 430    | 91      | All 58 docs pages (en + nl)                                                                                        | Every `/docs/*` page                                 |
| `clerk`               | 305    | 88      | react-dom, `@clerk/react`, `@clerk/shared`                                                                         | Every page                                           |
| `globals.css`         | 185    | 29      | Tailwind (177 KB of utilities), render-blocking                                                                    | Every page                                           |
| `use-whats-new-state` | 96     | 30      | `virtual:whats-new` (84 entries with bodies)                                                                       | Every dashboard page                                 |
| `schemas`             | 84     | 24      | zod v4                                                                                                             | Every page (because of A1)                           |
| `i18n`                | 44     | 14      | Includes server-only `negotiator`, `content-type`, `cookie-es` (about 6 gz)                                        | Every page                                           |
| `index-*.css`         | 8.7    | 1.5     | react-advanced-cropper CSS, render-blocking                                                                        | Every page                                           |

**Already handled well:**

- posthog-js is a consent-gated dynamic import (`apps/web/src/lib/analytics-client.ts:20`).
- shiki runs only at build time.
- frimousse, minisearch, @dnd-kit and recharts are confined to their own chunks or routes.

### A.0b Initial JS weight per route (local build)

| Route chain                    | JS gzip          | Files | Lazy extras                                                          |
| ------------------------------ | ---------------- | ----- | -------------------------------------------------------------------- |
| `__root__`                     | 395.5 KB         | 111   | +30.8 KB gz CSS                                                      |
| `/` (signed out)               | **405.6 KB**     | 119   | +241 KB gz three/R3F after hydration, plus up to 12 full-size covers |
| `/_dashboard` layout           | 492.1 KB         | 166   | The layout adds 96.6 KB: whats-new 30, shell 13.5, QR 7.3, tour 6    |
| `/dashboard`                   | **512.2 KB**     | 177   | +241 KB gz three/R3F if the member owns at least one copy            |
| `/profile`, `/members/$handle` | about 499–503 KB | 175   | **+1,060 KB gz** physics + three                                     |

**Production cross-check** (`curl` of every asset preloaded by `https://jigswap.site/`):

| Measure                        | Value                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| Preloaded JS/CSS files         | 73                                                                          |
| Total size                     | 1,604 KB raw, 458 KB gz, 390 KB br                                          |
| Prod entry `index-c3ftvWmm.js` | 846 KB raw / 241 KB gz. It also contains the cropper and both Clerk locales |
| HTML document                  | 277 KB raw / 76 KB br                                                       |

### A.1 Findings

**Bundle**

- **A1. A route file exports a component.**
  - `apps/web/src/routes/_dashboard/copies/$id.tsx:104` exports `CopyInstanceScreen`, which `apps/web/src/routes/_dashboard/my-puzzles/$id.tsx:2` imports.
  - The router keeps a route file's non-`Route` exports in the module that `routeTree.gen.ts` imports statically. That pulls the 1,476-line screen into the entry, along with the cropper and its CSS (`apps/web/src/components/image-editor/image-editor-dialog.tsx:18`), zod, cmdk and the dialogs.
  - It is the only route file with such an export.
- **A2. Physics loads eagerly.** `apps/web/src/components/common/puzzle-plank-3d/index.tsx:19,138` loads `scene-physics` whenever `interactive` is set, WebGL exists and reduced motion is off. That includes mobile. Call sites: `apps/web/src/components/members/profile-body.tsx:685`, `apps/web/src/components/profile/shelf-section.tsx:109`.
- **A3. three.js loads with no idle or device gating.** It loads right after hydration on the landing hero (`apps/web/src/components/marketing/plank-3d/index.tsx:7,75`, `apps/web/src/components/marketing/home/hero.tsx:326`) and on the dashboard shelf (`apps/web/src/components/dashboard-home/shelf-section.tsx:223`).
- **A4. Both Clerk locales are in the entry** (`apps/web/src/routes/__root.tsx:1,181`): 41 KB gz.
- **A5. What's-new bodies ship on every dashboard page.**
  - `apps/web/src/components/whats-new/use-whats-new-state.ts:7` only needs `WHATS_NEW_IDS`, but `apps/web/src/components/whats-new/entries.ts:2` imports the full `virtual:whats-new`.
  - The ids already exist in `packages/contracts/src/whats-new/manifest.generated.ts`.
- **A6. The whole docs corpus (91 KB gz) ships on every docs page.** It is imported by `apps/web/src/routes/_public/docs/$.tsx:10`, `apps/web/src/routes/_public/docs/index.tsx:9`, `apps/web/src/components/docs/docs-sidebar.tsx:12` and `apps/web/src/components/docs/docs-search.tsx:22`, even though these pages are prerendered.
- **A7. Server-only i18n code reaches the client** (`apps/web/src/lib/i18n.ts:46-66`): about 6 KB gz.
- **A8. Chunk fan-out.** 111 root modulepreloads locally (71 in prod), mostly lucide icons and radix sub-packages.

**HTML, SSR and caching**

- **B1. SSR runs in Washington.**
  - Every HTML response carries `x-vercel-id: fra1::iad1::…`, and `apps/web/vercel.json` sets no region.
  - Measured TTFB: `/` 437–685 ms, `/catalog` 443 ms, `/about` 192 ms.
  - For comparison, the prerendered `/docs` is served from the fra1 edge in 105 ms, and assets in about 75 ms.
  - Each SSR Convex loader call and the Clerk middleware cross back to the EU.
- **B2. The full message catalog is inlined in every HTML document.**
  - `getIntl` returns all messages (`apps/web/src/lib/i18n.ts:111-114`), and the root dehydrates them (`apps/web/src/routes/__root.tsx:132`).
  - That is 204 KB of the 277 KB `/` document. Marketing pages need about 15 KB of it.
  - HTML is served with `max-age=0`, so the catalog is re-downloaded on every document load.
- **B3. The landing SSR waits on three full-table scans.** `packages/backend/convex/insights/getGlobalStats.ts:9-13` is awaited by the `/` loader (`apps/web/src/routes/index.tsx:35-37`). This is the same issue as backend item 2.
- **B4. Clerk JS goes through an uncacheable redirect.** `clerk.jigswap.site/npm/@clerk/clerk-js@6/…` answers `307` with `no-store` before the immutable bundle loads. There is no preconnect, and this happens on marketing pages too.
- **B5. Cache headers.**
  - `/assets/*` is immutable (good).
  - Only `/docs/*` is prerendered (`apps/web/vite.config.ts:30,38`). About, features, how-it-works, privacy and terms are SSR'd per request through iad1.
  - `/version.json` is `no-store` and polled every 5 min (`apps/web/src/lib/app-version.ts:14`).
- **B6. Signed-in SSR HTML is marked `public`.** The response carries `cache-control: public`, while the root dehydrates the Clerk `token` (`apps/web/src/routes/__root.tsx:132`). Vercel will not CDN-cache it without `s-maxage`, but it should be `private, no-store`. The header was only observed on a signed-out response.
- **B7. The service worker is push-only, which is reasonable.**

**Images and fonts**

- **C1. No thumbnails exist.**
  - Box art is re-encoded at full size, as JPEG q90 or PNG if any pixel is transparent (`packages/backend/convex/lib/imageModeration/pipeline.ts:126-129`).
  - The client caps the long edge at 1,600 px (`apps/web/src/lib/prepare-photo.ts:18`).
  - `thumbFileId` is "not produced yet" (`packages/backend/convex/schema.ts:1014`).
  - Live `/catalog`: 9 card images total **3.4 MB**, including a **1.77 MB PNG**, shown in cards roughly 200–300 px wide.
  - Convex serves them as `private` and they are not cached at the CDN (`cf-cache-status: DYNAMIC`).
- **C2. Images are lazy everywhere, including above the fold** (`apps/web/src/compat/image.tsx:74`). Almost no caller passes `priority`, and there is no `srcset`.
- **C3. Oversized, lazy, above-the-fold logos.**
  - `apps/web/src/components/dashboard-layout/mobile-top-bar.tsx:13,87-89`: 1884×1268, 59 KB, shown at 28 px.
  - `apps/web/src/components/common/header-logo/index.tsx:3-11`: 3044×786, 65 KB, with no width/height.
  - `apps/web/src/components/marketing/wordmark.tsx:4,10-15`: 18.8 KB.
- **C4. Blurhash is used for chat and pending photos, but not for catalog or box art.**
- **C5. Fonts are render-blocking.**
  - Google Fonts CSS (`apps/web/src/routes/__root.tsx:111`) loads Baloo 2 plus **9 Poppins weights**, while the source uses 400–700.
  - The fonts are not self-hosted and have no preload and no fallback metrics.
  - Visitor IPs go to Google before consent.

**Runtime**

- **D1. Dashboard waterfall.**
  - No dashboard route has a loader. The chain is: Clerk script → 307 → clerk-js → Convex auth → `identity.byClerkId` → page queries → full-size images.
  - The server-side Convex token set at `apps/web/src/routes/__root.tsx:127-130` goes unused for this.
- **D2. 3D scenes render at 60 fps while visible, even when idle.** All three use `frameloop={visible ? "always" : "never"}` with `dpr={[1, 2]}`:
  - `apps/web/src/components/common/puzzle-plank-3d/scene.tsx:305-306`
  - `apps/web/src/components/common/puzzle-plank-3d/scene-physics.tsx:603-604`
  - `apps/web/src/components/marketing/plank-3d/scene.tsx:505-506`
- **D3. `ThreadItemView` is not memoized** (`apps/web/src/components/messaging/thread-view.tsx:579`). It re-renders on minute ticks (`:101`), inbox changes (`:124`) and partner presence (`:160`). The cost is O(loaded messages) per update.
- **D4. Lists are not virtualized.** This is acceptable at family scale.
- **D5. The presence activity handler calls `setState` on every `pointermove`** (`apps/web/src/components/presence/app-presence.tsx:22`).

### A.2 Prioritized frontend fixes

Impact and effort are the analyst's estimates, except A1, which was measured.

| P      | Item                 | Impact                                                                                                                                                                         | Effort       | Evidence                                                                                                                                                                | Fix                                                                                                               |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **P0** | A1 route export      | **Measured: −121 KB gz (−31%) on every page's entry**, −47 preloads, and no render-blocking cropper CSS. `/` drops from 405.6 to 285.4 KB gz, `/dashboard` from 512.2 to 455.5 | ~30 lines    | `apps/web/src/routes/_dashboard/copies/$id.tsx:104`; `apps/web/src/routes/_dashboard/my-puzzles/$id.tsx:2`                                                              | Move the screen to `components/copies/copy-instance-screen.tsx`; add a check that route files export only `Route` |
| **P0** | B1 SSR region        | −150 to −350 ms TTFB on every SSR page                                                                                                                                         | 1 line       | `x-vercel-id: fra1::iad1`; `apps/web/vercel.json` has no `regions`                                                                                                      | Set `"regions": ["dub1"]` (or fra1) next to Convex eu-west-1                                                      |
| **P0** | A2 eager physics     | −819 KB gz and about 1.5 MB WASM compile per profile view without interaction                                                                                                  | small        | `apps/web/src/components/common/puzzle-plank-3d/index.tsx:19,138`                                                                                                       | Render the static scene first; load physics on the first pointerdown or a "play" affordance                       |
| **P1** | B2 inline i18n       | HTML 76 → ~25 KB br; −200 KB inline parse before hydration                                                                                                                     | medium       | `apps/web/src/lib/i18n.ts:111-114`; `apps/web/src/routes/__root.tsx:132`                                                                                                | Split namespaces per route group, or ship the catalog as a hashed immutable asset                                 |
| **P1** | C1 thumbnails        | About 85–90% fewer image bytes (3.4 MB → ~0.4 MB on `/catalog`)                                                                                                                | medium       | `packages/backend/convex/lib/imageModeration/pipeline.ts:126-129`; `schema.ts:1014`                                                                                     | Generate 480 / 960 px renditions in the pipeline; expose `thumbUrl`; use `srcset` / `sizes`                       |
| **P1** | A3 three.js gating   | −241 KB gz and ~1.5 MB parse on mobile first visits                                                                                                                            | small        | `apps/web/src/components/marketing/plank-3d/index.tsx:7,75`; `apps/web/src/components/dashboard-home/shelf-section.tsx:223`                                             | `requestIdleCallback`; skip on small viewports, `saveData` or low `deviceMemory`; keep the CSS plank              |
| **P1** | B3 landing stats     | Bounded landing SSR latency; no fan-out invalidation                                                                                                                           | small–medium | see backend item 2                                                                                                                                                      | Maintained counters                                                                                               |
| **P2** | A4/B4 Clerk          | −20 to −41 KB gz per page; one uncacheable round trip removed                                                                                                                  | small        | `apps/web/src/routes/__root.tsx:1,181`                                                                                                                                  | Lazy-load nl-NL only; pin `clerkJSVersion`; `preconnect`                                                          |
| **P2** | A5 what's-new        | −30 KB gz per dashboard page                                                                                                                                                   | small        | `apps/web/src/components/whats-new/entries.ts:2`                                                                                                                        | Read ids from the manifest; dynamic-import the bodies                                                             |
| **P2** | C5 fonts             | No render-blocking third-party CSS; less swap CLS; no pre-consent IP leak                                                                                                      | small        | `apps/web/src/routes/__root.tsx:111`                                                                                                                                    | Self-host Baloo 2 + Poppins 400–700; preload 2 woff2 files; `size-adjust` fallbacks                               |
| **P2** | C3/C2 logos          | −140 KB on first dashboard visit; earlier header paint                                                                                                                         | trivial      | `apps/web/src/components/common/header-logo/index.tsx:3-11` and the two other logo files                                                                                | SVG or 2× WebP; `priority`; explicit width/height                                                                 |
| **P2** | D1 dashboard loaders | Removes 2–3 serial network steps before dashboard LCP                                                                                                                          | medium       | `apps/web/src/routes/__root.tsx:127-130`                                                                                                                                | After B1, add SSR loaders using the server token; resolve the member by auth                                      |
| **P2** | A6 docs corpus       | −85 KB gz per docs visit                                                                                                                                                       | medium       | `apps/web/src/routes/_public/docs/$.tsx:10`                                                                                                                             | Per-page HTML from the loader; lazy search index                                                                  |
| **P3** | D2 render loops      | Far less idle GPU/CPU and battery                                                                                                                                              | small        | `scene.tsx:305-306` and the two other scene files                                                                                                                       | `frameloop="demand"` + `invalidate()`; cap dpr at 1.5 on touch devices                                            |
| **P3** | A8/A7 chunks         | ~110 → ~30 preloads; −6 KB gz                                                                                                                                                  | small        | `apps/web/src/lib/i18n.ts:46-66`                                                                                                                                        | Rolldown `advancedChunks`; move server-only code to `i18n.server.ts`                                              |
| **P3** | B6/B5 caching        | Caching hygiene; edge-speed TTFB for marketing pages                                                                                                                           | small–medium | `apps/web/src/routes/__root.tsx:132`                                                                                                                                    | `private, no-store` on signed-in SSR; prerender or edge-cache marketing pages                                     |
| **P3** | D3/D5/QR             | Smoother long threads; −7.8 KB gz on the dashboard                                                                                                                             | small        | `apps/web/src/components/messaging/thread-view.tsx:579`; `apps/web/src/components/presence/app-presence.tsx:22`; `apps/web/src/components/social/invite-redeemer.tsx:6` | Memoize `ThreadItemView`; throttle the activity handler; lazy-load the QR dialog                                  |

**Combined estimate:** P0 + P1 should take signed-out `/` from about 460 KB gz JS/CSS plus 76 KB br HTML to roughly 260 KB plus 25 KB, with about 40% lower TTFB. It should also stop the 1 MB-plus 3D and image downloads on mobile and on profile views. This is an estimate; only A1 was measured.

---

## B. Backend (Convex)

### B.0 Scale and cost model

- **Today:** production is tiny. `https://jigswap.site/sitemap.xml` has 10 `<loc>` entries: the catalog root plus 9 approved puzzles. The risks are assessed at **10k members, 100k copies and 1M messages**.
- **How cost arises:**
  - A reactive query re-runs whenever anything it read changes.
  - Bandwidth ≈ documents read per run × runs per write × distinct cached results.
  - Queries that check the caller's auth are cached separately for each member.
  - Past Convex's per-function document and byte limits, a function **throws** rather than slowing down.

### B.1 Prioritized backend risks

The analyst gave likelihood and impact. **Effort** is the reviewer's grouping, based on the analyst's suggested order: "quick win" means no schema change; "model" means a schema or read-model change that needs a backfill. Items the analyst did not place in that order are estimated, marked with \*.

| #   | Risk                                                                                                                                                                                                                                | Likelihood / impact                                         | Effort                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Browse** scans all of `ownedPuzzles`. Below 500 open copies it reads the whole table; above 500 it only sees the **oldest** 500 (wrong results, wrong `total` / `hasMore`). Text search runs in memory over those candidates only | Certain / High                                              | Model                                   | `library/browseOwnedPuzzles.ts:79-94`, `:152-200`; `schema.ts:365-369`                                                                                                                                                                                                                                                                                                                                                   | `isOpen` field with a `by_open` index, `.order("desc").paginate()`; ideally a `listings` read model with facet and search indexes                                                       |
| 2   | **Landing stats** `.collect()` `users`, `puzzles` and `ownedPuzzles`. The home loader awaits them, and live subscriptions re-run on any write                                                                                       | Certain / High (public home page fails past the read limit) | Model                                   | `insights/getGlobalStats.ts:9-13`; `apps/web/src/routes/index.tsx:35-37`                                                                                                                                                                                                                                                                                                                                                 | Aggregate or sharded-counter component, or a cron-written `platformStats` row                                                                                                           |
| 3   | **Activity feed** reads up to 4 × 500 platform-wide events per viewer and reads exchange rows before checking follows. It is invalidated by every feed event and again when dispatch marks it processed                             | Certain / High                                              | Model (quick interim: make it non-live) | `social/getActivityFeed.ts:95-106`, `:114`, `:467`; `events/dispatch.ts:155`; `apps/web/src/components/dashboard-home/pulse-section.tsx:469`                                                                                                                                                                                                                                                                             | Per-member activity table written at event time. Interim: load once and refresh on focus or a timer; separate dispatch bookkeeping; put both parties in the `ExchangeCompleted` payload |
| 4   | **Definition aggregates** read every review, every copy (with one completions query per copy) and every owner profile. They run per row on the public catalog list, where `numItems` is not clamped                                 | High for popular puzzles / Medium–High                      | Model (clamp: quick win)                | `library/definitionAggregates.ts:87-94`, `:125-143`, `:169-191`; `catalog/browsePublicCatalog.ts:21,60,78,88-111`; `catalog/getPublicDefinitionView.ts:32-45`; `library/getPuzzleDefinitionView.ts:58-111`                                                                                                                                                                                                               | `definitionStats` table; drop the per-copy completions loop once `puzzleId` is on every completion; clamp `numItems` (for example ≤40)                                                  |
| 5   | **Whole-library reads** with no paging. `canViewCopy` rebuilds its context (household plus both block lists) **per copy**. The profile shelf loads the whole library to show about 6 items                                          | High for collectors / Medium–High                           | Quick win                               | `library/getOwnedPuzzlesByOwner.ts:30-58`; `library/canViewCopy.ts:78-89`, `:147-165`; `library/getCollectionById.ts:32-56`; `household/listHouseholdCopies.ts:31-51`; `exchange/getOfferableCopies.ts:31-58`; `apps/web/src/components/profile/shelf-section.tsx:35-40`                                                                                                                                                 | Build the context once and use `canViewCopyWithContext`, as `social/listProfileCopies.ts:88-97` does; bounded `.order("desc").take(n)` for shelves; page the library                    |
| 6   | **Inbox and unread badge** read all of a member's threads and re-run on every message in any of them. The `by_member_activity` index is maintained but never queried                                                                | Medium / Medium                                             | Model                                   | `conversation/getMyInbox.ts:389-441`; `conversation/getUnreadTotal.ts:38-54`; `schema.ts:1184`                                                                                                                                                                                                                                                                                                                           | Page the inbox via `by_member_activity`; keep a per-member `unreadTotal` row                                                                                                            |
| 7   | **`domainEvents` is never trimmed**, and every account deletion pages through the **entire** log                                                                                                                                    | Certain (growth) / Medium (cost)                            | Model                                   | `events/recordAndSchedule.ts:27-37`; `conversation/purgeMemberEvents.ts:146`; `conversation/purgeMemberMessagingData.ts:101-119`; `crons.ts` has only the moderation sweeps                                                                                                                                                                                                                                              | Retention cron via the unused `by_processed` index (`schema.ts:1844`); an event-to-member lookup table; an event filter for the notifications handler (`events/dispatch.ts:51-53`)      |
| 8   | **`puzzles` has no `status` index.** The pending queue, sitemap, facet browse and picker scan the table. The sitemap is uncached and falls back to empty on error                                                                   | High as the catalog grows / Medium                          | Quick win                               | `schema.ts:223-244`; `catalog/listPendingPuzzleDefinitions.ts:15-19`; `catalog/listSitemapEntries.ts:10-13`; `apps/web/src/routes/sitemap[.]xml.ts:22-26,35-37`; `catalog/browsePublicCatalog.ts:61-78`; `catalog/searchCatalog.ts:29-32`; `catalog/getAllSeries.ts:41-50`                                                                                                                                               | Indexes `by_status`, `[status, brand]`, `[status, pieceCount]`, `[brand, series]`; page the sitemap and give it `s-maxage`                                                              |
| 9   | **Client-controlled sizes and unthrottled or unauthenticated expensive endpoints**                                                                                                                                                  | Medium (abuse) / Medium                                     | Quick win                               | Unclamped: `catalog/browsePublicCatalog.ts:21`, `conversation/getThreadMessages.ts:31`, `browseOwnedPuzzles` `limit`. Platform scan: `library/getUserCollections.ts:45-96` (`includePublic`). Full-table public: `exchange/getExchangeStats.ts:9`. Unthrottled writes: `docs/submitDocFeedback.ts:12-37`, `submitContactMessage`. Unpaged admin lists: `docs/listDocFeedback.ts:14`, `contact/listContactMessages.ts:14` | Clamp every size; remove `includePublic` and `getExchangeStats`; a global throttle bucket in `rateLimits` and/or CAPTCHA; page the admin lists                                          |
| 10  | **Random seed per visit** defeats the landing-page query cache. Each visit reads 200 puzzles plus box art and 200 users                                                                                                             | Certain / Low–Medium                                        | Small\*                                 | `apps/web/src/components/marketing/home/hero.tsx:192-199`, `:212-217`, `:301-306`; `insights/getPlankPuzzles.ts:44-49`; `insights/getCommunityAvatars.ts:88-92`                                                                                                                                                                                                                                                          | Hour-bucket seed set server-side, or a shared pool shuffled on the client                                                                                                               |
| 11  | **Notifications:** the unread count and mark-all-read read everything; no retention; unused indexes on a busy table                                                                                                                 | Medium / Low–Medium                                         | Quick win                               | `notifications/unreadCount.ts:11-17`; `notifications/adapters/convexNotificationRepository.ts:58-79`; `schema.ts:1348-1357`                                                                                                                                                                                                                                                                                              | `.take(100)` and show "99+"; mark-all-read via `by_user_read` in batches; retention cron; drop `by_read_status`                                                                         |
| 12  | **Attachment queries** read every attachment a member sent in a thread to find the staged ones                                                                                                                                      | Low–Medium / Low                                            | Small\*                                 | `conversation/listMyPendingAttachments.ts:20-25`; `conversation/sendStagedImages.ts:79-83`; `conversation/messageAttachments.ts:507-514`, `:574-584`; `schema.ts:1119`                                                                                                                                                                                                                                                   | Index on `[threadAggregateId, uploaderId, messageId]`                                                                                                                                   |
| 13  | **Unpaged per-entity lists** (reviews, followers, exchanges, stats, completions)                                                                                                                                                    | Medium / Low–Medium                                         | Small–Medium\*                          | `social/listPublicPuzzleReviews.ts:28-41`; `social/listPuzzleReviews.ts:31-33`; `social/listFollowers.ts:34-44`; `exchange/getUserExchanges.ts:40-72`; `insights/getPersonalStats.ts:15-58`; `solving/listMyCompletions.ts:33-37`                                                                                                                                                                                        | Page them with `usePaginatedQuery`                                                                                                                                                      |
| 14  | **About 18 indexes are never queried** (write and storage overhead)                                                                                                                                                                 | Certain / Low                                               | Small\*                                 | See the list below                                                                                                                                                                                                                                                                                                                                                                                                       | Drop them, except the three that fixes 6, 7 and 11 would use                                                                                                                            |
| 15  | **Moderation workpool parallelism is 4**, so photos stay unpublished while queued during bursts                                                                                                                                     | Medium (bursts) / Low–Medium                                | Small\*                                 | `lib/imageModeration/moderationPool.ts:69`; `lib/imageModeration/hashRecheckPool.ts:88`                                                                                                                                                                                                                                                                                                                                  | Log queue depth; raise within the provider's rate limit                                                                                                                                 |
| 16  | **One-off backfills** read whole tables in a single mutation                                                                                                                                                                        | Low (only if re-run) / Low                                  | Small\*                                 | `solving/backfillCompletionPuzzleId.ts:9`; `library/backfill.ts:20,58,65`; `notifications/backfill.ts:10`; `exchange/backfill.ts:9`; `reputation/backfill.ts:21`; `solving/backfill.ts:13,20`; `catalog/migratePublishers.ts:21`                                                                                                                                                                                         | Cursor batches, as in `users.ts:197-222`                                                                                                                                                |

**Item 1 in numbers:** Browse reads candidates with `.filter(...).take(500)` and no index or order. The code's own comment admits it is "a read-cap, not a true index" (`library/browseOwnedPuzzles.ts:74-76`). The web asks for 50 rows (`apps/web/src/routes/_dashboard/browse.tsx:95`).

**Item 3 in numbers:** with 300 members on the dashboard, one feed event costs about **600k–750k document reads**, and it is sent up to twice: once on the insert and once on the processed-mark.

**Item 7 in numbers:** at 1M+ events, each account deletion means about 1,000+ chained mutations and millions of document reads.

**Unused indexes (item 14):**

| Table                | Unused indexes                                                |
| -------------------- | ------------------------------------------------------------- |
| `puzzles`            | `by_artist`, `by_category`, `by_difficulty`, `by_piece_count` |
| `ownedPuzzles`       | `by_owner_and_availability`                                   |
| `completions`        | `by_completion_date`                                          |
| `goals`              | `by_user_active`                                              |
| `reviews`            | `by_rating`                                                   |
| `adminCategories`    | `by_sort_order`                                               |
| `collectionMembers`  | `by_collection_owned_puzzle`                                  |
| `notifications`      | `by_read_status`, `by_created_at`                             |
| `domainEvents`       | `by_processed`, `by_failed`                                   |
| `threadParticipants` | `by_member_activity` (keep it and use it for item 6)          |
| legacy `messages`    | `by_sender`, `by_receiver`, `by_created_at`                   |

Keep `by_processed`, `by_created_at` and `by_member_activity` if fixes 7, 11 and 6 are adopted.

**Other costs to watch:**

- **Presence heartbeats.** A member on `/messages` who shares presence sends 4 heartbeat mutations per minute: the app room and the messages room, every 30 s (`apps/web/src/components/presence/app-presence.tsx:18`, `apps/web/src/routes/_dashboard/messages/route.tsx:51`). This is likely the largest source of function calls. The app room could use the allowed 60 s maximum (`presence.ts:27-28`).
- **MapTiler budget.** It uses two global `rateLimits` rows (`lib/rateLimits.ts:108-156`), which become a write-conflict hotspot if the caps are raised.

### B.2 Already done well

- **Messaging writes:**
  - The thread loads without its message history (`conversation/adapters/convexThreadRepository.ts:29-32`).
  - Read receipts don't touch the thread row (`:162-163`).
  - Unread counts are stored on the thread and participant rows and capped (`conversation/readModelHelpers.ts:234-286`).
  - `listThreadMessages` is paged and clamped (`conversation/listThreadMessages.ts:19-37`).
- **Bounded reads:**
  - Circle shares are capped at 200 per circle, 100 per copy and 500 circles per viewer (`library/circleSharedCopies.ts:20-30`, `:87-99`).
  - Profile and stats reads are capped (`getPublicProfile.ts:131-135`, `identity/getUserStats.ts:11-16`).
  - `getPresenceOf` is limited to 50 targets (`social/getPresenceOf.ts:13-29`).
- **Paging:**
  - `social/listProfileCopies.ts:56-86` pages and filters at the index.
  - `notifications/listMyNotificationViews.ts:68-96` clamps its page size.
  - Admin lists page their results.
- **Throttles:**
  - Presence (`presence.ts:27-61`, `lib/rateLimits.ts:37`).
  - Typing writes at most once per 2 s (`conversation/setTyping.ts:20-50`).
  - Push (`notifications/adapters/channels/pushChannel.ts:24-55`).
  - Circle email digest (`notifications/adapters/channels/emailChannel.ts:13-27`).
  - Grouped in-app notifications (`notifications/adapters/channels/inAppChannel.ts:7-34`).
  - Per-action and global rate limits (`lib/rateLimits.ts:11-156`).
- **Background work:**
  - Bounded workpools with retries for moderation and hash re-checks.
  - Paged, self-rescheduling crons (`lib/imageModeration/stalledSweep.ts:18-23`, `:56-61`, `:112-143`).
  - What's New notifications in batches of 100 (`whatsNew/notifyBatch.ts:10-56`).
  - Account deletion in phases of 100 rows (`conversation/purgeMemberMessagingData.ts:111-117`).
  - Events recorded in the same transaction and dispatched asynchronously (`events/dispatch.ts:34-44`).
- **Indexes:**
  - Search indexes for puzzles (filtered on status) and people (`schema.ts:113-115`, `:240-244`).
  - A skip-scan helper for distinct brands, publishers and tags (`catalog/getAllBrands.ts:13-19`).

### B.3 Suggested order

1. **Quick wins (no schema change):**
   - Clamp `numItems` / `limit` (#9, #4).
   - Build the visibility context once in `getOwnedPuzzlesByOwner` and `getCollectionById` (#5).
   - Point the profile and dashboard shelves at bounded reads (#5).
   - Unread count `.take(100)`, and mark-all-read via `by_user_read` (#11).
   - Remove `includePublic` and `getExchangeStats` (#9).
   - Make the activity feed non-live (#3 interim).
2. **Index-only change:** add `puzzles.by_status`, use it in the pending queue and sitemap, and cache the sitemap (#8).
3. **Schema or read-model work** (each needs a backfill):
   - Global-stats counters (#2, which also fixes frontend B3).
   - `isOpen` / listings for Browse (#1).
   - `definitionStats` (#4).
   - A per-member activity table (#3).
   - `domainEvents` retention (#7).
   - Inbox paging via `by_member_activity` (#6).

---

## C. If you only do five things

| #   | Change                                                                  | Area             | Why                                                                  |
| --- | ----------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| 1   | Move `CopyInstanceScreen` out of the route file (A1)                    | Frontend         | Measured −31% on every page's entry JS, for about 30 lines of change |
| 2   | Pin Vercel functions to an EU region (B1)                               | Frontend / infra | One config line; −150 to −350 ms TTFB on every SSR page              |
| 3   | Replace `getGlobalStats` scans with counters (backend #2 / frontend B3) | Both             | The public home page is the first thing that breaks at scale         |
| 4   | Fix the Browse candidate source (backend #1)                            | Backend          | It is already wrong above 500 open copies, not just slow             |
| 5   | Lazy-load physics on interaction and gate three.js (A2, A3)             | Frontend         | Removes up to 1 MB+ gz from profile and mobile first views           |

## D. Discrepancies and unknowns

- **Chunk sizes differ slightly between reports.** The state analyst quotes Vite's build log, and the performance analyst recomputed sizes with `zlib`. For example, `scene-physics` is 2,264 kB / 852 kB gz in the first and 2,211 KB / 819 KB gz in the second; `box` is 933 / 249 vs 911 / 241. The raw ratio is consistent with kB (1,000) vs KiB (1,024) units, and gzip levels differ. The client total agrees: the PR bot reports 2,097.6 kB gz, and the local measurement is 2.09 MB.
- **Local and production builds differ.**
  - Locally the entry is 432 KB raw / 119 KB gz with 111 root preloads.
  - In production it is 846 KB raw / 241 KB gz with 71 preloads.
  - The local build ran without env vars, but the analyst did not explain the full difference. The relative A1 gain was measured locally only.
- **`getGlobalStats` citation:** the frontend report cites lines 10-12 (the three `.collect()` calls) and the backend report cites 9-13 (the enclosing `Promise.all`). Both are correct.
- **Moderation provider:** the code default is Hugging Face (`packages/backend/convex/library/adapters/photoModeration.ts:12`), while item 15 assumes a Sightengine plan. Which provider prod uses is **unknown**.
- **Not measured:**
  - No browser run, so Core Web Vitals (LCP, INP, CLS) and whether `@clerk/ui` loads on signed-out pages are unconfirmed.
  - No backend load test, so all backend numbers are static estimates.
  - The signed-in `cache-control` header was not observed directly (B6).
