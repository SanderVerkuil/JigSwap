# JigSwap: current state of the application (2026-10-29)

**Audience:** owner/developer.
**Scope:** product surface, architecture conformance, code health and CI, testing, docs and repo hygiene drift, dependencies, delivery cadence, and key risks. Performance is covered in `04-performance.md`. Security and privacy are out of scope here.
**Evidence:** the state analyst's local CI mirror, coverage run, static code analysis, read-only `gh` queries and read-only `curl` of the live site. Paths are relative to the repo root. Every number below comes from that report. Where a number could not be measured, the report says **unknown**.

---

## TL;DR

- **The build is healthy.** The full CI mirror passed: format check, then 19/19 turbo tasks in 32 s. That covered 514 test files and **6,054 tests, with 0 failing and 0 skipped**. Coverage is domain 99.05% and backend 96.49% (lines). The domain mutation score is 97.7%. CI on GitHub has had 0 failures on `main` in 59 runs.
- **The product is broad for a family side project.** It has 71 web routes and 304 public Convex functions over 67 tables. It covers catalog, library, solves, exchange (trade/sale/loan), DMs and circle chat, households, circles, notifications (in-app, email, push), and admin moderation.
- **The architecture is only partly adopted.**
  - The gateway lint guardrails work: 0 web imports of `_generated`, and a probe file confirmed that a violation fails lint.
  - But the gateway is a map of function references. About 215 web files still import Convex client libraries directly.
  - The hexagonal rule "`ctx.db` only in adapters" is met by roughly half the function files, and nothing enforces it.
- **The release process is the weakest area.**
  - Web prod deploys through Vercel's Git integration without waiting for CI.
  - `main` has no required status checks and no required reviews.
  - The live site sends no CSP or framing headers.
  - PRs are large (median 554 changed lines) and merge in a median 44 minutes.
- **Docs have drifted badly.** The README still describes Next.js 15, pnpm 10, Crowdin and port 3000. The architecture spec still calls itself "not yet adopted".

## Health scorecard

The ratings are reviewer judgement (1 = poor, 5 = strong), based on the evidence in this document.

| Area                         | Rating | Rationale                                                                                                                                                                                                                     |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI and build health          | **5**  | Fully green, 32 s locally, about 3.6 min on GitHub; 194/200 recent runs succeeded, 0 failures on `main`                                                                                                                       |
| Automated testing            | **4**  | 6,054 tests, 0 skipped; high domain/backend coverage and mutation score; but the web has no coverage measurement and the gateway has 0 tests                                                                                  |
| Code health                  | **4**  | Near-zero debt markers (3 TODO, 0 FIXME); 49 lint warnings, all minor; but 412 `as unknown as` casts at the domain/Convex seam and several files over 1,000 lines                                                             |
| Architecture conformance     | **3**  | Seam guardrails are real; but `ctx.db` sits outside adapters in 46% of function files, about 215 UI files are coupled to Convex, and `_generated` is hand-maintained                                                          |
| Feature completeness vs spec | **4**  | Core loops shipped; gaps are auctions (none), dispute/recommendations/wishlist (backend-only), and 11 gateway operations with no UI                                                                                           |
| Dependency risk              | **3**  | Mostly current, 13 security overrides; but Nitro beta and several pre-1.0 Convex packages are in the production path; `pnpm audit --prod` shows stale overrides and a vulnerable seroval that is not reachable today (SEC-63) |
| Docs and repo hygiene        | **2**  | README, CONTRIBUTING, env examples, architecture status and the mutation doc are stale; 134 local branches have a missing upstream; 16 MB of unreferenced PNGs                                                                |
| Release safety and process   | **2**  | Web prod is not CI-gated; `main` requires no checks or reviews; no security headers; large PRs merged fast                                                                                                                    |

---

## 1. Baseline

