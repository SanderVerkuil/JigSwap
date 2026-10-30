# Appendix B: Roadmap gap analysis (specs vs. implementation)

> An agent produced this analysis on 2026-10-29 by reading `spec/`, `docs/superpowers/specs/`, `docs/whats-new/` and `docs/user/`, and comparing them with the route tree and backend modules at `6b04171e55`.

Repo root: `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/app-review` (HEAD `6b04171e55`, 2026-10-21). All paths below are relative to that root.

**Method.** This is static reading only. Nothing was run in a browser. "Used by web" means a gateway key from `packages/gateway/src/operations.ts` is referenced under `apps/web/src`. Anything I could not confirm is marked _(unverified)_ and any opinion is marked _(opinion)_.

**Sizes.** S is about one PR, M is a short PR stack, L is a multi-week stack, XL is a new subsystem.

---

## 1. Shipped capabilities, by bounded context

**Catalog**

- Moderated puzzle definitions (submit, pending, approve/reject, disable/re-enable): `packages/backend/convex/catalog/{submit,approve,reject,disable,reenable}PuzzleDefinition.ts`, `apps/web/src/routes/_dashboard/admin/puzzles/`
- Import from a store URL, plus image import: `catalog/extractFromUrl.ts`, `catalog/importPuzzleImage.ts`
- Barcode lookup: `catalog/findPuzzleByBarcode.ts`
- Community change proposals: `catalog/proposeDefinitionChange.ts`, `routes/_dashboard/puzzles/$id/suggest-edit.tsx`, `routes/_dashboard/my-puzzles/suggestions.tsx`, `routes/_dashboard/admin/puzzles/proposals/`
- Separate publisher, brand and series fields with autocomplete: `catalog/getAllPublishers.ts`, `catalog/getAllSeries.ts`
- Public SEO catalogue and sitemap: `routes/_public/catalog/`, `routes/sitemap[.]xml.ts`, `catalog/browsePublicCatalog.ts`
- Box-art moderation with a publication gate: `catalog/moderateBoxArt.ts`, `catalog/boxArtInCheck.ts`
- Global en/nl taxonomy: `adminCategories.ts`, `routes/_dashboard/admin/categories.tsx`
- Favourites on definitions, with a favourites-only filter on /puzzles: `catalog/toggleFavorite.ts`, `apps/web/src/components/puzzles/puzzle-client.tsx:31`

**Personal Library**

- Copies with condition, notes, acquisition, availability (trade/lend/sale) and private/visible: `library/*.ts`, `routes/_dashboard/copies/$id.tsx`, `routes/_dashboard/my-puzzles/`
- Bulk add of up to 25: `library/acquireCopies.ts`, `routes/_dashboard/my-puzzles/add/quick.tsx`
- Copy photos: crop/rotate, cover, per-photo comments, EXIF stripping, moderation: `library/addCopyPhoto.ts`, `setCopyCover.ts`, `postPhotoComment.ts`, `moderatePhoto.ts`
- Collections (name, emoji, colour, description, visibility): `library/createCollection.ts`, `routes/_dashboard/collections/`
- Lending with recall/return and a Borrowed view: `library/recallLoan.ts`, `returnLoan.ts`, `getBorrowedLoans.ts`, `routes/_dashboard/borrowed.tsx`
- Profile shelf curation: `social/arrangeShelf.ts`

**Households** (not in `spec/`)

- Shared library with per-copy, bulk and default permission, invite links, email invites, join requests, rename, leave-and-join: `household/*.ts`, `routes/_dashboard/household.tsx`

**Solving**

- Start/finish/record solves, bulk past solves, 24h edit window, 5 photos per solve, duration setting, sharing in-progress solves: `solving/*.ts`, `packages/domain/src/solving/domain/completion.ts:14,17`, `routes/_dashboard/completions/`
- Two-level reviews (puzzle and copy): `solving/submitReviews.ts`
- Goals with derived progress and a `goal_achieved` notification: `solving/createGoal.ts`, `notifications/subscriber.ts:396`, `routes/_dashboard/goals.tsx`

**Exchange**

- Swap/sale/loan proposals; accept, decline, cancel; both parties confirm completion; ownership or possession transfers; circle-permission gate; identity revealed per trade: `exchange/*.ts`, `routes/_dashboard/trades.tsx`
- Chain of custody, shown as swap history on the copy page: `custody/subscriber.ts`, `routes/_dashboard/copies/$id.tsx:794`

**Reputation**

- Partner reviews with 4 sub-scores, plus a reputation profile and badge: `reputation/submitPartnerReview.ts`, `reputation/getReputationProfile.ts`

**Sharing / Friend Circles**

- Create, invite and accept (14-day expiry, 50-member cap), view/exchange/admin permissions, remove, leave, delete, owner succession, moderated icons, sharing copies into a circle: `sharing/*.ts`, `routes/_dashboard/circles/`

**Conversation**

- DMs, copy conversations, exchange threads and circle threads: `conversation/openDmThread.ts`, `openCircleThread.ts`
- Moderated photos shown "pending review", location sharing, copy attachments, rich text and emoji, typing, opt-in presence, mute, pagination: `conversation/*.ts`, `presence.ts`, `routes/_dashboard/messages/`

**Community / Social**

- Public profiles, private profiles with follow requests, follow, QR follow, invite links, connection offers, activity feed, Find people, comments on definitions and copies, blocking: `social/*.ts`, `routes/members.$handle.tsx`, `routes/_dashboard/people.tsx`, `routes/_dashboard/profile.tsx`

**Safety / Moderation**

- DSA reports with statements of reasons, image classifier, CSAM hash check with quarantine and escalation, unchecked-photo queue, rate limits: `reports/fileReport.ts`, `admin/decideReport.ts`, `lib/imageModeration/`, `lib/rateLimits.ts`, `routes/_dashboard/admin/moderation.tsx`

**Identity & Access**

- Clerk webhook, roles (admin only in the UI), account deletion purge, "Deleted member" ghost identity: `http.ts`, `users.ts`, `admin/setUserRole.ts`, `conversation/purgeMember*.ts`

**Notifications**

- In-app with inline actions; email via AhaSend (localised); web push (English only); per-type and per-channel preferences; presence-aware suppression; circle-chat email digest: `notifications/*.ts`, `packages/email`, `routes/_dashboard/notifications/preferences.tsx`

**Insights**

- Personal stats, 12-month trends, collection breakdown, trade activity, JSON export; global stats on the marketing site: `insights/*.ts`, `routes/_dashboard/insights.tsx`, `apps/web/src/components/marketing/home/stats.tsx`

**Onboarding / product communication**

- Quick start, guides/tours, What's new (modal and notification), installable app, new-version prompt, empty-page hints: `onboarding/*.ts`, `whatsNew/*.ts`, `routes/_dashboard/welcome.tsx`, `routes/_dashboard/whats-new.tsx`, `apps/web/src/components/app-update-prompt.tsx`

**Search, docs and support**

- ⌘K global search: `search/globalSearch.ts`
- Public en/nl docs with a "was this helpful" control: `routes/_public/docs/`, `docs/submitDocFeedback.ts`
- Contact form with an admin inbox: `contact/*.ts`, `routes/_dashboard/admin/contact.tsx`

**Admin**

- Users list, detail and role; puzzles list, detail and edit; proposals; categories; moderation console: `routes/_dashboard/admin/**`

**Platform and architecture**

- TanStack Start, Vite, use-intl, `@clerk/tanstack-react-start`, TS 7: `apps/web/package.json:17,51,88,107,109`
- Domain package, gateway seam and dependency-cruiser: `packages/domain`, `packages/gateway/src/operations.ts:1-9`, `.dependency-cruiser.cjs`
- Migration-roadmap phases P0–P5 are effectively done (`spec/architecture/04-migration-roadmap.md`). P3 and P6 have leftovers, listed in §2.

---

## 2. Specified but not built, or only partly built