| Item                   | Value                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Commit assessed        | `f2503d0963` (#391), the `origin/main` tip. It is live: `https://jigswap.site/version.json` reports `f2503d0963f7…`        |
| Reference checkout     | `6b04171e55` (#389), one commit behind. #391 changes only marketing art: 12 files, +18/−6, plus 16 MB of PNGs in `assets/` |
| Toolchain              | Node v26.3.0 (matches `.nvmrc:1`), pnpm 12.14.0 (`package.json:5`)                                                         |
| Install                | `pnpm install --frozen-lockfile --prefer-offline` finished in 1.9 s                                                        |
| Worktree after the run | Clean. Coverage output went to `/tmp`; a temporary lint probe file was created and then deleted                            |

## 2. Product overview and feature map

### 2.1 Surface size

| Layer             | Size                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Web routes        | 71 route modules (+2 co-located tests) in `apps/web/src/routes`; 47 component directories; 328 non-test components |
| Convex schema     | `schema.ts` is 2,081 lines with **67 tables, 215 indexes and 2 search indexes**                                    |
| Convex functions  | **147 queries + 149 mutations + 8 actions = 304 public**, plus 145 internal                                        |
| HTTP routes       | 1: `POST /clerk-users-webhook` (`packages/backend/convex/http.ts:91-92`)                                           |
| Crons             | 2 daily moderation sweeps (`packages/backend/convex/crons.ts:8-22`)                                                |
| Convex components | presence + 2 workpools (`packages/backend/convex/convex.config.ts:15-17`)                                          |
| Gateway           | 302 operations in 26 namespaces (`packages/gateway/src/operations.ts`)                                             |
| Domain            | 14 bounded contexts + shared kernel (`packages/domain/src/*`)                                                      |
| User docs         | 29 EN + 29 NL pages (`docs/user/{en,nl}`)                                                                          |
| What's new        | 42 entries in 2 languages, all dated 2026-10-17 to 2026-10-21                                                      |
| i18n              | `apps/web/locales/{source,en,nl}.json` have 3,900 keys each, with full key parity                                  |

### 2.2 Personas

| Persona          | Main routes (`apps/web/src/routes/`)                                                                                                                                                                                                  | Backend                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor          | `index.tsx`, `_public/{about,features,how-it-works,privacy,terms,contact}`, `_public/catalog/{index,$id}`, `_public/docs/{index,$}` (prerendered), `members.$handle`, `sign-in.$`, `sign-up.$`, `robots[.]txt.ts`, `sitemap[.]xml.ts` | public catalog, profiles, global stats                                                                                                 |
| Member           | `_dashboard/{dashboard,welcome,library,my-puzzles/*,copies/$id,puzzles/*,collections/*,completions/*,goals,insights,browse,trades,borrowed,messages/*,notifications/*,people,community,profile,whats-new}`                            | most modules                                                                                                                           |
| Household member | `_dashboard/household.tsx`                                                                                                                                                                                                            | `household/` (29 files): shared library, per-copy and bulk permissions, invite links, email invites, join requests                     |
| Circle member    | `_dashboard/circles/{index,$circleId}`                                                                                                                                                                                                | `sharing/` (39 files): circles, view / can-exchange / admin levels, invites, icons, `circleCopyShares`; circle chat in `conversation/` |
| Admin            | `_dashboard/admin/{index,categories,contact,feedback,moderation}`, `admin/puzzles/*`, `admin/puzzles/proposals/*`, `admin/users/*`                                                                                                    | `admin/` (26 files): triage, flagged / unchecked / box-art queues, report decisions, user detail                                       |

### 2.3 Core loops as implemented

| Loop                       | What exists                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog                    | Member submissions start as pending and need admin approval; change proposals; import from a store URL (`catalog/extractFromUrl.ts`, `importPuzzleImage.ts`); barcode lookup (`catalog/findPuzzleByBarcode.ts`); box-art moderation; favorites |
| Library                    | Copies (`ownedPuzzles`) with photos, crop/rotate, blurhash and moderation; collections; per-copy visibility; household access; 3D shelf; custody timeline (`apps/web/src/components/details/puzzle-detail/custody-timeline.tsx`)               |
| Solve                      | Completions (past and in progress), goals, puzzle- and copy-level reviews, insights with export (`insights/exportUserData.ts`)                                                                                                                 |
| Share / lend / swap / sell | Exchange types `trade \| sale \| loan` (`packages/backend/convex/schema.ts:820`); lifecycle `exchange/{propose,accept,decline,cancel,confirmCompletion,raiseDispute}.ts`; loans, custody entries, trade identity reveal                        |
| Message                    | DMs and circle group chats; puzzle, photo (moderated, blur and reveal) and MapTiler location attachments; typing indicators and presence                                                                                                       |
| Review                     | Partner reviews feed `reputationProfiles`; puzzle comments and photo comments                                                                                                                                                                  |

Cross-cutting features:

- **Social:** follows and follow requests, QR codes, invite links and email invites (AhaSend), activity feed, blocks, reports.
- **Notifications:** in-app, email and web push (VAPID, `apps/web/public/sw.js`), with preferences.
- **Product communication:** What's new and a guided tour.
- **Platform:**
  - PWA manifest.
  - Consent-gated PostHog (`apps/web/src/lib/analytics-consent.ts`).
  - Axiom logging.
  - Image moderation. The code default is Hugging Face; Sightengine and `none` can be selected (`packages/backend/convex/library/adapters/photoModeration.ts:12-21`).
  - A CSAM hash check (`lib/imageModeration/csamHashCheck.ts`).

### 2.4 Spec gaps and backend-only features

| Item                                                             | Status                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auctions (`spec/features/README.md:23`, `puzzle-exchange.md:95`) | Not implemented; 0 code references                                                                                                                                                                                                                                                                                                              |
| Dispute                                                          | `exchange/raiseDispute.ts` is mapped as `gateway.exchange.dispute` (`packages/gateway/src/operations.ts:214`), but no web caller exists. The UI only shows the "disputed" status                                                                                                                                                                |
| Recommendations                                                  | `insights/getRecommendations.ts` is mapped (`operations.ts:519`); no web caller                                                                                                                                                                                                                                                                 |
| Wishlist                                                         | Backend only (`library/createCollection.ts:24`, `schema.ts:466-468`); no UI                                                                                                                                                                                                                                                                     |
| Gateway operations with no UI                                    | 11 of 302: `catalog.listMyFavorites`, `library.addImage`, `exchange.byId`, `exchange.dispute`, `exchange.stats`, `social.isFollowing`, `insights.recommendations`, `admin.listImageReviewRequests`, `admin.decideImageReview`, `adminCatalog.listActive`, `adminCatalog.byId`. They are still publicly callable, so their gates need confirming |
| Spec acceptance criteria                                         | All 161 checkboxes in `spec/features/*.md` are unchecked. The spec is not used as a status tracker                                                                                                                                                                                                                                              |

## 3. Architecture and conformance

Measured against `spec/architecture/*.md`.

### 3.1 Gateway seam (Phase 0 exit criterion, `spec/architecture/04-migration-roadmap.md:29`)

| Metric                                                                       | Value                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web files importing `@jigswap/backend` or `*/_generated/*`                   | **0**                                                                                                                                                               |
| Web files importing the `@/gateway` shim (`apps/web/src/gateway/index.ts:3`) | 241                                                                                                                                                                 |
| Web files importing `@jigswap/gateway` directly                              | 1 (`apps/web/src/routes/_dashboard/admin/route.tsx:5`)                                                                                                              |
| Web files importing `@jigswap/domain` / `@jigswap/contracts`                 | 0 / 62                                                                                                                                                              |
| Guardrails                                                                   | **Verified to fail on violation.** A probe file produced `no-restricted-imports` and `boundaries(dependencies)` errors. Rules: `.oxlintrc.json:138-215`, `:217-235` |

**Gap:** the gateway re-exports Convex `api` references unchanged (`packages/gateway/src/operations.ts:1,10`). It is not a transport abstraction.

- 215 of 525 non-test web files import Convex packages directly:
  - `@convex-dev/react-query`: 196 imports
  - `convex/react`: 45
  - `convex/server`: 91
  - `ConvexError` from `convex/values`: 30
  - `convex/browser`: 3
- Swapping the transport would therefore touch 200+ UI files, which is what specs 03 and 04 aimed to avoid.
- There is no BFF layer. Only 3 `createServerFn` files exist, and `docs/developer-guide.md:206-209` acknowledges this.

### 3.2 Hexagonal adoption (backend)

| Metric                                          | Value                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/domain` non-test lines                | 22,115 (domain 10,845; application 8,405; test fakes about 2,052)                                                  |
| Use-case factories (`make*`)                    | 109                                                                                                                |
| Backend non-test lines (excluding `_generated`) | 51,093                                                                                                             |
| Files defining Convex functions                 | 366: **148 (40%) import the domain, 168 (46%) use `ctx.db` directly** (519 occurrences), 49 do both, 99 do neither |
| `ctx.db` inside `adapters/`                     | 103 occurrences across 11 directories                                                                              |
| Seam casts                                      | 412 `as unknown as` in backend non-test code, 278 of them `as unknown as Id<"…">`                                  |
| Untyped schema fields                           | `v.any()` at `schema.ts:1365` (`toggles`) and `:1828` (`domainEvents.payload`)                                     |

- **Follows the template:** the exchange slice. `exchange/accept.ts:13-27` checks auth, then calls `makeAcceptExchange` through adapters.
- **Not met:** the rule "`ctx.db` appears only in adapters" (`spec/architecture/02-hexagonal-architecture.md:210`). No tool enforces it.
- **Legacy entity-style files at the convex root:** `users.ts` (360 lines, 8 functions), `puzzles.ts`, `adminCategories.ts`, `backfillUserRoles.ts`.

### 3.3 Guardrail coverage

| Guardrail           | Scope                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dependency-cruiser  | 2 rules, both scoped to `packages/domain` (`.dependency-cruiser.cjs:6-40`). `arch:check` cruises only `packages/domain/src` (`package.json:26`), using swc because TS 7 has no JS API (`.dependency-cruiser.cjs:44-48`) |
| oxlint `boundaries` | Tier rules (`.oxlintrc.json:138-215`). app → backend-adapter is allowed; `_generated` is blocked separately                                                                                                             |
| `_generated`        | Maintained by hand: `api.d.ts` lists 555 modules, while 570 exist on disk. The 15 missing modules define no functions, so the types are still sound, but codegen is not being regenerated                               |

### 3.4 Next.js migration residue

- 102 files still import the Next.js compat shims: `@/compat/link` 60, `clerk` 33, `navigation` 22, `image` 18.
- The oxlint `nextjs` plugin is still enabled (`.oxlintrc.json:3`). It produces 24 `no-img-element` warnings.
- Stale comments:
  - `packages/gateway/src/index.ts:2` says "Next today, TanStack Start next".
  - `apps/web/src/gateway/index.ts:2` says "for the Next UI".
  - `packages/backend/convex/convex.config.ts:6` says presence powers "ONE thing", but `presence.ts:13-15` also defines online and away rooms.

## 4. Code health and CI

### 4.1 Local CI mirror

The run mirrors `.github/workflows/ci.yml:43,48`.

- `pnpm run format:check`: **passed** (17.6 s).
- `pnpm exec turbo run lint type-check test build arch:check --concurrency=4 --force`: **19/19 passed, 0 cached, 32.4 s**.

| Package            | lint                                                  | type-check | test          | build | Test files / tests |
| ------------------ | ----------------------------------------------------- | ---------- | ------------- | ----- | ------------------ |
| @jigswap/web       | pass, **28 warnings**                                 | pass       | pass (17.4 s) | pass  | 157 / 1,301        |
| @jigswap/backend   | pass, **21 warnings**                                 | pass       | pass (32.4 s) | n/a   | 220 / 2,801        |
| @jigswap/domain    | pass, 0 warnings                                      | pass       | pass          | n/a   | 131 / 1,739        |
| @jigswap/contracts | pass                                                  | pass       | pass          | n/a   | 2 / 123            |
| @jigswap/email     | pass                                                  | pass       | pass          | n/a   | 4 / 90             |
| @jigswap/gateway   | pass                                                  | pass       | no test task  | n/a   | 0 / 0              |
| `//#arch:check`    | pass: no violations (677 modules, 2,316 dependencies) |            |               |       |                    |

**Warnings and notes:**

- **Web lint warnings:**
  - 24 × `nextjs(no-img-element)`, a Next.js rule still running on a TanStack app.
  - 2 × `jsx-a11y(role-has-required-aria-props)`, at `apps/web/src/components/ui/color-picker.tsx:66` and `apps/web/src/components/ui/emoji-picker-input.tsx:47`.
  - 2 × unused variables.
- **Backend lint warnings:** all 21 are `no-unused-vars`, all in `*.test.ts` files.
- **Prerender:** the build logs `Missing secretKey` (Clerk) and `Prerendered 0 pages` but still exits 0, because of `failOnError: false` (`apps/web/vite.config.ts:36`). This is expected without env vars and is deliberate: the comment at `apps/web/vite.config.ts:33-35` says unrenderable pages fall back to SSR. The side effect is that a real prerender failure in a Vercel build would also go unnoticed, and `/docs` would quietly lose its edge-cached HTML.
- **Vite 8 deprecation warnings:**
  - The native config loader does not support `__dirname` or extensionless imports.
  - `vite-tsconfig-paths` is now redundant.
- **Chunks over 500 kB:** see `04-performance.md`.

### 4.2 GitHub CI history (read-only `gh run list`)

| Metric                              | Value                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Last 200 CI runs (since 2026-10-18) | 194 success, 1 failure, 5 cancelled                                                                     |
| Duration                            | median 217 s, p90 307 s                                                                                 |
| `main`                              | 59 runs, 0 failures                                                                                     |
| CodeQL                              | Runs on every `main` push through GitHub default setup, so there is no workflow file for it in the repo |

### 4.3 Code-health signals

| Signal                    | Value                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TODO / FIXME / HACK / XXX | 3 / 0 / 0 / 0. The TODOs are `apps/web/src/routes/_dashboard/browse.tsx:115` (server-side availability filter), `packages/domain/src/index.ts:9` and `typing.test.ts:16`                        |
| Lint / TS suppressions    | 51 `oxlint-disable` / `eslint-disable`; 4 `@ts-expect-error` / `@ts-ignore`                                                                                                                     |
| Largest source files      | `schema.ts` 2,081; `routes/_dashboard/copies/$id.tsx` 1,476; `my-puzzles/add/new.tsx` 1,031; `components/messaging/thread-view.tsx` 1,021; `notifications/resolveNotificationView.ts` 938 lines |

## 5. Testing

| Package            | Test files                      | Test LOC | Source LOC | Coverage (lines)                      |
| ------------------ | ------------------------------- | -------- | ---------- | ------------------------------------- |
| apps/web           | 157                             | 22,956   | 75,017     | **not measured** (no coverage script) |
| packages/backend   | 220 (all at the `convex/` root) | 79,938   | 51,093     | 96.49%                                |
| packages/domain    | 131                             | 22,243   | 22,115     | 99.05%                                |
| packages/contracts | 2                               | 380      | 3,163      | not measured                          |
| packages/email     | 4                               | 657      | 787        | not measured                          |
| packages/gateway   | 0                               | 0        | 693        | none                                  |

Full coverage (v8, local run). These figures match the PR #391 report bot.

| Package | Statements | Branches | Functions | Lines  |
| ------- | ---------- | -------- | --------- | ------ |
| domain  | 98.55%     | 97.11%   | 98.39%    | 99.05% |
| backend | 94.22%     | 86.36%   | 95.79%    | 96.49% |

**Mutation testing:**

- Stryker runs on the domain package (`packages/domain/stryker.config.json`, break threshold 95 at `:39`).
- CI runs it only on PRs that touch `packages/domain/**` (`.github/workflows/mutation.yml:9-14`), and it is not a required check.
- The latest score (PR #379, 2026-10-21) is **97.7% overall, with all 15 contexts at or above 95%**.
- `packages/email/stryker.config.json` exists, but no workflow runs it.

**Caveats:**

- **Backend coverage scope:** the backend vitest config has no `coverage.include`, so 96.49% only covers files that tests load. Whether that includes every module is **unknown**.
- **Hidden failures:** `packages/backend/vite.config.ts:18` sets `dangerouslyIgnoreUnhandledErrors: true` to cope with scheduled jobs that convex-test leaks. This can also hide real unhandled rejections. `testTimeout` is 20 s (`:22`).
- **Focus and skips:** there are 0 `.skip` / `.only` / `.todo` / `xit` / `xdescribe`.

## 6. Docs and repo hygiene drift

| Claim                                                       | Where                                                    | Reality                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Built with Next.js 15", App Router, Turbopack, next-intl   | `README.md:3,52,58,76,190,230,246`                       | TanStack Start + Vite 8 + Nitro (`apps/web/vite.config.ts:1-10`), `use-intl`                                                                                                                                                                                                 |
| pnpm v10.13.1, Node v18+                                    | `README.md:73,84-85`; `CONTRIBUTING.md:27-28`            | `pnpm@12.14.0` (`package.json:5`); `.nvmrc` v26.3.0; CI uses Node 22 (`.github/workflows/ci.yml:28`)                                                                                                                                                                         |
| CI comment "pnpm@11.5.2"                                    | `.github/workflows/ci.yml:23`                            | 12.14.0                                                                                                                                                                                                                                                                      |
| App runs on `localhost:3000`                                | `README.md:141`; `CONTRIBUTING.md:108`                   | Port 3001 (`apps/web/vite.config.ts:16`)                                                                                                                                                                                                                                     |
| Web scripts `build:analyze`, `crowdin:upload`, `preview`, … | `README.md:252-257`                                      | Do not exist. The actual scripts are dev, build, start, type-check, test, whats-new:manifest, lint                                                                                                                                                                           |
| Crowdin with OTA updates                                    | `README.md:37,67`; `CONTRIBUTING.md:77-79`               | No Crowdin integration. `apps/web/src/lib/i18n.ts:87-88` refers to a `getCrowdinMessages` that does not exist. `source.json` is byte-identical to `en.json`                                                                                                                  |
| `NEXT_PUBLIC_*` env names                                   | `CONTRIBUTING.md:69-79`; `packages/backend/.env.example` | Web uses `VITE_*`. Backend `.env.example` lacks `ANON_REF_SECRET`, `CLERK_WEBHOOK_SECRET`, `VAPID_*`, `MAPTILER_*`, `SIGHTENGINE_*`, `AXIOM_*` and `FIRECRAWL_API_KEY`, and lists unused `SENTRY_DSN`, `UPLOAD_SECRET`, `CROWDIN_*` and `NEXT_PUBLIC_*` (names only checked) |
| "Fill out the PR template"                                  | `CONTRIBUTING.md:160`                                    | No PR template in `.github/`                                                                                                                                                                                                                                                 |
| Architecture is "Proposal / RFC — not yet adopted"          | `spec/architecture/README.md:3`                          | Phases 0-5 are substantially adopted                                                                                                                                                                                                                                         |
| Current state is "pnpm + Nx", "Next.js 16"                  | `spec/architecture/appendix-current-state.md:9-10`       | Turborepo (PR #90 replaced Nx)                                                                                                                                                                                                                                               |
| Data fetching via `convex/react` `useQuery` / `useMutation` | `docs/developer-guide.md:87,206`                         | Mostly `convexQuery` / `useConvexMutation` from `@convex-dev/react-query` (147 / 98 imports). Otherwise the developer guide is accurate and itself flags the README as stale (`:14-17`)                                                                                      |
| Mutation baseline 80.30%, break 75                          | `packages/domain/MUTATION-TESTING.md:84-105`             | Break 95, latest score 97.7%                                                                                                                                                                                                                                                 |

**Leftovers:**

- `vitest.workspace.ts` is a leftover from the Nx era.
- `.npmrc:1` hoists `@nextui-org/*`, but there are 0 nextui entries in the lockfile.
- `packages/backend/package.json:5` has `"main": "./src/index.js"`, but no `src/` directory exists.
- `pnpm-workspace.yaml` comments still mention `@nx/webpack`.
- `packages/backend/convex/README.md` is the default Convex boilerplate.
- #391 added 16 MB of PNGs to `assets/` that nothing in `apps/`, `packages/` or `docs/` references.

**Local git housekeeping** (nothing was deleted):

| Item                                  | Count                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Worktrees                             | 170, 0 prunable. The review brief expected about 190                           |
| Local branches                        | 247                                                                            |
| Branches merged into `main`           | 14 (16 against `origin/main`). This undercounts because the repo squash-merges |
| Local branches whose upstream is gone | **134**. This is the better staleness signal                                   |
| Remote branches                       | 83, of which 2 are merged                                                      |
| Open PRs                              | 0                                                                              |

## 7. Dependencies

| Area                        | Version                                                                                                                                              | Risk                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TypeScript                  | 7.0.2, native (`package.json:47`)                                                                                                                    | No compiler JS API. This forced workarounds: depcruise uses swc, and Stryker runs `inPlace` |
| Vite / Vitest               | `^8.3.4` / `^5.0.5`                                                                                                                                  | Config-loader deprecation warnings in the build                                             |
| React                       | 19.3.1, pinned (`apps/web/package.json:70`)                                                                                                          | Current                                                                                     |
| Nitro (prod server runtime) | **3.0.260903-beta**, pinned (`apps/web/package.json:103`)                                                                                            | Beta in the production path                                                                 |
| Pre-1.0 runtime packages    | `@convex-dev/react-query` ^0.1.0, `@convex-dev/presence` ^0.4.0, `@convex-dev/workpool` 0.4.13, `convex-helpers` 0.1.128; dev: `convex-test` ^0.0.62 | API churn risk. Every web data call goes through react-query 0.1                            |
| Lint                        | oxlint 1.88 + tsgolint; react-hooks and boundaries run as jsPlugins                                                                                  | Young plugin bridge                                                                         |

**Outdated packages:**

- `pnpm outdated -r` reports 31 entries, mostly patch or minor.
- Major-version gaps:
  - `@hookform/resolvers` 5 → 6
  - `eslint-import-resolver-typescript` 3 → 4
  - `parse5` 7 → 8 (pinned)

**Supply chain:**

- 13 security overrides pin transitive dependencies in `pnpm-workspace.yaml`.
- `minimumReleaseAgeExclude` has 20 exemptions. `minimumReleaseAge` is not set explicitly, so the effective value is **unknown**.
- There is one patch: a Stryker vitest-runner fix.
- There is no `dependabot.yml`, but Dependabot PRs do occur, presumably from repository settings.
- The state analyst did not run `pnpm audit`. The security review did run `pnpm audit --prod`. It found stale security overrides and a vulnerable `seroval` that is not reachable today; see SEC-63 in `02-security-review.md`.

## 8. Delivery cadence and release process

### 8.1 Cadence (commits on `origin/main`, ISO weeks)

| W37 | W38 | W39 | W40 | W41 | W42 | W43 | W44 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0   | 0   | 0   | 0   | 0   | 144 | 83  | 1   |

- **Activity comes in bursts:** 2025-07/08, then 2026-06/07 (PRs #16–#65), then **2026-10-17 to 21** (PRs #66–#390, with 62 / 82 / 43 / 16 / 24 merged per day), then one commit on 2026-10-29.
- **Delivery is effectively agent-driven:** 227 of 228 commits since October carry a `Co-Authored-By: Claude` trailer, and the squash bodies contain 877 `Intent:` trailers.

### 8.2 PRs

| Metric                                        | Value                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Total                                         | 297: 272 merged, 25 closed, 0 open                                                     |
| Creation to merge                             | median **44 min**, p90 about 8 h                                                       |
| Squash size (lines added + deleted, last 228) | median **554**, p25 236, p75 1,283, p90 2,412, max 14,452 (#66)                        |
| Over 1,000 lines                              | **76 of 228**                                                                          |
| Files changed                                 | median 13, p90 36                                                                      |
| Types                                         | feat 130, fix 60, docs 14, chore 9, ci 6, perf 3, refactor 2, build 2, test 1, spike 1 |

### 8.3 Workflows

| Workflow                                    | Trigger                                           | Role                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                                    | push to `main`, all PRs                           | format + `turbo run lint type-check test build arch:check`                                                                   |
| `convex-deploy.yml`                         | push to `main` (dev); `workflow_run` of CI (prod) | Prod deploys only when CI succeeded (`:121-126`), with a stale-commit guard (`:144-156`), then `publishPending` (`:176-207`) |
| `convex-preview.yml` / `vercel-preview.yml` | PRs labelled `preview`                            | Per-branch Convex preview seeded from a snapshot of the shared **dev** deployment, plus a Vercel preview                     |
| `convex-preview-teardown.yml`               | PR closed or label removed; manual sweep          | Deletes the preview                                                                                                          |
| `mutation.yml`                              | PRs touching domain                               | Stryker run, report and PR comment                                                                                           |
| `reports.yml`                               | all PRs                                           | Coverage, bundle treemap and dependency graph to GitHub Pages                                                                |
| `pages-maintenance.yml`                     | Mondays 04:17 UTC                                 | Prunes gh-pages                                                                                                              |

### 8.4 Release gating gaps

| Gap                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Web prod is not gated on CI.** Vercel's Git integration deploys `main` (`apps/web/vercel.json:3-7`), and the build runs a plain `pnpm build` outside preview (`scripts/vercel-build.sh:27,48`). Convex prod waits for CI, so a red `main`, or the window before the Convex deploy finishes, can leave new web code running against the old backend | `apps/web/vercel.json`, `.github/workflows/convex-deploy.yml:121-126` |
| **`main` requires no checks and no reviews.** The ruleset only has `deletion`, `non_fast_forward` and `required_linear_history`; classic protection reports "Branch not protected"                                                                                                                                                                   | `gh api …/rulesets/<id>`                                              |
| **No security headers.** Only `strict-transport-security` is present: no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. No header config exists in `apps/web`                                                                                                                                                  | live `curl -I https://jigswap.site/`                                  |

## 9. Key risks

| #   | Risk                                                                     | Why it matters                                                                                                                        | Evidence |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Web prod deploys bypass CI, and `main` has no required checks or reviews | A broken or unreviewed change reaches users; web and backend versions can diverge                                                     | §8.4     |
| 2   | Large agent-authored PRs merged fast without required review             | A median of 554 lines merged in a median 44 min is hard to verify by hand; a third are over 1,000 lines                               | §8.2     |
| 3   | No HTTP security headers                                                 | No defence-in-depth against XSS or clickjacking on an app with public sign-up                                                         | §8.4     |
| 4   | Hexagonal rule half-adopted and unenforced                               | `ctx.db` keeps spreading outside adapters, and logic there escapes the domain mutation testing (which runs only on `packages/domain`) | §3.2     |
| 5   | About 215 UI files coupled to Convex client libraries                    | The gateway seam does not deliver transport independence                                                                              | §3.1     |
| 6   | Beta and pre-1.0 runtime packages in the production path                 | Nitro beta and `@convex-dev/react-query` 0.1 carry upgrade-breakage risk                                                              | §7       |
| 7   | Stale onboarding docs and env examples                                   | A new contributor or a future you follows the README (Next.js, pnpm 10, port 3000, Crowdin) and fails                                 | §6       |
| 8   | 11 public functions with no UI caller                                    | Attack surface without product use; their gates need confirming                                                                       | §2.4     |
| 9   | `dangerouslyIgnoreUnhandledErrors` in backend tests                      | Real async failures can pass CI silently                                                                                              | §5       |
| 10  | Previews seeded from the shared dev deployment                           | If dev holds real member data, previews copy it (**unknown**)                                                                         | §8.3     |

## 10. Unknowns and discrepancies

**Unknowns:**

- Web test coverage.
- Whether backend coverage includes every module.
- The effective `minimumReleaseAge`.
- Whether the Vercel dashboard adds extra gating (an Ignored Build Step, or waiting for checks).
- Which moderation provider prod uses. The code default is Hugging Face (`packages/backend/convex/library/adapters/photoModeration.ts:12`), while the review brief names Sightengine.
- What data the dev snapshot used to seed previews contains.

**Discrepancies:**

- **Commits:** the analyst assessed `f2503d0963`, but this review's reference checkout is `6b04171e55`. The only difference is marketing art, so code citations hold for both.
- **Worktree count:** the brief expected about 190 worktrees; the analyst measured 170.
- **Prerender:** the build reports success while prerendering 0 pages. This is expected locally without the Clerk secret. Because `failOnError: false` (`apps/web/vite.config.ts:36`) falls back to SSR by design (`:33-35`), whether prod actually prerenders `/docs` is only visible from the live headers. The performance analyst saw `x-vercel-cache: HIT` on `/docs`, which suggests it does.