| #   | Feature                                                                 | Where specified                                                                                                                     | Status in code                                                                                                                                                                                                                                                                        | Value | Size                      |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------- |
| 1   | Raise and resolve exchange disputes                                     | `spec/features/puzzle-exchange.md:68`; `spec/README.md:112`                                                                         | **Partial.** `exchange/raiseDispute.ts`, the `exchange_disputed` notification and a "disputed" pill (`routes/_dashboard/trades.tsx:45,76`) exist. `gateway.exchange.dispute` is not used by web, and there is no admin dispute queue.                                                 | H     | M                         |
| 2   | Admin review of message photos a sender asked to have reviewed          | Docs promise it (`docs/user/en/staying-informed/messages.md:342-346`)                                                               | **Partial.** `admin/listImageReviewRequests.ts` and `admin/decideImageReview.ts` exist. Their gateway keys (`operations.ts:641-643`) are not used, and `admin/moderation.tsx:292-320` has no tab for them.                                                                            | H     | S                         |
| 3   | Report puzzle reviews and comments                                      | `spec/features/community.md:56`                                                                                                     | **Missing.** Report targets are only user, message, copy, photo, exchange and attachment (`reports/fileReport.ts:7-13`). Review moderation is out of scope in `docs/superpowers/specs/2026-07-28-two-level-reviews-design.md:300`.                                                    | H     | S–M                       |
| 4   | See which circles can see a copy, and unshare it from one               | `spec/features/friend-circles.md:57-58`                                                                                             | **Missing.** Only `sharing/shareCopyToCircle.ts` exists. Shares are deleted only on leave or transfer (`library/adapters/eventPublisher.ts:19`, `sharing/adapters/inProcessEventPublisher.ts:131`). The copy page shows no circles.                                                   | H     | S                         |
| 5   | Complete data export (GDPR portability)                                 | `spec/features/personal-library.md:63`; `spec/features/friend-circles.md:87`; `spec/features/technical-requirements.md:15`          | **Partial.** `insights/exportUserData.ts` covers completions, copies, collections, goals, reviews, exchanges and quick start, capped at 5000 rows per collection (`:10`). It leaves out messages, circles, household, follows, blocks, comments, photos and notification preferences. | H     | M                         |
| 6   | Puzzle recommendations                                                  | `spec/features/advanced-features.md:37,41`; `spec/features/analytics.md:37`; `spec/features/community.md:65`                        | **Backend only.** `insights/getRecommendations.ts` is in the gateway as `insights.recommendations`, but no UI uses it.                                                                                                                                                                | H     | S                         |
| 7   | Wishlist                                                                | `spec/architecture/01-bounded-contexts.md:146,155`                                                                                  | **Backend only.** `collections.isWishlist` is in `schema.ts:466-469`, and the domain has it in `packages/domain/src/library/domain/collection.ts`. No UI.                                                                                                                             | M–H   | M                         |
| 8   | Loan duration and extending a loan                                      | `spec/features/puzzle-exchange.md:59,70`                                                                                            | **Partial.** The backend accepts `loanReturnDate` (`exchange/propose.ts:42`). The web dialog never sends it (`components/exchange/request-trade-dialog.tsx:135`), and the docs say "Borrow — no extra details" (`lend-swap-trade.md:43`). Extending is missing.                       | M–H   | S (due date) / M (extend) |
| 9   | Owner sets the price of a copy for sale                                 | `spec/features/puzzle-exchange.md:58`                                                                                               | **Partial.** `ownedPuzzles.salePrice` exists and `library/updateCopySharing.ts:28` accepts it. In the UI only the buyer can enter an offer.                                                                                                                                           | M     | S                         |
| 10  | Counter-offers                                                          | `spec/features/puzzle-exchange.md:57`                                                                                               | **Missing.**                                                                                                                                                                                                                                                                          | M     | M                         |
| 11  | Swaps with more than one puzzle                                         | `spec/features/puzzle-exchange.md:61`                                                                                               | **Missing.** There is a single `offeredPuzzleId` (`exchange/propose.ts:39`).                                                                                                                                                                                                          | M     | L                         |
| 12  | Conditions and requirements on an exchange                              | `spec/features/puzzle-exchange.md:60`; `spec/features/advanced-features.md:33`                                                      | **Missing.**                                                                                                                                                                                                                                                                          | L     | M                         |
| 13  | Condition history timeline                                              | `spec/features/advanced-features.md:30,32`; `spec/features/puzzle-exchange.md:78`                                                   | **Partial.** The `CopyConditionChanged` event is emitted (`packages/domain/src/library/domain/copy.ts:128`), but nothing projects it and there is no UI.                                                                                                                              | M     | M                         |
| 14  | Location discovery and distance                                         | `spec/features/puzzle-exchange.md:47,51`; `spec/features/community.md:48,61`                                                        | **Partial.** Location is free text only (`identity/setLocation.ts`, `users.location`). Browse has no location argument (`library/browseOwnedPuzzles.ts`).                                                                                                                             | M–H   | L                         |
| 15  | Saved searches with match alerts                                        | `spec/features/puzzle-exchange.md:52`; `spec/features/advanced-features.md:39`                                                      | **Missing.**                                                                                                                                                                                                                                                                          | M     | M                         |
| 16  | Browse filters by circle, brand and exchange type                       | `spec/features/puzzle-exchange.md:47-48`; `spec/features/friend-circles.md:65,67`                                                   | **Partial.** Browse filters on category, piece count, difficulty, condition and text (`browseOwnedPuzzles.ts` args). No circle filter.                                                                                                                                                | M     | S                         |
| 17  | Search and filter within my own library                                 | `spec/features/personal-library.md:41`                                                                                              | **Partial.** My Puzzles filters on status and owner only. Free-text search moved to ⌘K (`routes/_dashboard/my-puzzles/index.tsx:216`).                                                                                                                                                | M     | S                         |
| 18  | Edit, delete and archive goals; monthly/yearly goals                    | `spec/features/analytics.md:41,44`                                                                                                  | **Partial.** Only create and list exist. `goals.tsx` calls only `createGoal` and `myGoals`. `goals.isActive` exists but nothing sets it.                                                                                                                                              | M     | S                         |
| 19  | Default visibility for new copies; bulk visibility/availability changes | `spec/features/friend-circles.md:59-60`                                                                                             | **Partial.** Only household permission has a default and a bulk action (`household/setDefaultCopyPermission.ts`, `library/setCopiesHouseholdPermission.ts`).                                                                                                                          | M     | S                         |
| 20  | Circle description and rename                                           | `spec/features/friend-circles.md:45,51`                                                                                             | **Missing.** The `circles` table has `name` only. `createCircle` takes `{name}`, and there is no update mutation.                                                                                                                                                                     | M     | S                         |
| 21  | Notifications about new puzzles in my circles                           | `spec/features/friend-circles.md:68-69`                                                                                             | **Missing.** There is no such notification type.                                                                                                                                                                                                                                      | M     | M                         |
| 22  | Trending puzzles and community stats inside the app                     | `spec/features/community.md:62,64`; `spec/features/analytics.md:33-36`                                                              | **Partial.** `insights/getGlobalStats.ts` is shown on the marketing site only.                                                                                                                                                                                                        | M     | M                         |
| 23  | Users with similar taste / suggested people                             | `spec/features/advanced-features.md:38`                                                                                             | **Missing.** Deferred in `2026-07-11-friend-discovery-and-public-catalog-design.md:312`.                                                                                                                                                                                              | M     | M                         |
| 24  | Message search and archive                                              | `spec/features/community.md:74`                                                                                                     | **Missing.** There is no search, archive, edit or delete in `conversation/`.                                                                                                                                                                                                          | M     | M                         |
| 25  | Push notifications in Dutch                                             | `docs/superpowers/specs/2026-07-13-ahasend-transactional-email-design.md:161`                                                       | **Missing.** Push is English only by design (`notifications/copy.ts:6,300`).                                                                                                                                                                                                          | M     | S–M                       |
| 26  | Account suspension and moderator role                                   | Terms promise suspension (`apps/web/locales/en.json` → `terms.termination`); roles in `spec/architecture/appendix-current-state.md` | **Missing.** Bans are done by hand in Clerk (`2026-10-18-messaging-attachments-safety-design.md:213`). Only the admin role exists in the UI (`2026-07-08-admin-user-role-management-design.md:98`).                                                                                   | M     | M                         |
| 27  | WCAG 2.1 contrast                                                       | `spec/features/technical-requirements.md:20`                                                                                        | **Partial.** The default primary button is 3.80:1 in dark mode, against the 4.5:1 AA minimum (`2026-10-17-quick-start-design.md:789`). It was left out of scope (`:1354`).                                                                                                            | M     | S                         |
| 28  | Personal categories                                                     | `spec/features/personal-library.md:39`; `spec/architecture/04-migration-roadmap.md:66`                                              | **Backend only.** `library/createPersonalCategory.ts` exists, but it is not in the gateway and has no UI. Tags do exist.                                                                                                                                                              | L     | S                         |
| 29  | Favourites list; favouriting from Browse                                | Implied by the docs (`discovering-puzzles.md:21`)                                                                                   | **Partial.** `catalog.listMyFavorites` is unused. The Browse heart shows a "coming soon" toast (`routes/_dashboard/browse.tsx:236`).                                                                                                                                                  | L–M   | S                         |
| 30  | Compare with community averages; seasonal patterns                      | `spec/features/analytics.md:28-29`                                                                                                  | **Missing.**                                                                                                                                                                                                                                                                          | L     | S–M                       |
| 31  | Share achievements                                                      | `spec/features/analytics.md:45`; `spec/features/community.md:15`                                                                    | **Missing.** Share cards are deferred in `2026-07-11-...:311`.                                                                                                                                                                                                                        | L–M   | M                         |
| 32  | Helpful votes on reviews and review filters                             | `spec/features/community.md:54-55`                                                                                                  | **Missing.** `social/listPuzzleReviews.ts` takes `{puzzleId}` only.                                                                                                                                                                                                                   | L     | M                         |
| 33  | Community discussions                                                   | `spec/features/community.md:63`                                                                                                     | **Partial.** Only comments on definitions, copies and photos.                                                                                                                                                                                                                         | L     | XL                        |
| 34  | Auctions                                                                | `spec/features/puzzle-exchange.md:95`; `spec/README.md:43`; `spec/architecture/01-bounded-contexts.md:177`                          | **Missing.**                                                                                                                                                                                                                                                                          | L     | L                         |
| 35  | Condition photos tied to an exchange                                    | `spec/features/puzzle-exchange.md:67`                                                                                               | **Partial.** Photos can go in the trade chat or on the copy, but there is no condition record linked to the exchange.                                                                                                                                                                 | L     | M                         |

---

## 3. Notes left in specs: future work, out of scope, follow-up

Items marked "since shipped" have since been built, so the note is stale.

- **`docs/superpowers/specs/2026-06-13-puzzle-import-from-url-design.md:288-294`**
  - Open: Firecrawl fallback for blocked domains (Amazon), background scraping, auto-acquiring a copy, and the friction that a pending puzzle can't be acquired until approved _(unverified whether that friction still exists)_.
- **`2026-06-13-add-puzzle-redesign-design.md:120-127`**
  - Since shipped: instance photos (`library/addCopyPhoto.ts`).
  - Open: persisting the cover colour; changing the moderation model.
- **`2026-06-11-plank-3d-design.md:152-155`**
  - Since shipped: physics, on the profile plank.
- **`2026-06-15-profile-plank-physics-design.md:77-81`**
  - Open: physics on the dashboard plank; persisting positions.
- **`2026-06-15-profile-shelf-curation-design.md:71-75`**
  - Open: curating the dashboard shelf.
- **`2026-06-15-mobile-native-scroll…:93-97`, `…quick-polish…:64-69`, `…3d-plank-real-collections…:64-68`**
  - These were sequenced sub-projects ②–⑤. All have since shipped.
- **`2026-06-16-docs-ui-design.md:28-33`**
  - Since shipped: localised docs (`docs/user/nl`).
  - Open: a Developers section, MDX, and in-app "Learn more" deep links _(unverified)_.
- **`2026-06-23-completions-definition-and-instance-tracking-design.md:33-37`**
  - Open: community completion leaderboards.
- **`2026-07-02-admin-redesign-design.md:199-204`**
  - Since shipped: member reports.
  - Open: moderator roles; an app-wide restyle.
- **`2026-07-02-conversation-messaging-design.md:126-132`**
  - Since shipped: blocking and reporting, image messages.
  - Open: ad-hoc group DMs.
- **`2026-07-02-tanstack-query-migration-design.md:71-74`**
  - Partly shipped: loader prefetching, on public routes only (`routes/_public/catalog/$id.tsx`, `routes/index.tsx`).
  - Open: migrating pagination.
- **`2026-07-08-admin-user-detail-view-design.md:78-83`**
  - Open: editing profiles, deactivating users, impersonation, paginating the capped lists.
- **`2026-07-08-admin-user-role-management-design.md:96-100`**
  - Open: non-admin roles, role expiry.
- **`2026-07-08-puzzle-definition-change-proposals-design.md:21-26`**
  - Open by choice: approving single fields; auto-rejecting stale proposals.
- **`2026-07-11-friend-discovery-and-public-catalog-design.md:307-316`**
  - Open: shareable public collection pages, group/meetup QR, completion share cards, suggested people.
  - Rejected: contact import, follower counts, referral rewards.
- **`2026-07-13-ahasend-transactional-email-design.md:157-163`**
  - Partly shipped: digests (`notifications/threadDigest.ts`, circle chats only).
  - Open: retry via workpool, localised push, Crowdin for email copy, email verification.
- **`2026-07-13-convex-preview-teardown-design.md:84-89`**
  - Open by choice: a backlog sweep and a cron safety net.
- **`2026-07-13-maker-autocomplete-design.md:98-103`** and **`2026-07-13-publisher-brand-series-design.md:94-99`**
  - Open: autocomplete for artist and tags, fuzzy search, curated entity tables, a publisher filter in the catalogue.
- **`2026-07-14-content-width-conformance-design.md:118-122`**
  - Open: persisting the notification-feed filter.
- **`2026-07-14-notification-fixes-design.md:59-63`**
  - Open by choice: no data migration of corrupted preferences.
- **`2026-07-14-presence-aware-message-notifications-design.md:89-94`**
  - Open: sound, the browser Notification API, presence gating for other notification types.
- **`2026-07-27-completion-followup-design.md:172-179`**
  - Open: admin queue for completion photos, notifying the uploader on auto-reject, an orphaned-storage sweep, re-moderating legacy approvals, backend enforcement of finish-instead.
- **`2026-07-27-completion-row-navigation-design.md:166-177`**
  - Recorded as debt: turning `listMyCompletions` into DTOs; clearing `coverImageId` when a photo is rejected; links on the "Solving now" rail.
- **`2026-07-27-in-progress-solves-design.md:263-274`**
  - Open: push for started solves, timers, pause/abandon states.
  - Accepted limitation: the activity feed's global cap (`social/getActivityFeed.ts`).
- **`2026-07-27-my-puzzles-in-progress-indicator-design.md:40-42`**
  - Open: completed-state badges.
- **`2026-07-28-completion-photo-display-design.md:51-54`**
  - Open: photos on surfaces friends see; a lightbox.
- **`2026-07-28-two-level-reviews-design.md:298-304`**
  - Open: text on copy reviews, review moderation, telling owners about reviews, deleting your own review, friend review feeds.
- **`2026-10-17-households-design.md:290-295`**
  - Since shipped: names, invite revoke.
  - Open: explicit admin transfer (it currently passes automatically when the admin leaves), a guard on exchanges inside a household, email for household notifications, a household filter in Browse.
- **`2026-10-17-network-card-redesign-design.md:363-373`**
  - Noted, not fixed: "Follows you" on the Find tab; the `role="list"` accessibility defect in `find-people.tsx:95-98`.
- **`2026-10-17-quick-start-design.md:430-446`**
  - Open: the intent question and a step-order experiment, which need the activation report (`onboarding/activationReport.ts`, internal only).
- **`2026-10-17-quick-start-design.md:1345-1354`**
  - Since shipped: email invites.
  - Open: circles in quick start, nudge emails, inviter rewards, dark-mode button contrast.
- **`2026-10-17-whats-new-design.md:1308-1322`**
  - Partly shipped: interactive tour steps (`docs/whats-new/2026-10-18-tour-action-steps.en.md`).
  - Open: filtering and pagination of entries, mark-unread, reactions, an authoring CMS, a public changelog or RSS feed.
- **`2026-10-17-typescript-7-and-monorepo-tooling.md:194`**
  - Follow-up: fix the 11 native oxlint findings _(status unverified)_.
- **`2026-10-18-group-threads-presence-design.md:167-180`**
  - Since shipped: circle invite/accept.
  - Open: ad-hoc groups, group exchanges, @mentions, reactions and replies, timed mute/DND, last seen, read-by, delivery ticks, turning chat off per circle, presence on profiles and lists, typing shown in the inbox row.
  - Debt: drop `threads.readReceipts` after the backfill (`:108,255`).
  - Deferred: reporting a circle (`:432`).
  - Open: periodic purge of presence rows (`:479`).
- **`2026-10-18-messaging-attachments-safety-design.md`**
  - Since shipped: the CSAM hash check (`:376`).
  - Open: account suspension (`:213`), GIFs (`:377`).
- **`2026-10-19-circle-chat-identity-design.md:46-49`**
  - Since shipped: circle images (`2026-10-21-circle-icons`).
  - Open: localised push, push deep link to the thread _(unverified)_.
- **`2026-10-19-household-redesign.md`**
  - Open: merging the in-app and email pending lists (`:50`).
  - Since shipped: request-to-join (`:111`).
- **`2026-10-19-message-rich-text-design.md:211-221`**
  - Open: quotes, lists and code; markdown links and previews; mentions; reactions; shortcodes; a formatting toolbar; message editing.
- **`spec/architecture/04-migration-roadmap.md`**
  - Phase 3, personal categories UI (`:66`): open.
  - Phase 4, recommendations as a downstream projection (`:73-74`): backend only.
  - Phase 6, condition timeline and auctions (`:94-95`): open.

---

## 4. Contradictions

### User docs vs implementation

1. **Photo review is a dead end.** `docs/user/en/staying-informed/messages.md:342-346` says "A moderator looks at it". No admin screen shows those requests (§2 #2). The UI tells the sender "Review requested", and the request is never seen.
2. **Favourite on Browse.** `discovering-and-community/discovering-puzzles.md:21` lists **Favorite** as a Browse action. It opens a "Favorites are coming soon" toast (`routes/_dashboard/browse.tsx:236`; `locales/en.json` → `browse.favoritesComingSoon`).
3. **Completion rows.** `your-library/completions-and-goals.md:60` says rows show a "review quote, a star rating". `routes/_dashboard/completions/index.tsx` renders notes but no rating or quote. Two-level reviews removed per-solve stars (`2026-07-28-two-level-reviews-design.md`, decision 3).
4. **Account deletion.** `getting-started/accounts-and-sign-in.md:38` says deletion removes your "wishlists and personal categories". Users have no way to create either.
5. **Public collections.** `your-library/collections.md:25` and the marketing copy (`marketing.features.g1i2Body`) offer public collections. The backend supports listing another member's public ones (`library/getUserCollections.ts:42-48`), but web only lists your own (`routes/_dashboard/collections/index.tsx:97`, `components/ui/collection-dropdown.tsx:45`). A public collection can only be reached by direct URL (`library/getCollectionById.ts:21-24`).
6. **Public pages list.** `accounts-and-sign-in.md:28` leaves out the public catalogue, docs and member profiles (`routes/_public/catalog/`, `routes/_public/docs/`, `routes/members.$handle.tsx`).
7. **Privacy policy on portability.** The policy (`locales/en.json` → `privacy.yourRights`) says you can download your data via the Insights export. The export is partial (§2 #5).
8. **Terms on suspension.** The Terms say accounts may be suspended. There is no tool for it (§2 #26).
9. **Disputes.** Trades can display a "disputed" status (`trades.tsx:76`), but users can't put a trade into that state. The docs lifecycle (`sharing-and-exchanges/lend-swap-trade.md:87-98`) doesn't mention disputes, while the spec requires them.

### Spec vs implementation

1. **Ownership transfer.** The spec says a new copy is created for the new owner (`spec/features/puzzle-exchange.md:75`, `spec/README.md:50`, `spec/platform-specification.md:146`, `spec/architecture/01-bounded-contexts.md` "creates a new Copy"). The code moves the same copy to the new owner (`library/transferOnSettlement.ts:1-4`). The promise users care about, that solve history stays with you, still holds.
2. **Visibility model.** The spec describes 6 levels (`spec/README.md:36-43`, `spec/platform-specification.md:46`). Elsewhere it lists 5 (`spec/features/personal-library.md:40`, `spec/README.md:106,135`), so the spec contradicts itself. The code has private/visible, availability flags, circle shares, household permission and mutual-follow library access (`schema.ts`, `ownedPuzzles.visibility`/`availability`).
3. **Tech stack.**
   - `spec/features/technical-requirements.md:58,63,71,80` and `README.md:3,52,58,190` still say Next.js 15, next-intl, a REST API and Turbopack.
   - The code uses TanStack Start, Vite and use-intl (`apps/web/package.json`).
   - `technical-requirements.md:76-78` was updated to Turborepo/oxlint, so that file is now internally inconsistent.
   - `04-migration-roadmap.md:22-23` still says Nx and ESLint.
   - `appendix-current-state.md` is a snapshot dated 2026-06-08.
4. **Spec freshness.**
   - All 364 acceptance criteria in `spec/` are still unchecked; none is marked done.
   - `spec/` was last touched 2026-10-17 (#104).
   - Households, What's new, onboarding, presence and reports/moderation are not in `spec/` at all.
   - `01-bounded-contexts.md:218` still says Conversation is "today scoped to an exchange".

### Design-spec status lines vs implementation (stale)

These specs say "draft" or "no code", but the feature has shipped:

- `2026-10-17-network-card-redesign-design.md:3` ("No code has changed yet") → shipped in `docs/whats-new/2026-10-17-network-card-redesign.en.md`
- `2026-10-17-households-design.md:3` → shipped in `2026-10-17-households`
- `2026-10-17-quick-start-design.md:3` → shipped in `2026-10-18-quick-start`
- `2026-10-17-whats-new-design.md:3` → shipped as `routes/_dashboard/whats-new.tsx`
- `2026-10-18-messaging-attachments-safety-design.md:3` ("no code") → shipped in `2026-10-18-blocking-reporting` and `-messages-improvements`
- `2026-10-19-message-rich-text-design.md:3` → shipped in `2026-10-19-messages-improvements-2026-10-19`
- `2026-10-20-chat-photo-immediate-delivery.md:3` → shipped in `2026-10-20-chat-photos-right-away`
- `2026-06-16-docs-ui-design.md` ("awaiting plan") → shipped as `routes/_public/docs`
- The three `2026-07-02-*` specs ("pre-implementation") → shipped

These say "not built", but it now exists:

- `2026-10-19-household-redesign.md:111` (request to join) → built: `household/requestToJoinHousehold.ts`
- `2026-10-18-group-threads-presence-design.md:667` (circle deletion) → built: `sharing/deleteCircle.ts`

### Dead code (noted only, not changed)

- `apps/web/src/components/details/{puzzle-detail,collection-detail}/` is not imported anywhere. That includes `custody-timeline.tsx` and `loan-history.tsx`.
- Unused gateway keys: `catalog.listMyFavorites`, `exchange.byId`, `exchange.dispute`, `exchange.stats`, `insights.recommendations`, `admin.listImageReviewRequests`, `admin.decideImageReview`, `social.isFollowing`, `library.addImage`, `adminCatalog.listActive`, `adminCatalog.byId`.
- Unused locale keys `home.comingSoon.*` and `features.detailed.*`. They still list friend circles as "coming soon".
- The `puzzle_favorited` notification type has no emitter (`notifications/subscriber.ts` has no case for it).

---

## 5. Recent velocity and neglected areas

**The burst.**

- Commits: 227 since 2026-10-01, all from Oct 17 to 21 (46, 98, 39, 20 and 24 per day).
- Before that, nothing since 2026-07-14.
- Nothing since 2026-10-21 (8 quiet days up to today, 2026-10-29).

**What's new: 42 English entries, all published Oct 17–21.** By category: 16 feature, 22 improvement, 4 fix. By area (my grouping):

| Area                                                                                                                                                       | Entries        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Messaging                                                                                                                                                  | 9              |
| Onboarding, growth and app shell (quick start, email invites, invite-link confirmation, install, guides, tours, empty hints, new-version prompt, tab bars) | 9              |
| Trust, safety and privacy (blocking/reporting, photo screening, 2× privacy fixes, photo metadata, box-art check, deleted members, trade identity)          | 8              |
| Social and profiles                                                                                                                                        | 6              |
| Circles                                                                                                                                                    | 4              |
| Households                                                                                                                                                 | 3              |
| Solving and reviews (in-progress solves, two-level reviews)                                                                                                | 2              |
| Library                                                                                                                                                    | 1 (photo zoom) |

The solving and reviews entries come from July specs and were published on the day What's new launched, so they look like catch-up announcements _(inference)_.

**October commits by backend area.**

| Area            | Oct commits |
| --------------- | ----------- |
| `conversation/` | 47          |
| `sharing/`      | 19          |
| `catalog/`      | 14          |
| `exchange/`     | 12          |
| `household/`    | 12          |
| `insights/`     | 7           |
| `reputation/`   | 2           |
| `custody/`      | 2           |

By subject keyword: messaging about 42 and safety/privacy/photos about 49.

**Neglected areas.** None of these had a What's new entry in October, and each had at most incidental commits:

- **Insights and analytics.** October touches were tours and block gates only; nothing on recommendations, trends, community stats or export completeness.
- **Goals and collections.** Only the empty-state hints (#366).
- **Reputation.** 2 commits, both privacy gates.
- **Exchange lifecycle.** All 12 October exchange commits were reachability, privacy or permission gates (#144, #158, #168, #374, #375, #379). Nothing on disputes, loan due dates, counter-offers, multi-swaps or seller pricing.
- **Condition tracking, wishlist, personal categories.** No UI since roadmap phases 2/3.
- **Admin tooling for new safety flows.** The photo-review queue (§4.1).

_(opinion)_ October built out the "community you trust" pillar: messaging, safety, circles and households. The core swap/lend loop has not gained features since it was specified. The cheapest high-value fixes are §2 #2, #4, #6, #8 (due date only), #9 and #29, all size S. After that come the trust items #1, #3 and #5.
