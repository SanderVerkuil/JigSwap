# JigSwap review 2026-10-29 — Chapter 2: Security

Commit reviewed: `6b04171e55` (main tip). All paths below are relative to the repository root. `packages/backend/convex/` is abbreviated as `convex/`, and `packages/domain/src/` as `domain/`.

---

## 1. Summary

The core authorization model holds up. Every public Convex function the review read takes the acting member from Clerk through `requireMember`, admin gates read the JWT claim and fail closed, and the image pipeline never approves when a step fails. Most of the June audit and privacy work is still intact. The serious problems are elsewhere.

- **Storage ids are trusted as capabilities.** The copy-photo and completion-photo paths accept any `_storage` id, so any member can permanently delete every box-art image in the catalog with a short script (SEC-01).
- **Exchange settlement trusts state from proposal time.** A stale accepted exchange can move a copy out of the library of its current owner, who is not a party to that exchange (SEC-02).
- **Abuse controls are missing across the board.** About a dozen write paths have no rate limit, almost no free-text field has a length cap, and many reads `.collect()` without a bound. A single free account can run up provider costs, starve the shared moderation pool, or make shared views (inboxes, activity feed, Browse, admin queues) fail to load.
- **Privacy leaks sit at the edges.** They appear wherever code calls `toMemberView` or spreads a raw row instead of going through `projectMemberIdentity`.
- **The CSAM hash check is effectively inert today.** Normal uploads cannot match, and the provider is most likely `none` (SEC-03).

### Severity counts

137 surviving candidates from 14 review passes collapse into **95 findings** after merging duplicates. No candidates were left unverified, and none was fully refuted (see section 7 for corrected sub-claims). Severities are the verifier's calibrated values.

| Severity  | Confirmed | Plausible |  Total |
| --------- | --------: | --------: | -----: |
| Critical  |         0 |         0 |      0 |
| High      |         2 |         0 |      2 |
| Medium    |        28 |         0 |     28 |
| Low       |        42 |         5 |     47 |
| Info      |        15 |         3 |     18 |
| **Total** |    **87** |     **8** | **95** |

### Fix these first

1. **SEC-01 (high): stop treating storage ids as capabilities.** Give `addCopyPhoto`, `addCopyImage` and `attachCompletionPhotos` the claim rule box art already uses: the blob must be fresh, unreferenced and not preserved. Also stop returning raw `_storage` ids: copy `snapshot.thumbnail`, exchange `toPuzzleView.image`, and proposal `baseline`/`current.image`. Today one member can wipe all catalog box art, and nothing can undo it.
2. **SEC-02 (high): re-check ownership at settlement.** Refuse to settle unless the recipient still owns the requested copy (and the initiator still owns or co-manages the offered one). When a copy changes hands, cancel every other open exchange on it.
3. **SEC-03 + SEC-04 (medium, safety-critical): make the CSAM control real, or say plainly that it is off.** Hash the original file before the browser re-encodes it. Keep hashes when the provider is `none` so they can be re-checked later. Fix HCS egress. Never serve a quarantined blob from `admin/getReport`, and never copy one into report evidence.
4. **One abuse-control pass (SEC-14, SEC-16, SEC-19 to SEC-30).** Add `RATE_LIMITS` buckets for upload URLs, photo attaches, box-art checks, URL import, follow and follow-request toggles, exchange proposals, household invites, catalog submissions and proposals, comments and reviews. Add a deployment-wide budget for the anonymous contact and doc-feedback forms. Cap every free-text field in the domain value objects. Validate push endpoints. Throttle DM email per thread. Most of the medium findings close with this one series of PRs.
5. **One privacy-projection pass (SEC-08, SEC-10 to SEC-13).** Route every member shown to someone else through `projectMemberIdentity` or an identity-only shape. Drop raw `exchangeId`/`revieweeId` from `listReviewsForMember`. Drop the `memberId` argument from `listFollowers`/`listFollowees`. Stop revealing the owner's verified email after a one-line reply.

---

## 2. Threat model and method

### Threat model

- **Anyone can become a member.** Sign-up is public through Clerk, so an attacker can create several accounts in minutes. With a session JWT they can script any public Convex function directly against the deployment URL. The review assumes an attacker controls several such accounts.
- **Convex functions are the security boundary.** Every public query, mutation and action can be called directly. Web route guards (`apps/web/src/lib/require-admin.ts`, `require-auth.ts`) are cosmetic.
- **Anonymous callers are in scope.** Some functions take no identity at all: contact form, doc feedback, public catalog reads, `getPublicProfile`, global stats, invite landing.
- **Assets:** members' personal data (verified email, real name, location, the private-profile choice, DMs, photos), shared catalog content, moderation and CSAM controls, the operator's bill and quotas (Convex storage and bandwidth, Sightengine, Firecrawl, MapTiler, AhaSend, Clerk invites), and the prod deploy key.
- **Out of scope:** compromise of Clerk, Convex or Vercel, and operators with dashboard access.

### Method

- **11 review slices:** IDENT (identity, webhook, invites, contact), CONV (messaging), LIB (library and copies), SOC (social graph, profiles, reputation), CAT (catalog, URL import, docs), NOTIF (notifications, email, push), SHARE (circles, households, exchanges), ADMIN (admin, reports, CSAM pipeline), SURF (systematic sweep of all 304 public functions), WEB (web app, headers, CI, dependencies) and PRIV (data lifecycle and GDPR).
- **Critic gap round:** three extra passes on areas the slices underexplored. GAP1 covered image decoding and formats, GAP2 storage lifecycle, GAP3 activity-feed abuse.
- **Adversarial verification:** each candidate went to a separate verifier. The verifier re-read the code at this commit, looked for compensating controls, re-calibrated the severity, and where possible proved the issue with a `convex-test` repro run in an isolated worktree or `/tmp` copy. Repro files were deleted afterwards, and the review worktree was not modified. Verification methods were `repro-test`, `code-trace`, `config-check` and `live-read-only-check`.
- **Live checks were read-only:** GETs of public pages on https://jigswap.site (headers, `/privacy`, `/sw.js`, `/ingest/*` CORS), `pnpm audit --prod`, and read-only `gh api` reads of repository settings. No mutation or action was called against any deployment, and no account was created.
- **Limits of `convex-test`:** it does not enforce Convex's per-function read and call limits, model reactive subscriptions, or enforce the 512 MiB Node-action memory limit. Claims that something "breaks at scale" rest on Convex's documented limits (1 MiB per document, about 16 MiB read per function, a few thousand `db` calls per function, 512 MiB Node actions) and are marked as inferred where they were not executed.
- **Line references:** the author of this chapter spot-checked them against the files. Where a verifier quoted line numbers past the end of a file, the in-range candidate reference is used instead (details in section 7).

---

## 3. Findings table

Ordered by severity, then confidence. "Merged from" lists the source candidate IDs (slice-number).

| ID     | Title                                                                                                                   | Severity | Status    | Area                    | Primary file                                                         | Merged from                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | -------- | --------- | ----------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| SEC-01 | Any member can permanently delete catalog box art (or any blob whose id they know) through the photo-attach paths       | High     | Confirmed | Library / storage       | `convex/library/addCopyPhoto.ts:41-46`                               | LIB-1, ADMIN-1, SURF-1, GAP2-5, GAP1-3 (note) |
| SEC-02 | Settlement never re-checks ownership: a stale accepted exchange moves a copy out of a non-party's library               | High     | Confirmed | Exchange                | `domain/library/domain/copy.ts:163`                                  | SHARE-1                                       |
| SEC-03 | CSAM hash matching cannot catch known material (browser re-encode, noop provider, no retroactive check)                 | Medium   | Confirmed | Moderation              | `convex/lib/imageModeration/csamHashCheck.ts:86-93`                  | ADMIN-2, SURF-11                              |
| SEC-04 | Admin report screen can serve quarantined (CSAM-matched) bytes                                                          | Medium   | Confirmed | Moderation              | `convex/admin/getReport.ts:28`                                       | ADMIN-3                                       |
| SEC-05 | A submitter can rewrite their approved, public definition and hijack another puzzle's barcode                           | Medium   | Confirmed | Catalog                 | `convex/catalog/updatePuzzleDefinition.ts:72-75`                     | CAT-1                                         |
| SEC-06 | `addCopyImage` records the copy owner as uploader, so CSAM escalations name the wrong person                            | Medium   | Confirmed | Library                 | `convex/library/adapters/convexCopyRepository.ts:83-84`              | LIB-5                                         |
| SEC-07 | A pre-claimed slug takes over a later member's username handle, including their id/QR links                             | Medium   | Confirmed | Identity                | `convex/identity/resolveMemberByHandle.ts:20-34`                     | SOC-4, IDENT-5                                |
| SEC-08 | Owner's verified email is revealed to any trade requester after a one-line reply, and stays visible after a decline     | Medium   | Confirmed | Exchange / privacy      | `convex/exchange/getTradePartner.ts:50-69`                           | PRIV-1                                        |
| SEC-09 | Exchange-party access to private copies (rule P) survives ownership changes                                             | Medium   | Confirmed | Library                 | `convex/library/canViewCopy.ts:36-58`                                | SHARE-3                                       |
| SEC-10 | The household invite flow reveals the account name behind a private member's pseudonym                                  | Medium   | Confirmed | Household               | `convex/household/getMyHousehold.ts:20-33`                           | SHARE-4                                       |
| SEC-11 | Raw `toMemberView` in review, comment, follow-request and loan views leaks private members' bio, location and language  | Medium   | Confirmed | Social / library        | `convex/social/listPuzzleReviews.ts:40-44`                           | SOC-3, SURF-2, LIB-9                          |
| SEC-12 | `listReviewsForMember` returns the raw `exchangeId`, which de-anonymises reviewers; it has no visibility or block gate  | Medium   | Confirmed | Reputation              | `convex/reputation/listReviewsForMember.ts:24-34`                    | SOC-1, SURF-10                                |
| SEC-13 | `listFollowers`/`listFollowees` of a public member list private members by id and name                                  | Medium   | Confirmed | Social                  | `convex/social/listFollowers.ts:34-44`                               | SOC-2                                         |
| SEC-14 | Profile display name is unbounded and unsanitized; it becomes the From name and subject of jigswap.site email           | Medium   | Confirmed | Notifications / social  | `packages/email/src/render.tsx:108-116`                              | NOTIF-3, SOC-6                                |
| SEC-15 | DNS rebinding past the URL-import SSRF guard, with HTML read-back                                                       | Medium   | Confirmed | Catalog                 | `convex/catalog/adapters/assertPublicUrl.ts:10-21`                   | CAT-2                                         |
| SEC-16 | Push subscriptions accept any endpoint, with no cap and no send timeout                                                 | Medium   | Confirmed | Notifications           | `convex/notifications/pushSubscriptions.ts:19-46`                    | NOTIF-1, SURF-4                               |
| SEC-17 | PNG decompression-bomb guard bypassed by a duplicate IHDR or an interlaced IDAT                                         | Medium   | Confirmed | Image pipeline          | `convex/lib/imageModeration/guards.ts:122-127`                       | GAP1-1                                        |
| SEC-18 | The 25 MP limit decodes past the 512 MiB action limit; a crash blob can be reattached without limit to stall moderation | Medium   | Confirmed | Image pipeline          | `convex/lib/imageModeration/guards.ts:26`                            | GAP1-3                                        |
| SEC-19 | Copy, completion and box-art photo paths are unthrottled: paid classifier spend and moderation-pool starvation          | Medium   | Confirmed | Library / catalog       | `convex/library/addCopyPhoto.ts:68`                                  | LIB-2, CAT-4, ADMIN-4, SURF-6                 |
| SEC-20 | Unlimited shared upload URLs and no storage garbage collection: unclaimed blobs are billed forever                      | Medium   | Confirmed | Storage                 | `convex/puzzles.ts:6-15`                                             | GAP2-1, GAP2-2, GAP2-3, CONV-4                |
| SEC-21 | `extractFromUrl` has no rate limit, so any member can drain Firecrawl credits                                           | Medium   | Confirmed | Catalog                 | `convex/catalog/extractFromUrl.ts:45-52`                             | CAT-3                                         |
| SEC-22 | Anonymous contact and doc-feedback writes: no throttle, unbounded `locale`, admin inbox collects the whole table        | Medium   | Confirmed | Contact / docs          | `convex/contact/submitContactMessage.ts:28`                          | IDENT-2, CAT-6, ADMIN-5, SURF-5, PRIV-2       |
| SEC-23 | Follow and follow-request loops flood a target with notifications and email; no rate limit                              | Medium   | Confirmed | Social / notifications  | `domain/social/application/use-cases/cancel-follow-request.ts:33-37` | SOC-5, NOTIF-2                                |
| SEC-24 | A propose/cancel loop floods a victim's inbox for good; inbox reads are unbounded                                       | Medium   | Confirmed | Conversation / exchange | `convex/conversation/getMyInbox.ts:393-396`                          | CONV-1, SHARE-5                               |
| SEC-25 | DM and exchange message emails are sent one per message, with no per-recipient throttle                                 | Medium   | Confirmed | Notifications           | `convex/notifications/subscriber.ts:380-392`                         | CONV-2                                        |
| SEC-26 | Catalog submissions and proposals: no limit, no size caps, every admin notified; admin queue unbounded                  | Medium   | Confirmed | Catalog                 | `convex/catalog/listPendingPuzzleDefinitions.ts:15-19`               | CAT-5, ADMIN-9                                |
| SEC-27 | `users.updateUserProfile` bypasses the 80-character location cap; bio, location and language are unbounded              | Medium   | Confirmed | Identity                | `convex/users.ts:110-123`                                            | IDENT-1, SURF-3                               |
| SEC-28 | Photo comments and puzzle reviews: no caps, no rate limit, unbounded reads, no delete or report path                    | Medium   | Confirmed | Library / social        | `domain/social/domain/comment-text.ts:10-16`                         | LIB-6, SOC-13, SURF-3                         |
| SEC-29 | Browse reads the oldest 500 open copies, so one member can freeze it; definition pages scan without a bound             | Medium   | Confirmed | Library                 | `convex/library/browseOwnedPuzzles.ts:79-94`                         | LIB-3                                         |
| SEC-30 | One free account can wipe every member's activity feed (global newest-500 window) and multiply read cost                | Medium   | Confirmed | Social / feed           | `convex/social/getActivityFeed.ts:97-107`                            | GAP3-1, GAP3-2                                |
| SEC-31 | Household invites never expire and still work after the inviter leaves or a removal                                     | Low      | Confirmed | Household               | `domain/household/domain/household-invite.ts:126`                    | SHARE-2                                       |
| SEC-32 | Clerk webhook ignores event order: a late `user.updated` brings back a deleted member's PII                             | Low      | Confirmed | Identity                | `convex/users.ts:149-191`                                            | IDENT-3, PRIV-12                              |
| SEC-33 | Email invites: any new account can send branded mail; the global budget drains silently                                 | Low      | Confirmed | Invitations             | `convex/invitations/emailInviteStore.ts:36-60`                       | IDENT-4                                       |
| SEC-34 | Non-approved definitions are served through library reads and favorites                                                 | Low      | Confirmed | Library / catalog       | `convex/library/getPuzzleDefinitionView.ts:36-37`                    | LIB-4, CAT-9, SURF-12                         |
| SEC-35 | Copy timeline shows in-progress solves to any copy viewer                                                               | Low      | Confirmed | Library                 | `convex/library/getCopyInstanceView.ts:159-169`                      | LIB-7                                         |
| SEC-36 | A lent-out copy can be re-offered, lent again or transferred while its loan is open                                     | Low      | Confirmed | Library                 | `convex/library/adapters/convexCopyReservationPort.ts:8`             | LIB-8                                         |
| SEC-37 | `getUserCollections includePublic` dumps every public collection; collection reads ignore blocks                        | Low      | Confirmed | Library                 | `convex/library/getUserCollections.ts:45-61`                         | LIB-10, SURF-9                                |
| SEC-38 | After a transfer, the previous owner cannot delete photos they uploaded                                                 | Low      | Confirmed | Library                 | `convex/library/removeCopyPhoto.ts:23`                               | LIB-11                                        |
| SEC-39 | Cancel then re-request reveals whether a follow request was silently declined                                           | Low      | Confirmed | Social                  | `domain/social/application/use-cases/cancel-follow-request.ts:33-37` | SOC-7                                         |
| SEC-40 | Blocking a member works as a de-anonymisation oracle                                                                    | Low      | Confirmed | Social                  | `convex/social/privacy.ts:303-311`                                   | SOC-8                                         |
| SEC-41 | `followersYouKnow` lets a one-way follower probe a private member's following list                                      | Low      | Confirmed | Social                  | `convex/social/knownFollowers.ts:58-61`                              | SOC-9                                         |
| SEC-42 | Network invite tokens never expire, are multi-use, and force a mutual follow                                            | Low      | Confirmed | Social                  | `convex/social/acceptQrFollow.ts:20-34`                              | SOC-10                                        |
| SEC-43 | Activity feed shows a private member's completions and trades to one-way followers                                      | Low      | Confirmed | Social                  | `convex/social/getActivityFeed.ts:428-474`                           | SOC-11                                        |
| SEC-44 | Logged-out, indexable profile treats a missing profile row as public                                                    | Low      | Confirmed | Social                  | `convex/social/privacy.ts:44`                                        | SOC-12                                        |
| SEC-45 | A third party's invite can seat a member in a circle with someone they blocked                                          | Low      | Confirmed | Sharing                 | `domain/sharing/application/use-cases/accept-circle-invite.ts:31`    | SHARE-6                                       |
| SEC-46 | A handful of accounts can exhaust the global MapTiler budget                                                            | Low      | Confirmed | Conversation            | `convex/lib/rateLimits.ts:27-30`                                     | CONV-5                                        |
| SEC-47 | PostHog autocapture records links clicked inside DMs                                                                    | Low      | Confirmed | Web                     | `apps/web/src/lib/analytics-client.ts:22-28`                         | CONV-6                                        |
| SEC-48 | Per-thread attachment scans grow with the member's whole photo history                                                  | Low      | Confirmed | Conversation            | `convex/conversation/listMyPendingAttachments.ts:20-36`              | CONV-9                                        |
| SEC-49 | Unclamped client-supplied limits and unauthenticated full-table scans                                                   | Low      | Confirmed | Surface                 | `convex/catalog/getRecentPuzzles.ts:12-17`                           | CONV-3, CAT-10, SURF-7, SHARE-8, GAP3-4       |
| SEC-50 | `isPrivateIp` misses NAT64, 6to4, multicast and other non-public ranges                                                 | Low      | Confirmed | Catalog                 | `domain/catalog/domain/is-private-ip.ts:5-41`                        | CAT-7                                         |
| SEC-51 | Response bodies are fully buffered before the size cap applies                                                          | Low      | Confirmed | Catalog                 | `convex/catalog/adapters/browserStorePageFetcher.ts:171-178`         | CAT-8                                         |
| SEC-52 | Pending and rejected submissions hold their barcode forever                                                             | Low      | Confirmed | Catalog                 | `convex/catalog/findPuzzleByBarcode.ts:9-28`                         | CAT-11                                        |
| SEC-53 | Hand-rolled identity lookups skip `requireMember`'s refusal of deactivated accounts                                     | Low      | Confirmed | Identity                | `convex/exchange/getUserExchanges.ts:30-36`                          | SURF-8, CAT-12                                |
| SEC-54 | Push subscriptions survive sign-out on shared browsers                                                                  | Low      | Confirmed | Notifications           | `apps/web/src/components/dashboard-layout/shell-user-button.tsx:193` | NOTIF-4                                       |
| SEC-55 | Refused and quarantined rows never leave the hash-pending index, which blinds the admin indicator                       | Low      | Confirmed | Moderation              | `convex/lib/imageModeration/pipeline.ts:613`                         | ADMIN-6                                       |
| SEC-56 | Some admin actions leave no audit-trail entry                                                                           | Low      | Confirmed | Admin                   | `convex/admin/recheckPhoto.ts`                                       | ADMIN-7                                       |
| SEC-57 | Audit-log labels keep members' names and emails after account deletion                                                  | Low      | Confirmed | Admin / privacy         | `convex/admin/decideReport.ts:108-114`                               | ADMIN-10, PRIV-8                              |
| SEC-58 | No CSP, frame-ancestors, nosniff or Permissions-Policy; HSTS without includeSubDomains                                  | Low      | Confirmed | Web                     | `apps/web/vercel.json:1`                                             | WEB-1                                         |
| SEC-59 | PostHog gets email and query-string tokens; no reset, erasure or consent withdrawal                                     | Low      | Confirmed | Web / privacy           | `apps/web/src/components/analytics-page-view.tsx:36-39`              | WEB-3, PRIV-5, PRIV-6                         |
| SEC-60 | Prod Convex deploy (`workflow_run`) does not check that the trigger was a push to this repo                             | Low      | Confirmed | CI                      | `.github/workflows/convex-deploy.yml:124-126`                        | WEB-4                                         |
| SEC-61 | Secret-bearing CI jobs use mutable action tags and an `npx`-fetched CLI                                                 | Low      | Confirmed | CI                      | `.github/workflows/convex-deploy.yml:157`                            | WEB-5                                         |
| SEC-62 | Convex JWT in HTML and a GET server fn served `public`; no CSRF middleware; no `authorizedParties`                      | Low      | Confirmed | Web                     | `apps/web/src/routes/__root.tsx:30-34`                               | WEB-6                                         |
| SEC-63 | `pnpm audit --prod`: stale security overrides, vulnerable seroval (not reachable today)                                 | Low      | Confirmed | Supply chain            | `pnpm-workspace.yaml:49`                                             | WEB-7                                         |
| SEC-64 | AhaSend and Firecrawl are not named as processors; DM previews go to email and push with no opt-out                     | Low      | Confirmed | Privacy                 | `apps/web/locales/en.json:1462`                                      | PRIV-3, NOTIF-6                               |
| SEC-65 | Google Fonts loads on every page before consent                                                                         | Low      | Confirmed | Privacy                 | `apps/web/src/routes/__root.tsx:101-111`                             | PRIV-4                                        |
| SEC-66 | "Download your data" export leaves out messages, photos, profile and social graph                                       | Low      | Confirmed | Privacy                 | `convex/insights/exportUserData.ts:39-149`                           | PRIV-7, SURF-12                               |
| SEC-67 | Stated retention for photos stuck in checking or auto-rejected is not implemented                                       | Low      | Confirmed | Privacy                 | `convex/conversation/messageAttachments.ts:383-431`                  | PRIV-9                                        |
| SEC-68 | Other members' notification rows keep a deleted member's `actorName`                                                    | Low      | Confirmed | Privacy                 | `convex/notifications/subscriber.ts:131-145`                         | PRIV-10                                       |
| SEC-69 | Completions on copies now owned by others keep the deleted member's private notes                                       | Low      | Confirmed | Privacy                 | `convex/conversation/purgeMemberLibrary.ts:319-345`                  | PRIV-11                                       |
| SEC-70 | Content erasure gaps: DMs between two deleted members kept; no author delete for comments and reviews                   | Low      | Confirmed | Privacy                 | `convex/conversation/purgeMemberMessagingData.ts:357-378`            | PRIV-13                                       |
| SEC-71 | `domainEvents` has no retention; flood rows and superseded free text are kept forever                                   | Low      | Confirmed | Privacy / DoS           | `convex/conversation/purgeMemberEvents.ts:139-153`                   | PRIV-15, GAP3-3                               |
| SEC-72 | WebP walker never looks inside ANMF; nested EXIF and payloads survive the strip                                         | Low      | Confirmed | Image pipeline          | `convex/lib/imageModeration/stripMetadata.ts:270-297`                | GAP1-5                                        |
| SEC-73 | `isAdmin` also accepts a flat `role` claim; the Clerk JWT template is not in the repo                                   | Low      | Plausible | Identity                | `convex/identity/isAdmin.ts:14-19`                                   | ADMIN-8, IDENT-6                              |
| SEC-74 | PostHog `/ingest` rewrite likely forwards Clerk cookies; reflects credentialed CORS                                     | Low      | Plausible | Web                     | `apps/web/vite.config.ts:49`                                         | WEB-2                                         |
| SEC-75 | Email error path logs the raw AhaSend response body, which may include recipient addresses                              | Low      | Plausible | Notifications           | `convex/notifications/adapters/ahasendEmailSender.ts:54-57`          | PRIV-14                                       |
| SEC-76 | Animated WebP reaches storage and the classifier unflattened                                                            | Low      | Plausible | Image pipeline          | `convex/lib/imageModeration/pipeline.ts:546-550`                     | GAP1-2, GAP1-4                                |
| SEC-77 | Cached WASM WebP decoder keeps its high-water heap for the life of the instance                                         | Low      | Plausible | Image pipeline          | `convex/lib/imageModeration/normaliseImage.ts:36-52`                 | GAP1-6                                        |
| SEC-78 | Contact email goes unescaped into an admin `mailto:` link                                                               | Info     | Confirmed | Contact                 | `apps/web/src/routes/_dashboard/admin/contact.tsx:80`                | IDENT-7                                       |
| SEC-79 | Posting to a DM whose partner was deleted recreates notification rows for the purged id                                 | Info     | Confirmed | Conversation            | `convex/notifications/subscriber.ts:361-368`                         | CONV-7                                        |
| SEC-80 | `canMessage`/`openDmThread` pair-thread clause is a yes/no oracle                                                       | Info     | Confirmed | Conversation            | `convex/conversation/adapters/connectionPolicy.ts:36-42`             | CONV-10                                       |
| SEC-81 | `deleteCopy` leaves image blobs in storage                                                                              | Info     | Confirmed | Library                 | `convex/library/adapters/convexCopyRepository.ts:118-121`            | LIB-12                                        |
| SEC-82 | Anyone can inflate the invite landing counter                                                                           | Info     | Confirmed | Social                  | `convex/social/recordInviteLanding.ts:14`                            | SOC-14                                        |
| SEC-83 | Email CTA root-relative check allows `/\host` (not reachable today)                                                     | Info     | Confirmed | Notifications           | `packages/email/src/render.tsx:56-59`                                | NOTIF-5                                       |
| SEC-84 | Notification emails have no List-Unsubscribe                                                                            | Info     | Confirmed | Notifications           | `convex/notifications/adapters/ahasendEmailSender.ts:24-52`          | NOTIF-7                                       |
| SEC-85 | `propose` reveals that a block exists (already learnable via the profile)                                               | Info     | Confirmed | Exchange                | `convex/exchange/propose.ts:56`                                      | SHARE-7                                       |
| SEC-86 | Circle Admin parity, plus a stale security comment                                                                      | Info     | Confirmed | Sharing                 | `domain/sharing/domain/circle.ts:160`                                | SHARE-9                                       |
| SEC-87 | Latent sink: chart config keys go into `<style>` unescaped                                                              | Info     | Confirmed | Web                     | `apps/web/src/components/ui/chart.tsx:83`                            | WEB-9                                         |
| SEC-88 | SSR renders authenticated member data in a US Vercel region                                                             | Info     | Confirmed | Privacy                 | `apps/web/vercel.json:1-9`                                           | PRIV-16                                       |
| SEC-89 | Retention relies only on per-row scheduled jobs; undecided reports never expire                                         | Info     | Confirmed | Privacy                 | `convex/reports/retention.ts:13-36`                                  | PRIV-17                                       |
| SEC-90 | Unauthenticated community-avatar query samples private members' initials                                                | Info     | Confirmed | Privacy                 | `convex/insights/getCommunityAvatars.ts:88-92`                       | PRIV-18, SURF-12                              |
| SEC-91 | Minor image-pipeline notes: WebP sent as `photo.jpg`, APNG refused, ICC copy only in backfill                           | Info     | Confirmed | Image pipeline          | `convex/library/adapters/photoModeration.ts:426`                     | GAP1-7                                        |
| SEC-92 | Precondition: a storage sweep built on today's `isReferenced` would delete live blobs                                   | Info     | Confirmed | Storage                 | `convex/lib/imageModeration/blobReferences.ts:12-51`                 | GAP2-4                                        |
| SEC-93 | Legacy `messages` table is not covered by the deletion purge                                                            | Info     | Plausible | Privacy                 | `convex/schema.ts:885-901`                                           | CONV-8                                        |
| SEC-94 | Preview backends get a full dev export, and preview URLs are posted publicly                                            | Info     | Plausible | CI / privacy            | `.github/workflows/convex-preview.yml:141`                           | WEB-8                                         |
| SEC-95 | Account-deletion coverage matrix (reference)                                                                            | Info     | Plausible | Privacy                 | `convex/conversation/purgeMemberMessagingData.ts:125-172`            | PRIV-19                                       |

---

## 4. Detailed findings

Detailed write-ups cover every high and medium finding. Low and info findings are in the hardening backlog (section 5). Condensed repros keep only the decisive calls. The seed helpers (`mkUser`, `acquire`, `flush`, `as(t, who)`) insert `users`/`puzzles`/`ownedPuzzles` rows the obvious way, as in the existing `*.test.ts` files.

### SEC-01 — Any member can permanently delete catalog box art (or any blob whose id they know) through the photo-attach paths

**Severity:** High · **Status:** Confirmed (repro in four independent slices) · **Area:** Library / solving / storage · **Merged from:** LIB-1, ADMIN-1, SURF-1, GAP2-5, GAP1-3 side note

**Description.** Message photos, circle icons and box art only accept a blob that was uploaded recently and that nothing else references (`isReferenced` plus a 15-minute claim window: `convex/conversation/stageMessageImage.ts:61-66`, `convex/sharing/setCircleIcon.ts:41-49`, `convex/catalog/boxArtModerationStore.ts:36-53`). The copy-photo and completion-photo paths skip that rule and accept any existing `_storage` id:

- `convex/library/addCopyPhoto.ts:41-46` only checks that the blob exists and is not CSAM-preserved.
- `convex/library/addCopyImage.ts:22` takes `fileId: v.string()`. The repository inserts it with no blob check (`convex/library/adapters/convexCopyRepository.ts:75-95`).
- `convex/solving/attachCompletionPhotos.ts:45-51` only checks `isPreservedBlob`.

After a foreign blob is attached to the attacker's own row, three paths delete it:

- `convex/library/removeCopyPhoto.ts:40-42`
- `convex/solving/deleteCompletion.ts:57-67`
- the moderation pipeline, which deletes the original after its re-encode swap (`convex/lib/imageModeration/pipeline.ts:673`) or on refusal (`pipeline.ts:483`). `deleteUnlessPreserved` (`pipeline.ts:391-405`) checks CSAM preservation only.

Box-art storage ids reach every member through three routes:

- A copy's `snapshot.thumbnail` is the puzzle's `image` id (`convex/library/adapters/convexCatalogSnapshotProvider.ts:42`). `toOwnedCopyView` passes it through unchanged (`convex/library/mappers.ts:86`) to `browseOwnedPuzzles`, `getOwnedPuzzlesByOwner`, `featuredShelf` and `getCollectionById`.
- Exchange views return `image: p.image` raw (`convex/exchange/readViews.ts:159`).
- `listMyChangeProposals` returns `...proposal` (`convex/catalog/proposalReadModel.ts:102-103`), whose `baseline.image` is the current box art, and also `current.image` (`proposalReadModel.ts:62-65`). Filing any image proposal therefore hands out the id.

None of these paths is rate-limited.

**Evidence.**

```ts
// convex/library/addCopyPhoto.ts:41-46 — the only blob checks
if (!(await ctx.db.system.get(args.fileId)) || (await isPreservedBlob(ctx, args.fileId))) { throw ... }
// convex/library/removeCopyPhoto.ts:42
await ctx.storage.delete(image.fileId);
// convex/lib/imageModeration/pipeline.ts:673
await deleteUnlessPreserved(row.fileId);
// convex/library/adapters/convexCatalogSnapshotProvider.ts:42
thumbnail: row.image as unknown as string | undefined,
// contrast — convex/conversation/stageMessageImage.ts:62
if (!blob || (await isReferenced(ctx, args.storageId))) ...
```

**Exploit scenario.**

1. Sign up and call `library.acquireCopy` for any approved puzzle P, or simply browse other members' copies.
2. Read `snapshot.thumbnail` from `getOwnedPuzzlesByOwner` (or `browseOwnedPuzzles`). That value is P's box-art `_storage` id.
3. Call `library.addCopyPhoto({copyId: ownCopy, fileId: thumbnail})`, then `removeCopyPhoto`. Alternatively, do nothing and let the pipeline delete the original after re-encoding it. Or use `attachCompletionPhotos` followed by `deleteCompletion`.

`puzzles.image` now points at a deleted blob. `boxArtUrl` returns null, so the image disappears from every copy, from the catalog and from the public SEO page. Repeat for each definition; one script covers the whole catalog. The deletion cannot be undone unless someone re-uploads the art.

**Recommendation.**

1. Add one claim helper (for example `claimFreshUpload(ctx, fileId)`) and call it from `addCopyPhoto`, `addCopyImage` and `attachCompletionPhotos`. It should require that the blob exists, that `_creationTime` falls inside a short window (reuse `BOX_ART_CLAIM_WINDOW_MS`), that `!isReferenced(ctx, id)`, and that `!isPreservedBlob(ctx, id)`. Change `addCopyImage`'s arg to `v.id("_storage")`, or retire `addCopyImage` (see SEC-06). Recording the uploader when the URL is minted (SEC-20) makes the claim provable.
2. Defense in depth: before deleting in `deleteUnlessPreserved`, `removeCopyPhoto` and `deleteCompletion`, skip any blob that `isReferenced` still reports. After a legitimate re-encode swap the original is no longer referenced, so normal cleanup is unaffected.
3. Stop returning raw storage ids. Drop `snapshot.thumbnail` from `toOwnedCopyView`, or resolve it through `boxArtUrl`. Map `toPuzzleView.image` through `boxArtUrl` in `exchange/readViews.ts`. Strip or resolve `image` in `enrichProposal`'s `baseline`, `changes` and `current`.
4. Regression tests: attaching an already-referenced blob is refused on all three paths, and `listMyChangeProposals` returns no `_storage` ids.
5. Run a one-off internal query for puzzles whose `image` no longer resolves (`ctx.db.system.get(image) === null`) to learn whether this has already happened in production.

**Verification.** Repro tests in LIB-1, ADMIN-1, SURF-1 and GAP2-5. All four routes to the id (copy snapshot, browse, change proposal) and all three deletion paths (`removeCopyPhoto`, `deleteCompletion`, pipeline after attach) were proven. The GAP1 repro also showed the pipeline-only path on a real JPEG box art.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// seed: alice submitted approved puzzle P with image = boxArt (a stored blob); mallory is a plain member
const asMallory = t.withIdentity({ subject: "clerk_mallory" });
await asMallory.mutation(api.library.acquireCopy.acquireCopy, {
  puzzleDefinitionId: P.aggregateId,
  condition: "good",
});
const [copy] = await asMallory.query(
  api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
  { ownerId: mallory, includeUnavailable: true },
);
const leaked = copy.snapshot!.thumbnail as Id<"_storage">; // === boxArt
await asMallory.mutation(api.library.addCopyPhoto.addCopyPhoto, {
  copyId: copy._id,
  fileId: leaked,
});
const image = await t.run((ctx) =>
  ctx.db
    .query("ownedPuzzleImages")
    .withIndex("by_file", (q) => q.eq("fileId", leaked))
    .unique(),
);
await asMallory.mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
  imageId: image!._id,
});
expect(await t.run((ctx) => ctx.db.system.get(boxArt))).toBeNull(); // blob destroyed
expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBe(boxArt); // puzzle still points at it

// Variants that also passed:
//  - attachCompletionPhotos({ storageIds: [leaked] }) + deleteCompletion (SURF-1a, ADMIN-1 3b)
//  - addCopyPhoto alone, then settleDueScheduled(t): the pipeline deletes the original (LIB-1, ADMIN-1 3c, GAP2-5)
//  - id taken from browseOwnedPuzzles (SURF-1a) or listMyChangeProposals baseline/current.image (GAP2-5);
//    afterwards getPublicDefinitionView returns definition.image === undefined
```

</details>

---

### SEC-02 — Settlement never re-checks ownership: a stale accepted exchange moves a copy out of a non-party's library

**Severity:** High · **Status:** Confirmed (repro) · **Area:** Exchange / library · **Merged from:** SHARE-1

**Description.** Who owns the requested copy, and who may offer the offered copy, is checked only at proposal time (`domain/exchange/application/use-cases/propose-exchange.ts:78`, `:113-135`). Accept re-checks only the initiator's circle eligibility (`domain/exchange/application/use-cases/accept-exchange.ts:18-21`). `confirmCompletion` is a plain `runAction` (`convex/exchange/confirmCompletion.ts:8-12`). `settle()` emits `OwnershipTransferred(copyId, newOwner)` without an expected previous owner (`domain/exchange/domain/exchange.ts:234-269`). `Copy.transferTo` then overwrites `ownerId` without checking anything (`domain/library/domain/copy.ts:163-170`).

Nothing stops one copy from sitting in several accepted exchanges at once, and no subscriber cancels sibling exchanges after a transfer. Once a copy changes hands, any other exchange still accepted on it can settle and move it again.

The victim is badly placed:

- They cannot see the exchange (`getExchangeById` returns null for non-parties).
- They cannot cancel it (only the initiator can).
- They cannot delete the copy: `deleteCopy` refuses with `CopyReserved` (`domain/library/application/use-cases/delete-copy.ts:29`).

Photos and completion history carry over to the new owner (`copy.ts:160-162`). In the lend variant, a stale lend opens a loan in the new owner's name and makes the attacker the holder, and the holder rule of `canViewCopy` then opens even a private copy to them (`convex/library/canViewCopy.ts:117`).

**Evidence.**

```ts
// domain/library/domain/copy.ts:163-168 — no expected-owner check
transferTo(newOwner: OwnerId, now: Date) { const previousOwner = this.state.ownerId;
  this.state = { ...this.state, ownerId: newOwner, heldBy: newOwner, ... } }
// domain/exchange/domain/exchange.ts:151-167 — only status === "accepted" and party membership
// convex/exchange/confirmCompletion.ts:10-11
handler: (ctx, args) => runAction(ctx, args.exchangeId, makeConfirmCompletion),
```

**Exploit scenario.**

- _Copy theft:_ Bob lists copy Y. Bob's sockpuppet proposes a sale; Bob accepts; the sockpuppet confirms; the exchange is left open. Vic buys Y honestly and both confirm, so Y is Vic's. Bob, no longer the owner, now confirms the stale exchange. Y moves to the sockpuppet and leaves Vic's library, photos included.
- _Household variant:_ housemate Hugo, with the default `manage` permission, offers Mara's copy X in a swap to his accomplice Rex. Mara removes Hugo from the household. She cannot see the exchange, and `deleteCopy` refuses with `CopyReserved`. Rex accepts, both confirm, and X now belongs to Rex.

**Recommendation.**

1. Add an `ActionGuard` on `confirmCompletion` (or a check inside `settle` that reads the `CopyPort`). It should refuse, or cancel the exchange, unless the requested copy is still owned by `recipientId` and, for a swap, the offered copy is still owned by the initiator or co-managed by them.
2. Put `expectedPreviousOwner` into the `OwnershipTransferred` payload and make `Copy.transferTo` refuse when the current owner differs.
3. Treat accept as a reservation: refuse to accept while the requested or offered copy sits in another accepted exchange. On every transfer, decline or cancel all other proposed and accepted exchanges that reference the copy.
4. For co-managed offered copies, notify the real owner and give them a veto. Cancel such exchanges when the initiator leaves or is removed from the household, or when the copy's household permission drops to `view`.
5. Add regression tests for both scenarios, and consider an internal query over completed exchanges to check whether this has already happened in production.

**Verification.** Repro test with both scenarios, run through the real mutations and the async event dispatch. The verifier rated it high at the lower edge: the attacker needs earlier standing on that particular copy, so the damage is per copy, not platform-wide.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// seed: bob, sock, vic (public profiles), one approved puzzle; Y = acquire(t, "bob", ...) with availability forSale
const stale = await as(t, "sock").mutation(api.exchange.propose.propose, {
  type: "sale",
  requestedPuzzleId: y.id,
  salePrice: 1000,
});
await as(t, "bob").mutation(api.exchange.accept.accept, { exchangeId: stale });
await confirm(t, "sock", stale); // left open

const honest = await as(t, "vic").mutation(api.exchange.propose.propose, {
  type: "sale",
  requestedPuzzleId: y.id,
  salePrice: 1000,
});
await as(t, "bob").mutation(api.exchange.accept.accept, { exchangeId: honest });
await confirm(t, "vic", honest);
await confirm(t, "bob", honest);
await flush(t);
expect(await ownerOf(t, y.id)).toBe(ids.vic);

expect(
  await as(t, "vic").query(api.exchange.getExchangeById.getExchangeById, {
    exchangeId: staleDocId,
  }),
).toBeNull();
expect(
  await codeOf(
    as(t, "vic").mutation(api.library.deleteCopy.deleteCopy, {
      copyId: y.aggregateId,
    }),
  ),
).toBe("CopyReserved");

await confirm(t, "bob", stale);
await flush(t); // Bob no longer owns Y
expect(await ownerOf(t, y.id)).toBe(ids.sock); // taken out of Vic's library

// Second test: Hugo (household "manage") proposes a trade offering Mara's X for Rex's R;
// Mara removes Hugo, deleteCopy(X) -> CopyReserved; Rex accepts, both confirm -> ownerOf(X) === rex.
```

</details>

---

### SEC-03 — CSAM hash matching cannot catch known material

**Severity:** Medium (the slice rated it high; the verifier lowered it) · **Status:** Confirmed (code trace) · **Area:** Moderation · **Merged from:** ADMIN-2, SURF-11

**Description.** The pipeline sends exact MD5/SHA-1 hashes of the uploaded bytes and of its own re-encode (`convex/lib/imageModeration/pipeline.ts:592-594`). Lists of known material only match unmodified files.

**The web client re-encodes every photo before upload.** `preparePhoto` draws it on a canvas and saves a JPEG at quality 0.8 with the long edge at most 1600 px (`apps/web/src/lib/prepare-photo.ts:1-6`, `:109`). This covers message photos, copy photos, completion photos and box art. So in normal browsers the hashed bytes are never the original file and can never match. Only users whose canvas cannot be read back, or direct API uploads, keep the original bytes (`prepare-photo.ts:103`, `:111`).

**The hash service cannot be reached from Convex either.** HCS allow-lists caller IPs, Convex has no fixed egress IP, and the proxy is not implemented (`convex/lib/imageModeration/csamHashCheck.ts:20-24`). Provider `none` is the default and answers `no_match` (`csamHashCheck.ts:86-93`). A selected but incomplete config also falls back to that noop (`csamHashCheck.ts:237`). The pipeline opens the publication gate on `no_match` (`pipeline.ts:613`), and `applyHashCheckResult` stamps `hashCheckedAt` and drops the pending hashes (`convex/lib/imageModeration/quarantine.ts:171-178`). So photos published while the provider is `none` can never be checked retroactively once HCS is turned on.

The only content control left is the NSFW classifier, which the code itself says is not a CSAM control (`csamHashCheck.ts:6-8`). The production environment was not inspected, so "prod runs `none`" is likely but unproven.

**Evidence.**

```ts
// apps/web/src/lib/prepare-photo.ts:108-110
canvas.toBlob(resolve, "image/jpeg", QUALITY)
// convex/lib/imageModeration/pipeline.ts:592-594
const variants = encoded ? [hashImageBytes(bytes), hashImageBytes(encoded.bytes)] : [hashImageBytes(bytes)];
// convex/lib/imageModeration/csamHashCheck.ts:88-92
provider: "none", async check() { return { status: "no_match" }; },
```

**Exploit scenario.** A member uploads known abuse material through the normal UI. The browser re-encodes it, so the hashes differ from the list entries. Even with `CSAM_HASHCHECK_PROVIDER=offlimits` configured and reachable, the result is `no_match`, the gate opens, and the photo is published if the classifier scores it below its threshold. With provider `none` the row is also stamped `hashCheckedAt` and no hashes are kept, so it can never be re-checked. A deliberate attacker defeats any exact-hash list by flipping one byte anyway. The real loss is coverage of ordinary re-shares of known files, plus the lack of any retroactive check.

**Recommendation.**

1. Hash the original file bytes in the browser before `preparePhoto` re-encodes them, upload that hash alongside the photo, and check it on the server as well. It cannot be trusted against an attacker, but it restores coverage for well-meaning re-shares.
2. Add a perceptual hash (PDQ, or PhotoDNA through an approved provider) computed server-side on decoded pixels, which survives re-encoding.
3. While the provider is `none` or misconfigured, leave `hashCheckedAt` unset (or mark the row "not checked") and keep `pendingHashes`, so enabling HCS later triggers a retroactive check. Treat `missing_config` as `unavailable` (gate closed), not as `no_match` (SURF-11).
4. Fix egress (a fixed-IP relay) before presenting the hash check as an active control, and show its inactive state clearly in the admin UI.

**Verification.** Code trace only. A runtime repro would need a browser canvas and an external hash list, so it is not meaningful here. A grep found no perceptual or client-side hash anywhere in the codebase.

---

### SEC-04 — Admin report screen can serve quarantined (CSAM-matched) bytes

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Moderation / admin · **Merged from:** ADMIN-3

**Description.** Quarantine repoints a row's `fileId` at the preserved evidence blob (`convex/library/moderationStore.ts:141-146`, `convex/conversation/attachmentModerationStore.ts:133-138`). The policy says that blob is never shown to anyone, admins included (`convex/lib/imageModeration/quarantine.ts:17-20`). `getReport` gets this right for message attachments but not in two other places:

- (a) For a `photo` (copy photo) report it returns `ctx.storage.getUrl(image.fileId)` with no check of quarantine or the hash gate (`convex/admin/getReport.ts:25-29`). That is a permanent, unauthenticated URL to the preserved bytes.
- (b) For a `message` report on an image message that was quarantined after the report was filed, a `content_removed` decision does two things. `tombstoneMessage` overwrites `quarantined` with `removed` (`convex/admin/decideReport.ts:196-206`). Then `preserveEvidence`, whose `loadEvidenceSource` has no status check (`convex/reports/attachmentEvidence.ts:54-62`, `:93-97`), copies the preserved bytes into a new evidence blob, which `getReport` serves (`getReport.ts:58-60`). The admin console renders it unblurred (`apps/web/src/components/admin/moderation/report-detail.tsx:126-131`).

`fileReport` makes both paths reachable: a `photo` target only excludes pending and rejected rows (`convex/reports/fileReport.ts:190-199`).

**Exploit scenario.** With HCS live, a member sends an image message while its hash check is still pending. The recipient reports it. The check, or a later re-check, matches and the photo is quarantined. An admin opens the report, sees no image, and decides `content_removed` because of the caption. The status flips to `removed`, the matched bytes are copied into report evidence, and on reload the admin console shows them behind a non-expiring URL. The issue is latent until hash matching actually works (SEC-03), but it breaks the explicit policy and creates a second copy of the material.

**Recommendation.**

- In `getReport`, return no photo URL and no evidence URL when the target row is quarantined or its hash gate is closed. Reuse `isHashCleared` and the quarantine check from the attachment branch.
- In `tombstoneMessage`, never overwrite `quarantined`.
- In `loadEvidenceSource`/`preserveEvidence`, skip quarantined rows and any blob for which `isPreservedBlob` is true.
- In `fileReport`, limit `photo` targets to approved, hash-cleared rows.
- Add a test for each path.

**Verification.** Repro test covering both paths.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// (a) photo report: approved + hash-cleared copy photo, reported, then quarantined
const { reportId } = await asBob.mutation(api.reports.fileReport.fileReport, {
  targetKind: "photo",
  targetId: photoId,
  reason: "sexual",
});
const preserved = await t.run((ctx) =>
  ctx.storage.store(new Blob(["CSAM-PRESERVED-BYTES"])),
);
await t.mutation(internal.library.moderationStore.quarantineImage, {
  imageId: photoId,
  fileId: preserved,
  uploaderId: alice,
  md5: "m",
  sha1: "s",
  provider: "offlimits",
  originalDiscarded: true,
});
const detail = await asAdmin.query(api.admin.getReport.getReport, { reportId });
expect(detail.photoUrl).toBe(
  await t.run((ctx) => ctx.storage.getUrl(preserved)),
); // served

// (b) message report: HCS answers 503, so the photo is sent while its check is pending; reported; then quarantined
expect(
  (await asAdmin.query(api.admin.getReport.getReport, { reportId: msgReport }))
    .photoUrl,
).toBeNull(); // correctly hidden
await asAdmin.mutation(api.admin.decideReport.decideReport, {
  reportId: msgReport,
  decision: "content_removed",
  statementOfReasons: "caption",
});
await settleDueScheduled(t);
expect((await t.run((ctx) => ctx.db.get(attachmentId)))?.moderationStatus).toBe(
  "removed",
); // quarantine overwritten
const report = await t.run((ctx) => ctx.db.get(msgReport));
expect(await bytesOfUrlBlob(t, report!.evidenceFileId!)).toBe(
  "CSAM-PRESERVED-BYTES",
); // copied into evidence
expect(
  (await asAdmin.query(api.admin.getReport.getReport, { reportId: msgReport }))
    .photoUrl,
).not.toBeNull();
```

</details>

---

### SEC-05 — A submitter can rewrite their approved, public definition and hijack another puzzle's barcode

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Catalog · **Merged from:** CAT-1

**Description.** `updatePuzzleDefinition` checks only "submitter or admin" and never looks at the definition's status (`convex/catalog/updatePuzzleDefinition.ts:67-75`). `PuzzleDefinition.update` leaves the approval status as it was (`domain/catalog/domain/puzzle-definition.ts:183-235`). Self-edits are deliberately not audited (`updatePuzzleDefinition.ts:76-80`).

Once an admin approves a member's submission, that member can call the mutation directly and rewrite title, description, brand, tags, category and barcodes on a live public definition. No moderation, no change proposal, no audit stamp. Every web caller of this mutation is an admin route, so the self-edit path is reachable only by calling the function directly, which is exactly the threat model.

The update use case also skips the barcode-uniqueness rule that submit enforces (`firstDuplicateBarcode` runs only in `domain/catalog/application/use-cases/submit-puzzle-definition.ts:37`). `findApprovedByBarcode` takes `.first()` per EAN in creation order (`convex/catalog/findPuzzleByBarcode.ts:15-18`). An older definition can therefore take over a newer puzzle's EAN, and barcode scans and URL-import de-duplication will resolve to the attacker's row.

**Evidence.**

```ts
// convex/catalog/updatePuzzleDefinition.ts:73-75
if (submittedBy !== (actingMember as unknown as string)) {
  if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
} // no status check; update-puzzle-definition.ts:14 runs definition.update() with no duplicate-barcode check
```

**Exploit scenario.** A member submits a plausible puzzle and waits for approval. They then call `updatePuzzleDefinition` with a spam title, an SEO-spam description and the EAN of a newer, popular puzzle. The anonymous `/catalog/$id` page serves the new text immediately. Members who scan that barcode in the add-copy picker are pointed at the attacker's definition.

**Recommendation.**

- Allow non-admin self-edits only while `status === "pending"`. For anything approved, refuse and direct the member to `proposeDefinitionChange`. Making the endpoint admin-only also works and matches every current caller.
- Run `firstDuplicateBarcode`, excluding the definition itself, in the update path and in `approveChangeProposal`.
- Add a test that a submitter gets `Forbidden` when editing their own approved definition.
- Related: SEC-52 (barcodes squatted by rejected rows).

**Verification.** Repro test.

<details><summary>Condensed repro (convex-test)</summary>

```ts
const decoyId = await attacker.mutation(
  api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
  { title: "Harmless Lighthouse", pieceCount: 1000 },
);
await admin.mutation(
  api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
  { puzzleDefinitionId: decoyId },
);
const legitId = await admin.mutation(
  api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
  { title: "Popular Puzzle", pieceCount: 1000, ean: VALID_EAN },
);
await attacker.mutation(
  api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
  {
    puzzleDefinitionId: decoyId,
    title: "BUY CHEAP PILLS spam.example",
    description: "SEO spam",
    ean: VALID_EAN,
  },
);
// decoy: status "approved", title rewritten, ean === VALID_EAN; no moderationActions stamp, no proposal row
expect(
  (
    await t.query(api.catalog.getPublicDefinitionView.getPublicDefinitionView, {
      puzzleId: decoy._id,
    })
  )?.definition.title,
).toBe("BUY CHEAP PILLS spam.example"); // anonymous page
expect(
  (
    await victim.query(api.catalog.findPuzzleByBarcode.lookupPuzzleByBarcode, {
      code: VALID_EAN,
    })
  )?.title,
).toBe("BUY CHEAP PILLS spam.example"); // barcode hijacked
```

</details>

---

### SEC-06 — `addCopyImage` records the copy owner as uploader, so CSAM escalations name the wrong person

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Library / moderation · **Merged from:** LIB-5

**Description.** `addCopyImage` lets household members with `manage` permission add photos (`convex/library/addCopyImage.ts:39-45`, via `convexCopyManagerPolicy`). The repository, however, inserts the row with `uploaderId: copy.ownerId` (`convex/library/adapters/convexCopyRepository.ts:83-84`, "the domain has no separate uploader concept").

The moderation pipeline passes `row.uploaderId` to quarantine, and `recordCsamEscalation` snapshots that user's clerkId, email, name and username for the report (`convex/lib/imageModeration/quarantine.ts:74-87`). Uploader-only visibility of pending photos and purge-by-uploader (`convex/conversation/purgeMemberLibrary.ts:301-311`) are keyed to the wrong person as well. `addCopyPhoto` records the actor correctly (`convex/library/addCopyPhoto.ts:54`), which shows this is a bug, not a design choice.

**Exploit scenario.** A malicious housemate (`manage` is the default permission) uploads a hash-matching or NSFW image to a housemate's copy through `library.addCopyImage`. The escalation and moderation records name the owner, with the owner's email and Clerk id in `uploaderSnapshot`. Any operator or law-enforcement report built from those records points at the wrong person.

**Recommendation.** Pass the acting member through to the repository (as a field on `CopyImage` or a `save(copy, { actorId })` option) and store it as `uploaderId`. Simpler: retire `addCopyImage` in favour of `addCopyPhoto`, which records the actor and is also the safer path for SEC-01. Existing rows cannot be backfilled, so log the actor on `CopyImageAdded` from now on.

**Verification.** Repro test. The attacker must be an accepted household member, which requires mutual consent; that is why this is medium rather than high.

<details><summary>Condensed repro (convex-test)</summary>

```ts
const copy = await acquire(t, "alice", p.aggregateId);
await as(t, "alice").mutation(
  api.household.createHousehold.createHousehold,
  {},
);
const inviteId = await as(t, "alice").mutation(
  api.household.inviteToHousehold.inviteToHousehold,
  { inviteeId: bob },
);
await as(t, "bob").mutation(
  api.household.acceptHouseholdInvite.acceptHouseholdInvite,
  { inviteId },
);
const fileId = await t.run((ctx) =>
  ctx.storage.store(new Blob(["img"], { type: "image/png" })),
);
await as(t, "bob").mutation(api.library.addCopyImage.addCopyImage, {
  copyId: copy.agg,
  fileId: fileId as string,
});
const [row] = await t.run((ctx) =>
  ctx.db
    .query("ownedPuzzleImages")
    .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy.id))
    .collect(),
);
expect(row.uploaderId).toBe(alice); // Bob uploaded it
```

</details>

---

### SEC-07 — A pre-claimed slug takes over a later member's username handle, including their id/QR links

**Severity:** Medium · **Status:** Confirmed (repro, two slices) · **Area:** Identity · **Merged from:** SOC-4, IDENT-5

**Description.** Handles resolve in the order id, then slug, then username (`convex/identity/resolveMemberByHandle.ts:20-34`). `setSlug` refuses a slug equal to another member's _existing_ username (`convex/identity/setSlug.ts:86-92`). The reverse order is never checked: the Clerk webhook writes a new or changed `username` with no slug check (`convex/users.ts:161`, `:183`).

The app builds handles as `slug ?? username ?? id` in many places:

- `apps/web/src/components/messaging/format.ts:55`, `circle-thread-header.tsx`, `social/member-tile.tsx`, `copies/copy-owner.tsx`
- `getMyInbox`, notification views, `getFollowRequesterPreview`, `listMyBlocks`

The members route also canonicalises. Visiting the victim's id URL (the QR/share link) loads the victim, computes `canonical = username`, and redirects to `/members/<username>`, which then resolves by slug to the attacker (`apps/web/src/routes/members.$handle.tsx:70-78`). The QR code itself encodes the member id, but this redirect still lands on the attacker's page.

**Exploit scenario.** An attacker (free sign-up, one throwaway account per name) calls `setSlug({slug: "newbie"})` for handles people are likely to pick, and copies the expected display name and avatar. When a real member later signs up with Clerk username `newbie`, every link the app builds for them, plus their own QR/share link, opens the attacker's profile. This enables impersonation, phishing, follow capture and trade baiting.

**Recommendation.**

- Put slugs and usernames in one namespace. In `updateOrCreateUser`, when an incoming username equals another member's slug, flag it or clear the colliding slug.
- More robust: build canonical handles as `slug ?? memberId` and never from username.
- In the route, redirect to a canonical handle only after checking that it resolves back to the same `memberId`.

**Verification.** Repro tests (SOC-4 and IDENT-5).

<details><summary>Condensed repro (convex-test)</summary>

```ts
await t
  .withIdentity({ subject: "clerk_alice" })
  .mutation(api.identity.setSlug.setSlug, { slug: "newbie" }); // attacker squats
await t.mutation(internal.users.updateOrCreateUser, {
  clerkUser: {
    id: "clerk_victim",
    username: "newbie" /* verified email ... */,
  },
});
const byId = await t.query(api.social.getPublicProfile.getPublicProfile, {
  handle: victim._id,
});
const canonical = byId!.hero.slug ?? byId!.hero.username ?? byId!.hero.memberId; // what the route redirects to
expect(canonical).toBe("newbie");
const byCanonical = await t.query(
  api.social.getPublicProfile.getPublicProfile,
  { handle: canonical },
);
expect(byCanonical?.hero.memberId).toBe(alice); // the victim's link lands on the attacker
```

</details>

---

### SEC-08 — Owner's verified email is revealed to any trade requester after a one-line reply, and stays visible after a decline

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Exchange / privacy · **Merged from:** PRIV-1

**Description.** The first time the copy owner posts _any_ message in the exchange thread, `tradeRevealSubscriber` records an append-only reveal with reason `owner_replied` (`convex/exchange/tradeRevealSubscriber.ts:32-45`, `domain/social/domain/identity-reveal.ts:30-31`). From then on, `getTradePartner` returns the owner's Clerk-verified `email` to the requester (`convex/exchange/getTradePartner.ts:50-69`). It never looks at exchange status, so the email stays visible after a decline or cancel.

Only the requester is told about the reveal (`apps/web/locales/en.json:687`). Nothing in the owner's UI says a reply shares their email. The privacy policy's sharing section (`en.json:1462`) does not say members see each other's email. `exchange/propose.ts` has no rate limit, which makes harvesting at scale practical. The domain comment at `identity-reveal.ts:110-117` says the email is gated on owner action precisely to stop harvesting; a "no thanks" clears that gate.

**Evidence.**

```ts
// domain/social/domain/identity-reveal.ts:30-31
case "ExchangeMessagePosted": return trigger.authorId === recipient ? "owner_replied" : null;
// convex/exchange/getTradePartner.ts:67-68
...(emailVisible && user.email !== undefined ? { email: user.email } : {}),
```

**Exploit scenario.** A member proposes on many reachable copies (public owners' open copies, shared circles), each with "Is this still available?". Every owner who answers, even with "No thanks", has their verified email permanently visible on that trade's partner card. The attacker collects the addresses for spam or phishing, or to link a private-profile owner to other identities.

**Recommendation.**

- Reveal the owner's email only on an explicit accept or an explicit "share my contact details" action, not on any reply.
- If a reply stays a trigger, warn the owner in the composer before their first reply.
- Hide the email once the exchange is declined or cancelled.
- Add a per-member rate limit on proposals (also needed for SEC-24).
- Disclose in the privacy policy that trade partners can see each other's email.

**Verification.** Repro test. The existing test `tradeIdentityReveal.test.ts:983-997` also documents that a reply reveals the email.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// owner has a public profile and 25 open copies; the attacker proposes on all 25 with no throttling
for (const copy of copies)
  exchangeIds.push(
    await as(t, "attacker").mutation(api.exchange.propose.propose, {
      type: "sale",
      salePrice: 10,
      requestedPuzzleId: copy,
    }),
  );
expect(
  await as(t, "attacker").query(api.exchange.getTradePartner.getTradePartner, {
    exchangeId: exDoc,
  }),
).not.toHaveProperty("email");
await post(t, "attacker", ex, "Is this still available?");
await post(t, "owner", ex, "No thanks");
await as(t, "owner").mutation(api.exchange.decline.decline, { exchangeId: ex });
// exchange status is "rejected", yet:
expect(
  await as(t, "attacker").query(api.exchange.getTradePartner.getTradePartner, {
    exchangeId: exDoc,
  }),
).toMatchObject({ state: "revealed", email: "owner@example.com" });
```

</details>

---

### SEC-09 — Exchange-party access to private copies (rule P) survives ownership changes

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Library · **Merged from:** SHARE-3

**Description.** For a private copy, `canViewCopyWithContext` grants access to any party of any proposed, accepted, completed or disputed exchange that ever referenced the copy (`convex/library/canViewCopy.ts:120`, `isExchangePartyFor` at `:36-58`). It never checks that the copy's _current_ owner was a party to that exchange. Because a copy keeps the same `_id` through every transfer, every earlier buyer and seller keeps rule-P access for good.

`getCopyInstanceView` then returns the current owner's approved gallery photos, completion timeline with dates and durations, loans and condition (`convex/library/getCopyInstanceView.ts:133`, `:159-168`, `:300`). A later owner's choice to make the copy private has no effect on anyone earlier in the chain. In fact, marking it private is exactly what opens it up: the same copy set to "visible but closed" is hidden from those earlier parties.

**Evidence.**

```ts
// convex/library/canViewCopy.ts:53-57 — no check that copy.ownerId is one of the parties
return [...offered, ...requested].some(
  (exchange) =>
    EXCHANGE_STATUSES_REVEALING_COPY[exchange.status] &&
    (exchange.initiatorId === viewerId || exchange.recipientId === viewerId),
);
```

**Exploit scenario.** Ann sells copy Y to Ben, and Ben later sells it to Cat. Cat goes private and marks Y private. Ann, two owners back and with no follow, circle or household tie to Cat, calls `getCopyInstanceView({copyId: Y})` and sees Cat's photos and solve dates.

**Recommendation.** Bind rule P to the current owner: count only exchanges where `copy.ownerId` is a party and the viewer is the other party, or only exchanges after the copy's latest `copyCustodyEntries` row. Add a regression test for the A→B→C chain.

**Verification.** Repro test, run through the real sale flows.

<details><summary>Condensed repro (convex-test)</summary>

```ts
await sell(t, "ann", "ben", y); // propose / accept / confirm x2 / flush
await as(t, "ben").mutation(api.library.updateCopySharing.updateCopySharing, {
  copyId: agg,
  visibility: "visible",
  forSale: true,
});
await sell(t, "ben", "cat", y);
// Cat goes private (profiles.visibility = "private") and makes the copy private:
await as(t, "cat").mutation(api.library.updateCopySharing.updateCopySharing, {
  copyId: agg,
  visibility: "private",
});
expect(
  await as(t, "ann").query(
    api.library.getCopyInstanceView.getCopyInstanceView,
    { copyId: y },
  ),
).not.toBeNull();
// control: visibility "visible" (closed) -> Ann gets null
```

</details>

---

### SEC-10 — The household invite flow reveals the account name behind a private member's pseudonym

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Household · **Merged from:** SHARE-4

**Description.** `personView` resolves a member with `memberDisplayNameOf(user)` and no profile (`convex/household/getMyHousehold.ts:20-33`). That yields the Clerk account name (first and last name, `convex/users.ts:157`) plus the avatar, ignoring both `projectMemberIdentity` and the member's chosen profile display name. `getMyHousehold` returns `personView` of every pending invitee to the admin (`getMyHousehold.ts:78`).

Any member can become a household admin with `createHousehold`. `inviteToHousehold` accepts any `users` id with no contact rule; it only checks that the id exists and that there is no block (`convex/household/inviteToHousehold.ts:19-27`). `revokeHouseholdInvite` then deletes the invite and its notification (`convex/household/revokeHouseholdInvite.ts:37`). The locked profile hero, by contrast, shows only `memberDisplayNameOf(user, profile)`, the pseudonym (`convex/social/getPublicProfile.ts:107`).

**Exploit scenario.** The victim has a private profile, display name "Pseudonym" and account name "Real Fullname". The attacker gets the victim's `memberId` from the locked hero, runs `createHousehold`, then `inviteToHousehold`, then `getMyHousehold`, and reads `{ name: "Real Fullname", avatar }`. A `revokeHouseholdInvite` call removes the trace (in-app). Push or email may already have gone out if the victim opted in.

**Recommendation.**

- For anyone who is not yet a household member (pending invitees, and inviters shown to invitees), project through `projectMemberIdentity`, or at least use `memberDisplayNameOf(user, profile)`.
- Require a contact rule for household invites, as circle invites do (mutual follow), and add a rate limit (SEC-24).

**Verification.** Repro test. The extra leak only matters for members whose profile display name differs from their account name; for everyone else the hero already shows the account name.

<details><summary>Condensed repro (convex-test)</summary>

```ts
const profile = await as(t, "attacker").query(
  api.social.getPublicProfile.getPublicProfile,
  { handle: "pseudo_handle" },
);
expect(profile?.locked).toBe(true);
expect(profile?.hero.displayName).toBe("Pseudonym");
await as(t, "attacker").mutation(
  api.household.createHousehold.createHousehold,
  {},
);
const inviteId = await as(t, "attacker").mutation(
  api.household.inviteToHousehold.inviteToHousehold,
  { inviteeId: profile!.hero.memberId },
);
const hh = await as(t, "attacker").query(
  api.household.getMyHousehold.getMyHousehold,
  {},
);
expect(hh?.pendingInvites[0]?.invitee).toEqual({
  memberId: victim,
  name: "Real Fullname",
  avatar: "https://img.example/victim.png",
});
await as(t, "attacker").mutation(
  api.household.revokeHouseholdInvite.revokeHouseholdInvite,
  { inviteId },
);
// victim is left with 0 notifications
```

</details>

---

### SEC-11 — Raw `toMemberView` in review, comment, follow-request and loan views leaks private members' bio, location and language

**Severity:** Medium · **Status:** Confirmed (repro, three slices) · **Area:** Social / library · **Merged from:** SOC-3, SURF-2, LIB-9

**Description.** `toMemberView` emits `bio`, `location` and `preferredLanguage` (`convex/identity/toMemberView.ts:12-14`). The privacy chokepoint deliberately strips those fields, even for the circle and block reveals (`convex/social/privacy.ts:303-325`). `getPublicProfile` shows `location` only for public profiles (`convex/social/getPublicProfile.ts:117-120`). `getFollowRequesterPreview` promises "identity fields only".

These views use raw `toMemberView` anyway, regardless of the subject's profile visibility:

- `convex/social/listPuzzleReviews.ts:40-44`: any signed-in member, any puzzle id. It has no `status === "approved"` gate either, unlike `listPublicPuzzleReviews`.
- `convex/library/listPhotoComments.ts:46` and `convex/social/listPuzzleComments.ts:45`: any viewer of the copy. A circle-share viewer of a private owner gets that owner's location, although circle reveals are meant to be identity-only.
- `convex/social/listIncomingFollowRequests.ts:31`: lower impact, since the requester initiated contact.
- `convex/library/loanReadViews.ts:33-34`: lender and borrower. This also ignores blocks, and `getLentOutLoans` shows the borrower's full view to household co-managers who were never party to the loan.

**Evidence.**

```ts
// convex/social/listPuzzleReviews.ts:40-44
const author = await ctx.db.get(row.userId);
return { id: row._id, author: author?.isActive ? toMemberView(author) : { ... }, ... }
// convex/library/loanReadViews.ts:33-34
lender: lender?.isActive ? toMemberView(lender) : null,
borrower: borrower?.isActive ? toMemberView(borrower) : null,
```

**Exploit scenario.** A member walks the public catalog (puzzle ids are public through `browsePublicCatalog` and the sitemap) and calls `listPuzzleReviews` for each id. They collect name, username, avatar, bio, free-text location and language for every reviewer, including members who set their profile to private. `getUserById` and `searchUsers` would hide those members.

**Recommendation.**

- Give these views an identity-only author shape (display name, handle, avatar, and the id only when it can be revealed), or run authors through `projectMemberIdentity` with the review or comment id as salt.
- Never emit `bio`, `location` or `preferredLanguage` unless `isRevealedByOrdinaryRules` holds.
- Return identity fields only from `listIncomingFollowRequests` and `loanReadViews`, and honour blocks there.
- Add the approved (or submitter/admin) gate to `listPuzzleReviews`.
- Consider an arch or lint rule that forbids `toMemberView` outside identity self-reads and `privacy.ts`.

**Verification.** Repro tests in SOC-3, SURF-2 and the LIB-8/9 test.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// priv: profiles.visibility "private", users.bio "secret bio", location "Secret Town", preferredLanguage "nl"
expect(
  await asAttacker.query(api.identity.getUserById.getUserById, {
    userId: priv,
  }),
).toBeNull(); // correctly hidden
const reviews = await asAttacker.query(
  api.social.listPuzzleReviews.listPuzzleReviews,
  { puzzleId: pendingPuzzle },
);
expect(reviews[0].author).toMatchObject({
  _id: priv,
  bio: "secret bio",
  location: "Secret Town",
  preferredLanguage: "nl",
});
// listIncomingFollowRequests returns the same fields; getFollowRequesterPreview omits them.
// LIB-9: after alice (borrower) blocks the owner, getLentOutLoans still returns borrower.location "alice-home-town".
```

</details>

---

### SEC-12 — `listReviewsForMember` returns the raw `exchangeId`, which de-anonymises reviewers; it has no visibility or block gate

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Reputation · **Merged from:** SOC-1, SURF-10

**Description.** The reviewer is projected through `projectMemberIdentity`. Everything else in the row is spread back unchanged (`convex/reputation/listReviewsForMember.ts:27-34`): `exchangeId`, `revieweeId`, `aggregateId`, `_id` and `comment`.

A review can only exist between the two parties of a completed exchange (`convex/reputation/adapters/convexExchangeCompletionPort.ts:33-44`). So the same `exchangeId` showing up under two reviewees means they traded with each other, and the anonymous reviewer on one list is the reviewee of the other.

There is also no gate on the reviewee:

- Any member can read any member's received reviews and comments, including private members'.
- Only reviews _written by_ blocked members are filtered out (line 26). A member the reviewee blocked still reads everything.
- `getReputationProfile` has no check at all (`convex/reputation/getReputationProfile.ts:8-36`).
- Contrast `getUserStats` (`convex/identity/getUserStats.ts:77-92`), which hides these from blocked viewers and from non-mutual viewers of private members.

**Evidence.**

```ts
// convex/reputation/listReviewsForMember.ts:26-34
.filter((row) => !blocked.has(row.reviewerId))
.map(async ({ reviewerId, ...row }) => ({ ...row,          // exchangeId, revieweeId, comment ...
  reviewer: await projectMemberIdentity(ctx, me, reviewerId, row.aggregateId ?? row._id) })),
```

**Exploit scenario.** Collect member ids (SEC-13 supplies private ones), call `listReviewsForMember` for each, and group the rows by `exchangeId`. This rebuilds the trade graph and attaches a name to every anonymous reviewer of a reciprocally reviewed trade. There is no rate limit.

**Recommendation.**

- Return an explicit DTO: rating, categories, comment, createdAt, a review id and the projected reviewer. Never return `exchangeId` or `revieweeId`; the UI does not use them.
- Apply the `getUserStats` gate: return `[]` when the reviewee blocked the viewer, and hide comments when the reviewee is private and not mutual. The rating can stay public, since the profile hero shows it.

**Verification.** Repro test.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// pub (public) and priv (private) completed one exchange and reviewed each other
const onPub = await asAttacker.query(
  api.reputation.listReviewsForMember.listReviewsForMember,
  { memberId: pub },
);
const onPriv = await asAttacker.query(
  api.reputation.listReviewsForMember.listReviewsForMember,
  { memberId: priv },
);
expect(onPub[0].reviewer.anonymous).toBe(true);
expect(onPub[0].exchangeId).toBe(exchangeId);
expect(onPriv[0].exchangeId).toBe(exchangeId); // correlates
expect(onPriv[0].comment).toBe("private member's received comment"); // private member's content
await t.run((ctx) =>
  ctx.db.insert("blocks", {
    blockerId: pub,
    blockedId: attacker,
    createdAt: Date.now(),
  }),
);
expect(
  await asAttacker.query(
    api.reputation.listReviewsForMember.listReviewsForMember,
    { memberId: pub },
  ),
).toHaveLength(1);
```

</details>

---

### SEC-13 — `listFollowers`/`listFollowees` of a public member list private members by id and name

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Social · **Merged from:** SOC-2

**Description.** Both queries take any `memberId` and check only the _target's_ visibility (`convex/social/listFollowers.ts:26-32`). For a public target they return every edge through `toFollowEdgeView`, which emits the counterparty's `memberId` and display name with no privacy check on the counterparty (`convex/social/readViews.ts:23-39`).

A private member who follows, or is followed by, any public member is therefore listed to every signed-in caller. That undercuts `searchUsers` hiding private members, and the teaser's own assumption that "enumeration stays blocked because search remains visibility-gated". The web app only calls these with `{}`, i.e. the caller's own lists (`apps/web/src/components/social/follow-list.tsx:23-30`).

**Exploit scenario.** Call `listFollowers({memberId})` for every public member found through search or "recently joined". The union yields private members' ids and names, plus who they follow. Each id then feeds SEC-10, SEC-12 and `getPublicMemberTeaser`.

**Recommendation.** Drop the `memberId` argument, since the UI only needs the caller's own lists. If other members' lists are kept, project each counterparty through `projectMemberIdentity` (or filter out hidden ones) and never emit raw ids of hidden members. Bound the `.collect()`. SEC-41 (`followersYouKnow`) is a smaller variant that survives this fix.

**Verification.** Repro test.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// priv (private) follows pub (public)
expect(
  await asAttacker.query(api.social.listFollowees.listFollowees, {
    memberId: priv,
  }),
).toEqual([]); // hidden
expect(
  await asAttacker.query(api.social.listFollowers.listFollowers, {
    memberId: pub,
  }),
).toEqual([
  expect.objectContaining({ memberId: priv, displayName: "Private Person" }),
]); // leaked
```

</details>

---

### SEC-14 — Profile display name is unbounded and unsanitized; it becomes the From name and subject of jigswap.site email

**Severity:** Medium · **Status:** Confirmed (repro, two slices) · **Area:** Notifications / social · **Merged from:** NOTIF-3, SOC-6

**Description.** `editProfile` accepts `displayName` and `bio` as bare `v.string()` (`convex/social/editProfile.ts:17-20`). `DisplayName.create` only trims and rejects empty values: no length cap, and control and bidi characters such as U+202E are kept (`domain/social/domain/display-name.ts:10-16`). The web editor never sends `displayName`, so this is a direct-call capability, yet `memberDisplayNameOf` prefers it everywhere.

The value is snapshotted as `params.actorName` into other members' notification rows (`convex/notifications/subscriber.ts:132-145`). `renderEmail` sets the From name to `` `${actorName} | JigSwap` `` (`packages/email/src/render.tsx:108-116`), and several subjects start with `{actorName}` (`packages/email/src/copy.ts:192`, `:263`, `:279`, `:309`). The only sanitizing on the way to AhaSend is CR/LF stripping (`convex/notifications/adapters/ahasendEmailSender.ts:17`). Push titles ("New message from …") carry the same text to lock screens.

The invite path already handles this correctly: it uses a brand-only From name (`packages/email/src/render-invite.tsx:29-30`, `:49`) and strips Cc/Cf characters with a 60-character cap (`domain/social/domain/invite-email.ts:47-62`).

**Exploit scenario.** The attacker sets their display name to "JigSwap Security — your account will be suspended, verify at https://jigswap-verify.example" and follows many members. Public profiles are followed instantly; private ones get a request. Every target who enabled `new_follower` or `follow_request_received` email receives a DKIM-aligned message from `no-reply@jigswap.site` whose sender line and subject carry the phishing text. Separately, a near-1 MB display name is copied into every follower list and notification row that names the attacker (storage and read cost; it adds to SEC-23's inbox DoS).

**Recommendation.**

- Use the fixed brand "JigSwap" as the From name for notification email, as invites do.
- Run `actorName` through an `inviterNameForEmail`-style sanitizer before it goes into subjects and push titles: strip `\p{Cc}` and `\p{Cf}`, collapse whitespace, cap at about 60 characters.
- Enforce length and character policies in `DisplayName.create` (for example 50 characters) and in the `bio` validator (for example 500).
- Truncate `actorName` when snapshotting it into notification params.
- Consider dropping the `displayName` argument if it is not a product feature, or validate it against reserved names such as "JigSwap" or "Admin".

**Verification.** Repro tests. NOTIF-3 ran the full real path through the AhaSend adapter with `fetch` stubbed; SOC-6 covered storage and propagation. Email is opt-in (off by default), which limits reach, so low would also be defensible.

<details><summary>Condensed repro (convex-test)</summary>

```ts
const PHISH =
  "JigSwap Security Team ‮ — your account will be suspended, verify now at https://jigswap-verify.example/login " +
  "x".repeat(300);
await asVictim.mutation(
  api.notifications.updateNotificationPreference.updateNotificationPreference,
  { type: "new_follower", channel: "email", enabled: true },
);
await asAttacker.mutation(api.social.editProfile.editProfile, {
  displayName: PHISH,
});
await asAttacker.mutation(api.social.followMember.followMember, {
  followeeId: victim,
});
await flush(t);
const body = JSON.parse(
  (fetchMock.mock.calls[0][1] as RequestInit).body as string,
); // AhaSend request
expect(body.from.email).toBe("no-reply@jigswap.site");
expect(body.from.name).toBe(`${PHISH} | JigSwap`); // > 400 chars, contains U+202E
expect(body.subject.startsWith(PHISH)).toBe(true);
// SOC-6: a 130 KB displayName comes back from listFollowers and is stored verbatim in params.actorName; a 200 KB bio is stored.
```

</details>

---

### SEC-15 — DNS rebinding past the URL-import SSRF guard, with HTML read-back

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Catalog · **Merged from:** CAT-2

**Description.** Every SSRF guard resolves DNS, checks the addresses and then calls `fetch()`, which resolves the name again on its own. The code documents this as "finding #14, accepted" (`convex/catalog/adapters/assertPublicUrl.ts:10-21`, check at `:37-66`). ogie's `allowPrivateUrls: false` check is lexical only (`convex/catalog/adapters/ogieStorePageFetcher.ts:14`), and a trailing-dot host (`localhost.`) gets past it.

`browserStorePageFetcher.ts:89-101` and `importPuzzleImage.ts:58-64` have the same resolve-then-fetch split. `extractFromUrl` returns the parsed page to the caller as `draft.title`, `description`, `brand`, `images` and `ean` (`convex/catalog/extractFromUrl.ts:136`). That is a read-back channel for any internal endpoint that serves `text/html`. `importPuzzleImage` leaks the status code ("Image fetch failed: 404").

**Exploit scenario.** A member registers a rebinding hostname that alternates between a public IP and an internal address, then loops `extractFromUrl({url: "http://rebind.example:PORT/path?n=<i>"})`. Varying `?n` avoids the import cache, and there is no rate limit (SEC-21). When the pre-flight sees the public IP and the fetch connects internally, the internal page's `<title>`, meta description and OG/JSON-LD come back in the draft.

The practical impact depends on what is reachable from Convex's Node runtime, which cannot be checked from the repo. JSON endpoints such as cloud metadata cannot be read back because both tiers require HTML; they can only be probed blind.

**Recommendation.**

- Validate at connect time. Add `undici` as a backend dependency (`csamHashCheck.ts:22-24` notes it is not importable today) and create an `Agent` whose `connect.lookup` calls `dns.lookup(all: true)` and fails if any address `isPrivateIp`.
- Pass it as the `dispatcher` to every fetch. For ogie, which uses global fetch, call `setGlobalDispatcher` inside the action.
- Pair this with SEC-21's rate limit, and fix the denylist gaps in SEC-50.

**Verification.** Repro test: the pre-flight lookup was mocked to return a public IP while `fetch` resolved `localhost.` to a local 127.0.0.1 server.

<details><summary>Condensed repro (convex-test)</summary>

```ts
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
})); // rebinding window
// local server on 127.0.0.1 serves <title>INTERNAL-ADMIN-PANEL v1.2</title><meta name="description" content="internal secret: db=10.0.3.7">
const res = await t
  .withIdentity({ subject: "clerk_any" })
  .action(api.catalog.extractFromUrl.extractFromUrl, {
    url: `http://localhost.:${port}/admin?n=1`,
  });
expect(res.ok && res.draft.title).toContain("INTERNAL-ADMIN-PANEL");
expect(res.ok && res.draft.description).toContain("internal secret");
await expect(
  asMember.action(api.catalog.importPuzzleImage.importPuzzleImage, {
    url: `http://localhost.:${port}/nope`,
  }),
).rejects.toThrow("Image fetch failed: 404");
```

</details>

---

### SEC-16 — Push subscriptions accept any endpoint, with no cap and no send timeout

**Severity:** Medium · **Status:** Confirmed (repro; the SURF variant's SSRF angle is plausible only) · **Area:** Notifications · **Merged from:** NOTIF-1, SURF-4

**Description.** `registerPushSubscription` stores `endpoint`, `p256dh` and `auth` as bare strings, with no scheme, host or length check, and inserts one row per new endpoint with no per-member cap (`convex/notifications/pushSubscriptions.ts:19-46`). `sendWebPush.send` loads all of the recipient's subscriptions and sends to each in sequence (`convex/notifications/sendWebPush.ts:137`). It passes no options, so there is no timeout (`sendWebPush.ts:32-38`). web-push 3.6.7 hands the parsed endpoint straight to `https.request` and sets a socket timeout only when one is passed.

As a result, Convex makes signed HTTPS POSTs to any `host:port` a member chooses. One slow endpoint holds the whole per-recipient action open until the platform kills it.

**Exploit scenario.** Account A registers thousands of endpoints pointing at a tarpit (or at internal or third-party HTTPS hosts), with valid self-generated keys, and enables push for `new_follower`. Account B loops follow and unfollow on A; this path has no rate limit (SEC-23). Every follow schedules a push action that hangs on the first tarpit endpoint. That burns billed action time and Node-action concurrency shared with email and moderation, and generates N outbound POSTs to the chosen targets.

The SSRF part is blind: HTTPS only, certificate validation on, encrypted body, response not returned. So this is mainly a cost and availability issue.

**Recommendation.**

- Validate the endpoint at registration: `https:` only, an allowlisted push-service host (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, …), no explicit port, and a length cap.
- Check that `p256dh` and `auth` are base64url of 65 and 16 bytes.
- Cap subscriptions per member (about 10, evicting the oldest).
- Pass `{ timeout: 10_000, TTL }` to `sendNotification`, send with bounded parallelism, and prune endpoints after repeated failures.

**Verification.** Repro test (NOTIF-1) using the real web-push library and throwaway VAPID keys against a local TCP tarpit.

<details><summary>Condensed repro (convex-test)</summary>

```ts
for (const endpoint of [
  "https://10.0.0.1:8443/internal",
  "https://169.254.169.254/latest/meta-data",
  "file:///etc/passwd",
  `https://tarpit.attacker.example/${"x".repeat(20_000)}` /* + 300 more */,
])
  await asA.mutation(
    api.notifications.pushSubscriptions.registerPushSubscription,
    { endpoint, ...keys },
  );
// -> 306 rows for one member, all stored verbatim

// tarpit on 127.0.0.2 accepts TCP, reads the TLS ClientHello, never answers; two subscriptions point at it
const run = t.action(internal.notifications.sendWebPush.send, {
  userId: attacker,
  type: "new_follower",
  title: "t",
  message: "m",
});
await sleep(5000);
expect(stillRunning).toBe(true);
expect(tlsHellos).toBe(1);
expect(connections).toBe(1); // no timeout, serial fan-out
```

</details>

---

### SEC-17 — PNG decompression-bomb guard bypassed by a duplicate IHDR or an interlaced IDAT

**Severity:** Medium · **Status:** Confirmed (repro and local measurement) · **Area:** Image pipeline · **Merged from:** GAP1-1

**Description.** The pixel guard is the documented decompression-bomb defence (`convex/lib/imageModeration/guards.ts:8-9`), but `pngDimensions` reads only the IHDR at byte 16 (`guards.ts:122-127`). The metadata walker keeps every IHDR chunk and never counts them (`convex/lib/imageModeration/stripMetadata.ts:196-215`). pngjs, which jimp uses, re-runs its IHDR handler for every IHDR chunk, so the _last_ one decides the decode size.

Separately, pngjs inflates an interlaced image with no `maxLength` at all. Both bypasses pass the guard while the header says 1×1. Nothing re-checks `bitmap.width * height` after decoding (`convex/lib/imageModeration/normaliseImage.ts:76`, `pipeline.ts:124-133`).

**Exploit scenario.**

- A 249 KB dual-IHDR PNG is decoded and stored at 8000×8000 (843 MiB peak) and approved.
- A 2 MB interlaced 1×1 PNG peaks at about 4.2 GiB and is OOM-killed under a 512 MiB cgroup (the documented Convex Node-action limit), so every moderation attempt dies.

Attached through `addCopyPhoto` or `sanitizeBoxArt` (no rate limit, SEC-19), this crashes moderation attempts. With a dual-IHDR file small enough to survive, the platform stores and approves an image over its own 25 MP limit; as public box art, that forces each catalog visitor's browser to decode it.

**Recommendation.**

- Refuse any PNG unless it has exactly one IHDR and that IHDR is the first chunk.
- Refuse interlaced PNGs, or inflate IDAT yourself with zlib `maxOutputLength` set to the expected size.
- Check `image.bitmap.width * height <= MAX_IMAGE_PIXELS` right after decoding and before re-encoding.
- Add regression fixtures for both cases.

**Verification.** convex-test repro through the public `addCopyPhoto`, plus local memory measurements with the repo's `guards.ts`, `stripMetadata.ts` and jimp under `systemd-run MemoryMax=512M`.

<details><summary>Condensed repro and measurements</summary>

```ts
// dupihdr_26mp.png = PNG sig + IHDR(1x1) + IHDR(5200x5000) + IDAT(deflate of zeros) + IEND (101 KB, valid CRCs)
expect(checkImageBytes(bytes)).toEqual({
  ok: true,
  format: "png",
  width: 1,
  height: 1,
});
const row = await addCopyPhoto(t, copy, await store(t, bytes, "image/png")); // then settleDueScheduled
expect(row.moderationStatus).toBe("approved");
expect([u32be(stored, 16), u32be(stored, 20)]).toEqual([5200, 5000]); // 26 MP > MAX_IMAGE_PIXELS
```

```
dupihdr_64mp.png      248,924 B  guard 1x1 ok -> decoded+re-encoded 8000x8000, maxRSS 843 MiB (512M cgroup: completes at 384 MiB)
interlace_bomb_400m   407,742 B  guard 1x1 ok -> maxRSS 907 MiB, then decode error
interlace_bomb_2g   2,087,324 B  guard 1x1 ok -> maxRSS 4218 MiB; under MemoryMax=512M: exit=137 (OOM-killed)
```

</details>

---

### SEC-18 — The 25 MP limit decodes past the 512 MiB action limit; a crash blob can be reattached without limit to stall moderation

**Severity:** Medium · **Status:** Confirmed (code trace and local measurement) · **Area:** Image pipeline · **Merged from:** GAP1-3

**Description.** `MAX_IMAGE_PIXELS = 25_000_000` (`convex/lib/imageModeration/guards.ts:26`) is above what a 512 MiB Node action can decode and re-encode. A 147 KB 5000×5000 JPEG peaked at 763 MiB and was OOM-killed under `MemoryMax=512M`. A 4:4:4 variant tripped jpeg-js's own 512 MB limit, but only after a 927 MiB spike.

An OOM kills the attempt before the swap or delete, so the blob survives. `addCopyPhoto` has no freshness or not-referenced rule (SEC-01) and no rate limit, so the same small blob can be attached any number of times. Each attachment gets up to 5 crashing attempts (`convex/lib/imageModeration/moderationPool.ts:58-62`) on a pool with parallelism 4 (`moderationPool.ts:69`), shared first-in-first-out by copy, completion, box-art, message and circle-icon checks. `sanitizeBoxArt` runs the pipeline inline, outside the pool, behind the unlimited `puzzles.generateUploadUrl`.

**Exploit scenario.** Upload one 147-392 KB solid-colour 25 MP JPEG and call `addCopyPhoto` with the same `fileId` about 1,000 times. Each job runs about 3 s before the OOM, five times over. Roughly a thousand attachments keep the 4 slots busy for an hour, and every other member's photo, DM-photo and circle-icon check (including CSAM hash checks) waits behind them. Ordinary users who upload untouched 25 MP originals (browsers whose canvas cannot be read back) always end in `check_failed`.

**Recommendation.**

- Lower `MAX_IMAGE_PIXELS` to a measured safe value (12 MP completed at 435-501 MiB).
- Pass jpeg-js `maxMemoryUsageInMB`/`maxResolutionInMP` through `Jimp.read`.
- Apply the SEC-01 claim rule, so a blob cannot be reattached.
- Add per-member rate limits (SEC-19), and run box-art checks through a bounded pool.
- Reject any re-encode larger than `MAX_IMAGE_UPLOAD_BYTES`.

**Verification.** Code trace plus local measurements. The candidate's claim that 18 MP photos are OOM-killed was **not** reproduced: 12 MP and 18 MP RGB JPEGs completed under a 512 MiB cgroup.

<details><summary>Local measurements (standalone Node 26, repo guards/stripMetadata + jimp, MemoryMax=512M)</summary>

```
jpeg25mp_420.jpg   147,240 B  5000x5000 -> maxRSS 763 MiB, 2594 ms; under 512M: exit=137
jpeg25mp_solid.jpg 293,255 B  (4:4:4)   -> "maxMemoryUsageInMB limit exceeded" after maxRSS 927 MiB; under 512M: exit=137
photo18mp_rgb.jpg  4896x3672            -> maxRSS 634 MiB unconstrained; under 512M: exit=0 (515 MiB)
photo12mp_rgb.jpg  4000x3000            -> maxRSS 501 MiB; under 512M: exit=0
```

</details>

---

### SEC-19 — Copy, completion and box-art photo paths are unthrottled: paid classifier spend and moderation-pool starvation

**Severity:** Medium · **Status:** Confirmed (repro, three slices) · **Area:** Library / catalog / moderation · **Merged from:** LIB-2, CAT-4, ADMIN-4, SURF-6 (photo part)

**Description.** `RATE_LIMITS` covers message photos (`imageStage` 20/h and 100/day, `imageUploadUrl` 40/h) and circle icons, but has no bucket for copy photos, completion photos or box art (`convex/lib/rateLimits.ts:11-38`). A grep finds no `enforceRateLimit` in `library/`, `solving/` or `catalog/`.

- Each `addCopyPhoto` or `addCopyImage` call queues a moderation job (`convex/library/addCopyPhoto.ts:68`). That job downloads, decodes and re-encodes the image, then calls the paid classifier (Sightengine or HF) and the CSAM hash service, with up to 4 retries.
- `attachCompletionPhotos` queues one job per photo, five per completion, and completions are unlimited (`convex/solving/attachCompletionPhotos.ts:66-77`).
- `sanitizeBoxArt` is a public action that runs the pipeline inline (`convex/catalog/sanitizeBoxArt.ts:13-17` → `convex/catalog/moderateBoxArt.ts:114`), outside the pool's parallelism cap.
- `Copy.addImage` has no per-copy cap, and title and description are unbounded.
- The admin queues `.collect()` without a bound: `convex/admin/listRejectedPhotos.ts:26-31`, `convex/admin/listImageReviewRequests.ts:78-81`.

**Exploit scenario.** One member scripts upload → `addCopyPhoto` on their own copy thousands of times. Every iteration bills a classifier call and fills the 4-slot pool, so other members' photos (and their hash-check gate) stay unpublished for hours. When the Sightengine plan hits `usage_limit`, every new photo site-wide ends `unscored` until the quota resets. With explicit uploads, every one auto-rejects into `listRejectedPhotos`, whose `.collect()` eventually stops the admin Flagged Images queue from loading.

**Recommendation.**

- Add hourly and daily per-member buckets (for example `copyPhoto`, `completionPhoto`, `boxArtCheck`) and enforce them in `addCopyPhoto`, `addCopyImage`, `attachCompletionPhotos`, and in `claimUpload` (a mutation, so it can call `enforceRateLimit` before `sanitizeBoxArt` runs the pipeline).
- Cap photos per copy and bound title and description lengths.
- Add a deployment-wide classifier budget modelled on `chargeMapTilerBudget` (`convex/lib/rateLimits.ts:84-151`).
- Paginate or `.take()` the admin queues.

**Verification.** Repro tests (LIB-2, ADMIN-4, CAT-4 with stubbed `fetch` and DNS). Actual Sightengine quota exhaustion was not tested; it depends on the plan.

<details><summary>Condensed repro (convex-test)</summary>

```ts
for (let i = 0; i < 120; i++)
  await asBob.mutation(api.puzzles.generateUploadUrl, {});
for (let i = 0; i < 120; i++) {
  const fileId = await t.run((ctx) =>
    ctx.storage.store(new Blob([`img-${i}`], { type: "image/png" })),
  );
  await asBob.mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId,
    title: "x".repeat(100_000),
  });
}
expect(rows).toHaveLength(120); // 120 moderation jobs queued
expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(
  0,
);
// CAT-4: 15 sanitizeBoxArt calls -> 30 CSAM hash-check requests + 15 classifier requests, no rateLimits row
```

</details>

---

### SEC-20 — Unlimited shared upload URLs and no storage garbage collection: unclaimed blobs are billed forever

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Storage · **Merged from:** GAP2-1, GAP2-2, GAP2-3, CONV-4

**Description.**

- `puzzles.generateUploadUrl`, the upload URL shared by copy photos, completion photos and box art, only calls `requireMember` (`convex/puzzles.ts:6-15`). Its message-photo and circle-icon siblings are rate-limited.
- Convex documents that upload URLs expire after one hour, that file size is not limited, and that the POST has a 2-minute timeout. The 10 MB limit is only checked once a blob is claimed.
- Nothing ever lists or sweeps `_storage`. The only crons are the stalled-photo sweep and the hash re-check re-arm (`convex/crons.ts:8-22`). The pipeline itself says "There is no storage GC" (`convex/lib/imageModeration/pipeline.ts:653-654`).
- Refused claims deliberately keep the blob: `stageMessageImage.ts:36-38` and `:66-67`, `setCircleIcon.ts:48-49`. That rule is correct, but it guarantees orphans.
- The upload-URL limits are set above the claim limits (40/h URLs vs 20/h stages, and 20/h vs 10/h for circle icons), so even honest clients leave orphans.
- `_storage` records no uploader, so junk cannot be attributed and the deleted-member purge cannot remove it.

**Exploit scenario.** A free account loops `generateUploadUrl` and POSTs junk for up to 2 minutes per URL without ever claiming it. At 100 Mbit/s that is about 1 TB per day, billed every month thereafter. On the Free plan the 1 GB quota is gone in about 80 seconds, after which Convex may start failing writes for everyone. A count limit alone does not bound bytes: even the rate-limited circle-icon URL gives about 16 hours of streaming per day per account, and `createCircle` has no rate limit. The TB/day and cost figures are the reviewer's bandwidth estimates and were not measured live.

**Recommendation.**

1. Add `enforceRateLimit(ctx, "uploadUrl", me)` (for example 60/h plus a daily cap) to `puzzles.ts`, and log every URL mint with `member_id`.
2. For a hard byte bound, accept uploads through an authenticated `httpAction` that streams the body, aborts past `MAX_IMAGE_UPLOAD_BYTES`, checks magic bytes, calls `ctx.storage.store`, and inserts an `uploads` row `{uploaderId, storageId, createdAt}`. That row also makes the SEC-01 claim provable.
3. Add a daily sweep over `ctx.db.system.query("_storage")` (or over unclaimed `uploads` rows) that deletes blobs older than about 24 h that nothing references and that are not CSAM-preserved. Read SEC-92 first: today's `isReferenced` misses `mapFileId`, legacy `completions.photos` and never-attached `boxArtUploads`.
4. Track unclaimed uploads per member and refuse new URLs above about 20.

**Verification.** Repro tests (GAP2-1, GAP2-2, GAP2-3) plus code trace (CONV-4). The Convex upload limits were confirmed by read-only fetches of docs.convex.dev.

<details><summary>Condensed repro (convex-test)</summary>

```ts
await expect(t.mutation(api.puzzles.generateUploadUrl, {})).rejects.toThrow(
  /Unauthenticated/,
); // anon refused (good)
for (let i = 0; i < 500; i++)
  urls.add(await asAttacker.mutation(api.puzzles.generateUploadUrl, {}));
expect(urls.size).toBe(500);
expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(
  0,
);
// sibling: generateCircleIconUploadUrl throws RateLimited on the 21st call in an hour

// an unclaimed >10 MB octet-stream blob survives 30 days of both daily crons:
vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
await t.mutation(
  internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
  {},
);
await t.mutation(
  internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
  {},
);
expect((await t.run((ctx) => ctx.db.system.get(junk)))!.size).toBeGreaterThan(
  MAX_IMAGE_UPLOAD_BYTES,
);
// GAP2-3: the 11th setCircleIcon throws RateLimited (blob kept), an hour later it is UploadExpired (blob still kept)
```

</details>

---

### SEC-21 — `extractFromUrl` has no rate limit, so any member can drain Firecrawl credits

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Catalog · **Merged from:** CAT-3

**Description.** `extractFromUrl` is a public action. It only checks that _some_ Clerk identity is present, not `requireMember` (`convex/catalog/extractFromUrl.ts:45-52`), and it never calls `enforceRateLimit`. `RATE_LIMITS` has no catalog entry.

The fetcher chain falls through to the paid Firecrawl API, using the server's key (`convex/catalog/adapters/firecrawlStorePageFetcher.ts:31`), in two cases (`domain/catalog/application/make-fallback-store-page-fetcher.ts:11-16`, `:76-84`):

- both ogie and the browser tier fail with a retryable code, or
- a tier succeeds but finds no image.

Failed fetches and empty drafts are never cached (`domain/catalog/application/use-cases/import-puzzle-from-url.ts:64-65`, `:79-81`). Each call can use about 45 s of Node action time.

**Exploit scenario.** A free account loops `extractFromUrl({url: "https://attacker.example/403?i=" + n})`. Each call fails both cheap tiers and spends one Firecrawl scrape credit. Within hours the Firecrawl plan is used up, URL import degrades for every member, and the operator pays for the action time.

**Recommendation.**

- Replace the identity-only check with `requireMember` through an internal query, as `importPuzzleImage` does.
- Add a per-member limit (for example `urlImport` 30/h), enforced by a small internal mutation before any fetch.
- Add a deployment-wide Firecrawl budget modelled on `chargeMapTilerBudget`.
- Cache failures for a short TTL.

**Verification.** Repro test with stubbed DNS and `fetch` (no network).

<details><summary>Condensed repro (convex-test)</summary>

```ts
// fetch stub: attacker-shop.com -> 403; api.firecrawl.dev -> 402. The caller has NO users row.
const caller = t.withIdentity({ subject: "clerk_no_row" });
for (let i = 0; i < 30; i++)
  await caller.action(api.catalog.extractFromUrl.extractFromUrl, {
    url: `https://attacker-shop.com/403?i=${i}`,
  });
expect(calls(fetchMock, "api.firecrawl.dev")).toBe(30); // one paid scrape per call
expect(calls(fetchMock, "attacker-shop.com")).toBe(60); // ogie + browser tier
expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(
  0,
);
```

</details>

---

### SEC-22 — Anonymous contact and doc-feedback writes: no throttle, unbounded `locale`, admin inbox collects the whole table

**Severity:** Medium · **Status:** Confirmed (repro in five slices) · **Area:** Contact / docs · **Merged from:** IDENT-2, CAT-6, ADMIN-5, SURF-5, PRIV-2

**Description.** `submitContactMessage` and `submitDocFeedback` are intentionally public, unauthenticated mutations. Neither has a throttle or a bot check; no captcha, Turnstile or honeypot exists anywhere in the codebase. Rate limits are keyed per member, so an anonymous caller has nothing to key on anyway.

`name`, `email`, `message`, `slug` and `comment` are capped, but `locale: v.optional(v.string())` is not, and it is stored verbatim (`convex/contact/submitContactMessage.ts:28`, `:45-53`; `convex/docs/submitDocFeedback.ts:17`). The admin reads run an unpaginated `.order("desc").collect()` over the whole table (`convex/contact/listContactMessages.ts:14`, `convex/docs/listDocFeedback.ts:14`). No cron or delete path ever removes `contactMessages`, which hold visitors' names and emails. The privacy policy lists contact data as collected but gives no retention period (`apps/web/locales/en.json:1277`). A Vercel WAF would not help, because callers hit the Convex deployment directly.

**Exploit scenario.** An anonymous script submits about 20 contact messages with a 900 KB `locale`, or a few thousand 5 KB messages. `listContactMessages` then goes past Convex's per-function read limit. The admin contact inbox, which is also the DSA redress and GDPR request channel, stops loading until rows are deleted by hand. Storage grows without bound. `listDocFeedback` fails the same way.

**Recommendation.**

- Restrict `locale` to the supported literals (`v.union(v.literal("en"), v.literal("nl"))`) or cap it at about 10 characters.
- Add a deployment-wide fixed-window budget in the `rateLimits` table (for example `contact:global:hour`). Put a server-verified Turnstile token in front through an action, or route the form through a Vercel server function that limits by IP.
- Paginate both admin reads on the existing `by_status`/`by_slug` indexes.
- Add a retention cron (handled contact messages deleted after N months) and state the period in the policy.
- See also SEC-78 (`mailto:` injection in the same inbox).

**Verification.** Repro tests (IDENT-2, CAT-6, ADMIN-5, SURF-5, PRIV-2). The read-limit failure is inferred, because `convex-test` does not enforce read limits.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// no identity at all
await t.mutation(api.contact.submitContactMessage.submitContactMessage, {
  name: "Spam",
  email: "spam@example.com",
  subject: "other",
  message: "A perfectly reasonable message.",
  locale: "x".repeat(900_000),
});
for (let i = 0; i < 200; i++)
  await t.mutation(api.contact.submitContactMessage.submitContactMessage, {
    ...base,
    locale: "en",
  });
await t.mutation(api.docs.submitDocFeedback.submitDocFeedback, {
  slug: "x",
  helpful: true,
  locale: "A".repeat(900_000),
});
const inbox = await t
  .withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } })
  .query(api.contact.listContactMessages.listContactMessages, {});
expect(inbox).toHaveLength(201); // one unpaginated read; 25 x 900 KB rows exceed 16 MiB (ADMIN-5, CAT-6)
```

</details>

---

### SEC-23 — Follow and follow-request loops flood a target with notifications and email; no rate limit

**Severity:** Medium · **Status:** Confirmed (repro, two slices) · **Area:** Social / notifications · **Merged from:** SOC-5, NOTIF-2, SURF-6 (follow part)

**Description.** `followMember`, `unfollowMember` and `cancelFollowRequest` call no `enforceRateLimit`, and `RATE_LIMITS` has no follow entry.

- **Private targets.** Cancelling a _pending_ request deletes it outright (`domain/social/application/use-cases/cancel-follow-request.ts:33-37`). The next request creates a fresh `FollowRequest` and publishes `FollowRequested` again (`request-follow.ts:72-80`). The subscriber turns each one into an ungrouped, unread `follow_request_received` (`convex/notifications/subscriber.ts:560-575`) without checking that the request is still pending. In-app notifications default to on.
- **Public targets.** Follow/unfollow loops emit `new_follower`. The in-app row is grouped, but email and push go out once per event with a fresh idempotency key; only message types are throttled (`convex/notifications/adapters/channels/inAppChannel.ts:20-34`, `emailChannel.ts:19-48`).
- **Readers.** `unreadCount` `.collect()`s every unread row (`convex/notifications/unreadCount.ts:11-16`). `markAllReadForUser` `.collect()`s every notification the member has ever received and patches the unread ones in one mutation (`convex/notifications/adapters/convexNotificationRepository.ts:58-79`).
- **No pruning.** No cron removes old notifications.

**Exploit scenario.** Script `followMember(victim)` → `cancelFollowRequest(id)` against a private member. Each cycle adds an unread row, plus an email and a push if the victim opted in. After enough cycles, the bell count and "mark all read" exceed Convex read and write limits and throw. Combined with a 1 MB display name (SEC-14), far fewer cycles are needed. Blocking stops one account, but sign-up is open, and the victim's own block toggle is capped at 30 per day.

**Recommendation.**

- Add per-member buckets for follow, unfollow, request and cancel (for example 30/h), and a cooldown before re-requesting after a cancel. Keeping a cancelled pending request as a tombstone also fixes SEC-39.
- Collapse `follow_request_received` per (requester, target) pair, and throttle email and push for `new_follower`/`follow_request_received` per actor, like `PUSH_THROTTLE_MS`.
- Skip notifications for requests that are no longer pending.
- Bound `unreadCount` (`.take(100)`, then show "99+") and batch `markAllRead` through the scheduler. Add retention for old read notifications.

**Verification.** Repro tests (SOC-5, NOTIF-2). The read-limit breakage is inferred, not executed.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// victim: private profile, opted in to follow_request_received email
for (let i = 0; i < 40; i++) {
  const r = await asAttacker.mutation(api.social.followMember.followMember, {
    followeeId: victim,
  }); // kind "requested", new id
  await asAttacker.mutation(
    api.social.cancelFollowRequest.cancelFollowRequest,
    { requestId: r.id },
  );
  await flush(t);
}
expect(
  requests.filter((n) => n.type === "follow_request_received"),
).toHaveLength(40);
expect(
  await asVictim.query(api.notifications.unreadCount.unreadCount, {}),
).toBe(40);
expect(await scheduledEmailsTo(t, victim)).toHaveLength(40);
expect(
  await t.run((ctx) => ctx.db.query("followRequests").collect()),
).toHaveLength(0); // notified about cancelled requests
// public target: 25 follow/unfollow cycles -> 1 grouped in-app row but 25 scheduled emails
```

</details>

---

### SEC-24 — A propose/cancel loop floods a victim's inbox for good; inbox reads are unbounded

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Conversation / exchange / household · **Merged from:** CONV-1, SHARE-5

**Description.**

- `getMyInbox` `.collect()`s every `threadParticipants` row of the caller (`convex/conversation/getMyInbox.ts:393-396`), then does about 13 more `db` calls per exchange thread, with no page or cap. `getUnreadTotal`, the app-shell badge, does 2 per thread (`convex/conversation/getUnreadTotal.ts:19-34`).
- The conversation subscriber opens one thread per exchange (`convex/conversation/subscriber.ts:62-69`).
- `propose` has no rate limit, and its only de-duplication matches status `proposed` (`convex/exchange/adapters/convexExchangeRepository.ts:44-53`). So propose → cancel creates a new thread with the owner every cycle, and each cycle also sends a `trade_request` notification, plus email for opted-in owners.
- There is no member-facing hide, archive or delete for threads. A block stops new proposals but leaves the existing threads listed.
- Household invites have the same missing limit: invite → revoke resets the "one pending invite" rule immediately, with no contact rule and no cooldown (`convex/household/inviteToHousehold.ts:14-62`, `domain/household/application/use-cases/revoke-household-invite.ts:24`).

**Exploit scenario.** Find a public member's open copy and run `propose` → `cancel` about 620 times. At 13.1 `db` calls per thread, `/messages` exceeds Convex's roughly 4,096-call per-function limit after about 310 threads; the badge breaks after about 2,000. The victim cannot remove the threads, and a new sign-up gets around a block. Recovery requires manual data work by the operator.

**Recommendation.**

- Paginate the inbox on `threadParticipants.by_member_activity` with a page cap. Have `getUnreadTotal` read a bounded window or a denormalized per-member counter.
- Add per-member buckets for `exchangePropose`/`cancel` and `householdInvite`, a per-pair cap on recent exchanges, and a re-invite cooldown after revoke or decline (as circles have).
- Give members a way to hide or archive threads.

**Verification.** Repro test with `db` call counting. The read-limit threshold is derived from the documented limit, not observed.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// owner: public profile, one copy offered for sale, opted in to trade_request email
for (let i = 0; i < 60; i++) {
  const exchangeId = await attacker.mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: s.copy,
    salePrice: 10,
  });
  await attacker.mutation(api.exchange.cancel.cancel, { exchangeId }); // frees the dedupe slot
}
await flush(t);
expect(threadsOfOwner).toHaveLength(60);
// counted with a Proxy around ctx.db: getMyInbox 787 calls (13.1 / thread), getUnreadTotal 122 (2.0 / thread)
expect(tradeRequestEmailsScheduled).toBe(60);
```

</details>

---

### SEC-25 — DM and exchange message emails are sent one per message, with no per-recipient throttle

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Notifications · **Merged from:** CONV-2

**Description.** For DM and exchange threads, every member-authored message becomes a `message_received` with default channels. Only circle threads get the digest-only channel set (`convex/notifications/subscriber.ts:380-392`). The email channel refuses only non-digest circle messages (`convex/notifications/adapters/channels/emailChannel.ts:23-28`). Push is throttled per thread (`pushChannel.ts:18`, 2 minutes), but email is not; `inAppChannel.ts:38-41` says outright that email and push stay one delivery per event. The only brake is the sender's `messagePost` limit of 30 per minute (`convex/lib/rateLimits.ts:12`), which allows about 1,800 emails an hour from one sender to one recipient.

**Exploit scenario.** An attacker reaches a victim who has message email on, for example through one exchange proposal (SEC-24), and posts 30 messages a minute. The victim gets an AhaSend email per message until they mute or block. Across several accounts and victims this burns AhaSend quota and draws spam complaints, which damage the sender reputation used for all transactional mail.

**Recommendation.** Add a per-thread, per-recipient email throttle for `message_received`, similar to push's `lastPushedAt` (for example one email per thread per N minutes while the previous one is unread), or reuse the circle digest for DMs. Add a per-recipient daily email cap as a backstop.

**Verification.** Repro test.

<details><summary>Condensed repro (convex-test)</summary>

```ts
await victim.mutation(
  api.notifications.updateNotificationPreference.updateNotificationPreference,
  { type: "message_received", channel: "email", enabled: true },
);
await attacker.mutation(api.exchange.propose.propose, {
  type: "sale",
  requestedPuzzleId: s.copy,
  salePrice: 10,
}); // opens a thread
for (let i = 0; i < 30; i++)
  await attacker.mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: `spam ${i}`,
  });
await flush(t);
expect(
  scheduledSendEmail.filter((j) => j.args[0].type === "message_received"),
).toHaveLength(30);
await expect(
  attacker.mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "31",
  }),
).rejects.toThrow();
```

</details>

---

### SEC-26 — Catalog submissions and proposals: no limit, no size caps, every admin notified; admin queue unbounded

**Severity:** Medium · **Status:** Confirmed (repro) · **Area:** Catalog / admin · **Merged from:** CAT-5, ADMIN-9

**Description.**

- `submitPuzzleDefinition` and `proposeDefinitionChange` have no rate limit (`convex/catalog/submitPuzzleDefinition.ts:24-71`, `convex/catalog/proposeDefinitionChange.ts:124-157`).
- The only text rule is a non-empty title (`domain/catalog/domain/puzzle-definition.ts:101-140`). Description, tags, brand and comment are bounded only by Convex's 1 MiB document limit.
- Each `PuzzleDefinitionSubmitted` and `ChangeProposalFiled` sends an in-app notification to every admin (`convex/notifications/subscriber.ts:192-201`, `:483-518`), plus push if they enabled it. `admin_*` types are not email-eligible.
- The "one open proposal per member and definition" rule can be cycled endlessly with withdraw and re-file.
- `listPendingPuzzleDefinitions` does a full-table `.filter().collect()` and returns raw rows (`convex/catalog/listPendingPuzzleDefinitions.ts:15-19`).
- Pending rows are also scanned by the public facet streams (`getAllBrands` and siblings), which filter out non-approved rows only after reading them (`convex/catalog/getAllBrands.ts:13-19`).

**Exploit scenario.** A member submits thousands of definitions with 200 KB descriptions and unique brands. Admins get thousands of notifications, the moderation queue throws on read limits (about 80 rows of that size), and the public brand facet slows down or fails for everyone.

**Recommendation.**

- Add per-member limits (for example `catalogSubmit` 20/day, `proposalFile` 30/day).
- Cap string lengths in the domain aggregate (title ≤ 200, description ≤ 5,000, tags ≤ 20 × 50, comment ≤ 2,000).
- Paginate the pending queue on a status index, and add a status-prefixed index for the facet streams.
- Group admin review notifications.

**Verification.** Repro test. The read-limit failure is inferred.

<details><summary>Condensed repro (convex-test)</summary>

```ts
for (let i = 0; i < 40; i++)
  await attacker.mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    {
      title: `Junk ${i}`,
      brand: `Brand ${i}`,
      pieceCount: 1000,
      description: "x".repeat(200_000),
      tags: manyTags /* 500 */,
    },
  );
for (let i = 0; i < 15; i++) {
  // withdraw / re-file cycling
  const id = await attacker.mutation(
    api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    {
      puzzleDefinitionId: approvedId,
      title: `Spam ${i}`,
      comment: "c".repeat(100_000),
    },
  );
  await attacker.mutation(
    api.catalog.withdrawChangeProposal.withdrawChangeProposal,
    { changeProposalId: id },
  );
}
// admin: 40 admin_definition_submitted + 15 admin_proposal_filed notifications; rateLimits empty;
// listPendingPuzzleDefinitions returns all 40 raw rows (~8 MB) in one read
```

</details>

---

### SEC-27 — `users.updateUserProfile` bypasses the 80-character location cap; bio, location and language are unbounded

**Severity:** Medium · **Status:** Confirmed (repro, two slices) · **Area:** Identity · **Merged from:** IDENT-1, SURF-3 (users part)

**Description.** `updateUserProfile` takes `bio`, `location` and `preferredLanguage` as bare `v.string()` and patches them straight onto the caller's row (`convex/users.ts:110-123`). `setLocation` caps the same `users.location` field at 80 characters (`convex/identity/setLocation.ts:7`, `:17-19`), but this second public write path skips the cap. It is also the path the profile editor uses (`apps/web/src/components/profile/edit-profile-form.tsx:226`, input without `maxLength`).

`toMemberView` sends all three fields to other members (`convex/identity/toMemberView.ts:12-14`). The bloated rows are then read by:

- `listRecentPublicMembers`, the 50 newest users (`convex/identity/listRecentPublicMembers.ts:21-24`);
- `getPublicProfile`, which returns `location` to anonymous visitors (`convex/social/getPublicProfile.ts:120`);
- `getGlobalStats`, which collects every `users` row with no auth (`convex/insights/getGlobalStats.ts:10`) and which the home route loader awaits;
- `getCommunityAvatars`, the 200 newest users.

**Exploit scenario.** About 17 sign-ups each store about 950 KB in bio and location. `listRecentPublicMembers` (Find people) and the landing-page `getGlobalStats` exceed the per-function read limit for everyone until enough real sign-ups push those rows out. Each anonymous load of the attacker's public profile ships about 0.5 MB.

**Recommendation.**

- Apply `setLocation`'s rules here (trim, 80 characters).
- Restrict `preferredLanguage` to the supported locale union.
- `users.bio` is no longer shown in the UI (`profiles.bio` replaced it), so drop it from the args and from `toMemberView`.
- Simpler still: remove `updateUserProfile` and add a narrow `setPreferredLanguage` mutation, since the web only uses it for language and location.
- Replace the full-table `getGlobalStats` with a maintained counter (see SEC-49).

**Verification.** Repro tests. The read-limit failure is inferred.

<details><summary>Condensed repro (convex-test)</summary>

```ts
await expect(
  asMallory.mutation(api.identity.setLocation.setLocation, {
    location: "x".repeat(81),
  }),
).rejects.toThrow(ConvexError);
await asMallory.mutation(api.users.updateUserProfile, {
  bio: "A".repeat(500_000),
  location: "B".repeat(450_000),
  preferredLanguage: "C".repeat(10_000),
});
const m = (
  await asAlice.query(
    api.identity.listRecentPublicMembers.listRecentPublicMembers,
    {},
  )
).find((r) => r._id === mallory);
expect(m?.bio?.length).toBe(500_000);
expect(m?.location?.length).toBe(450_000);
expect(
  (
    await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: mallory,
    })
  )?.hero.location?.length,
).toBe(450_000); // anonymous
```

</details>

---

### SEC-28 — Photo comments and puzzle reviews: no caps, no rate limit, unbounded reads, no delete or report path

**Severity:** Medium · **Status:** Confirmed (repro, three slices) · **Area:** Library / social · **Merged from:** LIB-6, SOC-13, SURF-3 (review and comment part)

**Description.**

- `CommentText.create` only rejects empty text (`domain/social/domain/comment-text.ts:10-16`). `postPhotoComment` has no rate limit and gates only on `canViewCopy`, without checking the photo's moderation status (`convex/library/postPhotoComment.ts:24-59`).
- `listPhotoComments` `.collect()`s every comment on a photo (`convex/library/listPhotoComments.ts:30-34`) and returns each author as a full `toMemberView` (SEC-11).
- No mutation deletes a photo comment except the account purge. Deleting the whole photo hides its comments but leaves the rows orphaned.
- `reports.targetKind` has no photo-comment or review kind (`convex/schema.ts:1982-1990`), so neither can be reported.
- Puzzle reviews: `postPuzzleReview` validates only the 1-5 rating. It does not check that the definition exists or is approved, or that the reviewer owns or solved the puzzle, and the text is unbounded (`convex/social/postPuzzleReview.ts:16-38`, `domain/solving/application/use-cases/upsert-puzzle-review.ts:23-46`).
- The public, indexable `listPublicPuzzleReviews` and `ratingBreakdownOf` (used per card in `browsePublicCatalog`) collect every review of a puzzle (`convex/library/definitionAggregates.ts:87-94`).

**Exploit scenario.**

- A harasser posts thousands of large comments on a member's public copy photo. The owner cannot delete them, nobody can report them, and once past read limits the photo discussion fails for everyone.
- A handful of throwaway accounts post near-1 MB one-star reviews with SEO spam on popular puzzles. Logged-out visitors see them on the catalog page, and enough of them break the first catalog page and the puzzle's detail pages.

**Recommendation.**

- Cap comment and review text in the domain (for example 1,000 and 2,000 characters).
- Add rate-limit buckets for comments and reviews.
- Paginate `listPhotoComments`, `listPublicPuzzleReviews` and the rating aggregates (or denormalize the counters).
- Let the author, the copy owner and admins delete comments, and let authors delete their own reviews.
- Add `photoComment` and `puzzleReview` report target kinds.
- Require an approved definition (and optionally ownership or a completion) before a review is accepted.

**Verification.** Repro tests (LIB-6, SOC-13, SURF-3).

<details><summary>Condensed repro (convex-test)</summary>

```ts
for (let i = 0; i < 50; i++)
  await as(t, "mallory").mutation(
    api.library.postPhotoComment.postPhotoComment,
    { photoId, text: "A".repeat(50_000) },
  );
expect(
  await as(t, "alice").query(api.library.listPhotoComments.listPhotoComments, {
    photoId,
  }),
).toHaveLength(50);

// spammer owns nothing and never solved the puzzle
await asSpam.mutation(api.social.postPuzzleReview.postPuzzleReview, {
  puzzleId: approved,
  rating: 1,
  text: "BUY CHEAP PUZZLES ".repeat(20_000),
});
await asSpam.mutation(api.social.postPuzzleReview.postPuzzleReview, {
  puzzleId: pending,
  rating: 1,
  text: "on a pending definition",
});
expect(
  (
    await t.query(api.social.listPublicPuzzleReviews.listPublicPuzzleReviews, {
      puzzleId: approved,
    })
  )[0].text.length,
).toBe(679_999); // anonymous
```

</details>

---

### SEC-29 — Browse reads the oldest 500 open copies, so one member can freeze it; definition pages scan without a bound

**Severity:** Medium · **Status:** Confirmed (repro for the freeze; code trace for the read-limit breakage) · **Area:** Library · **Merged from:** LIB-3

**Description.** Unfiltered Browse runs `ctx.db.query("ownedPuzzles").filter(open).take(500)` in ascending `_creationTime` order. It only sorts newest-first and paginates afterwards (`convex/library/browseOwnedPuzzles.ts:79-94`). `.take` bounds the rows returned, not the rows scanned.

`acquireCopy` and `acquireCopies` have no rate limit and no per-member copy cap, and batches de-duplicate only within one call. `getPuzzleDefinitionView` and the unauthenticated `getPublicDefinitionView` collect every copy of a definition and run one `completions` query per copy (`convex/library/definitionAggregates.ts:134-143`, `convex/catalog/getPublicDefinitionView.ts:34-45`).

The freeze also happens on its own once the site has more than 500 open copies.

**Exploit scenario.**

- _Freeze:_ about 20 `acquireCopies` calls of 25 open copies fill the oldest-500 window. Every open copy created afterwards never shows in unfiltered Browse.
- _Breakage:_ tens of thousands of closed copies make Browse scan the whole table and fail. Thousands of copies of one popular definition break its `/puzzles/<id>` page and its public catalog page.

**Recommendation.**

- Source Browse from an index on availability, ordered newest first (a denormalized `isOpen` + `createdAt` index), with cursor pagination.
- Rate-limit `acquireCopy` and `acquireCopies` (count items), and cap copies per member and per member per definition.
- Bound the per-definition aggregates with denormalized counters, or `.take()` with an "N+" display.

**Verification.** Repro test for the freeze.

<details><summary>Condensed repro (convex-test)</summary>

```ts
for (let b = 0; b < 20; b++)
  await as(t, "mallory").mutation(api.library.acquireCopies.acquireCopies, {
    items: puzzles.map((p) => ({
      puzzleDefinitionId: p.aggregateId,
      forTrade: true,
    })),
  }); // 500 open copies
const aliceCopy = await acquire(t, "alice", puzzles[0].aggregateId);
await as(t, "alice").mutation(api.library.updateCopySharing.updateCopySharing, {
  copyId: aliceCopy.agg,
  visibility: "visible",
  forTrade: true,
});
const unfiltered = await as(t, "bob").query(
  api.library.browseOwnedPuzzles.browseOwnedPuzzles,
  { limit: 1000 },
);
expect(unfiltered.total).toBe(500);
expect(unfiltered.ownedPuzzles.some((c) => c._id === aliceCopy.id)).toBe(false); // never shown
// puzzleId-filtered Browse (by_puzzle index) does show it
```

</details>

---

### SEC-30 — One free account can wipe every member's activity feed (global newest-500 window) and multiply read cost

**Severity:** Medium · **Status:** Confirmed (repro; the cost fan-out half is plausible, code trace only) · **Area:** Social / feed · **Merged from:** GAP3-1, GAP3-2

**Description.** `getActivityFeed` reads the newest 500 `domainEvents` rows _per event name, platform-wide_ (`convex/social/getActivityFeed.ts:97-107`). Only afterwards does it filter to the viewer's audience, drop backfill and future-dated solves (`:434`, `:441`) and fold batches. Anyone can push everyone else's events out of the window by emitting 500 newer events of the same name, and nothing pages past the cap.

None of the producers is rate-limited:

- `acquireCopies` (25 copies per call, one event row each);
- `recordPastCompletions` (25 per call, re-usable on the same copies, all marked `bulk` so nobody sees them; `convex/solving/recordPastCompletions.ts:83`);
- `recordCompletion`, where both `copyId` and puzzle are optional (`convex/solving/recordCompletion.ts:51-52`), so a far-future start emits a hidden `CompletionStarted` without owning anything;
- `startCompletion`.

`occurredAt` is the server clock, so flood events always land at the head of the window.

Cost side: every execution reads about 2,000 rows (plus up to 500 exchange lookups made before the audience check). The read set is the global head of each range, so every producer write, and every dispatcher `processedAt` patch, invalidates every live feed subscription (the dashboard pulse holds one per signed-in member).

Recovery is not possible today. The deletion purge rewrites payloads but keeps the rows, and `domainEvents` has no retention (SEC-71).

**Exploit scenario.** About 540 scripted calls (20 × `acquireCopies`, 20 × `recordPastCompletions`, 500 × copy-less `recordCompletion` with a +10-year start) leave every member's dashboard pulse and `/people` feed empty, including their own activity. None of it shows to anyone but the attacker. Repeating a short burst every few minutes keeps feeds blank, and banning the account does not bring them back.

**Recommendation.**

- Build the feed per actor: add an `actorId` column with a `by_actor_and_time` index, or write a denormalized per-member activity table from the dispatcher. A flooder then only fills their own slice, and a write invalidates only the actor's followers' subscriptions.
- Interim: keep feed-ineligible events out of the range the feed reads (a separate event name or a `feedEligible` index field), and write one feed row per `acquireCopies` call.
- Add daily per-member caps on copies and solves, and require a copy or puzzle on `recordCompletion`.
- Check the audience before `loadExchange`, move dispatch bookkeeping off the feed rows, and give the notifications handler an explicit events list.

**Verification.** Repro test (GAP3-1). The reactive fan-out (GAP3-2) cannot be modelled in `convex-test` and rests on Convex's read-set semantics.

<details><summary>Condensed repro (convex-test)</summary>

```ts
// alice <-> bob mutual followers; bob: one batch add, one dated solve, one in-progress start (shareInProgress on)
expect(await kindsFromBob("alice")).toEqual([
  "acquisitionBatch",
  "completion",
  "started",
]);
for (let i = 0; i < 20; i++)
  await mallory.mutation(api.library.acquireCopies.acquireCopies, {
    items: defs.map((d) => ({ puzzleDefinitionId: d })),
  });
for (let i = 0; i < 20; i++)
  await mallory.mutation(
    api.solving.recordPastCompletions.recordPastCompletions,
    {
      items: malloryCopies.map((copyId) => ({
        copyId,
        datePrecision: "unknown",
      })),
    },
  );
for (let i = 0; i < 500; i++)
  await mallory.mutation(api.solving.recordCompletion.recordCompletion, {
    startDate: Date.now() + 10 * YEAR,
  });
// domainEvents: CopyAcquired 501, CompletionRecorded 501, CompletionStarted 501
expect(await kindsFromBob("alice")).toEqual([]); // friend's feed: nothing from bob
expect(aliceFeed).toHaveLength(0);
expect(await kindsFromBob("bob")).toEqual([]); // bob no longer sees his own activity
```

</details>

---

## 5. Hardening backlog (low and info)

These are real but lower-impact issues. Each row gives the defect, the key evidence and the fix. "Repro" means a convex-test or local repro passed during verification. Several rows are made worse by, or are fixed together with, a medium finding; those links are noted.

| ID     | Sev  | Status                             | Defect and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                                                                                                      |
| ------ | ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-31 | Low  | Confirmed (repro)                  | Household invites have no expiry. `accept` checks only invitee and pending status (`domain/household/domain/household-invite.ts:126`) and never re-checks the inviter (`domain/household/application/use-cases/accept-household-invite.ts:23-32`). Removal leaves invites alone, and join-request approval does not consume a pending invite. Repro: Bob invites a sockpuppet then leaves, and the sockpuppet joins Vic's household; a removed member rejoins with a leftover invite.                                                                   | 14-day expiry. On accept, require the inviter to still be admin (generic `InviteNotFound`). Withdraw invites on leave, remove or demote. Consume pending invites when the member joins by any path.                      |
| SEC-32 | Low  | Confirmed (repro)                  | The Clerk webhook upsert keeps no deleted-id tombstone, never compares `updated_at` and never de-duplicates svix ids (`convex/users.ts:149-191`, `convex/http.ts:27-55`). A late `user.updated` after `user.deleted` re-inserts an active row with the erased name and email (visible in search and "Recently joined"), or refills PII on a CSAM tombstone. A stale `users.role` mirror keeps admin-only email and push flowing (`convex/notifications/resolveForDelivery.ts:25`).                                                                      | Insert only on `user.created`. Drop events older than the stored `updatedAt`. Keep a `deletedClerkIds` tombstone. Never patch `isActive:false` rows. Reconcile roles periodically (`backfillUserRoles` on a cron).       |
| SEC-33 | Low  | Confirmed                          | Any active member can send email invites (no account age or verified-email check), 10/day each against a 60/h global Clerk budget. Once the budget is spent, real inviters still see "sent" (`convex/invitations/emailInviteStore.ts:36-60`, `convex/lib/rateLimits.ts:32`, `:162`, `convex/invitations/sendEmailInvite.ts:88-95`). The inviter name may contain a URL and appears in the subject.                                                                                                                                                      | Require account age or a verified email. Give new accounts a smaller allowance and cap each member's share of the global budget. Keep member text out of the subject and strip URL-like tokens. Alert on `clerk_budget`. |
| SEC-34 | Low  | Confirmed (repro)                  | `getPuzzleDefinitionView` has no status gate (`convex/library/getPuzzleDefinitionView.ts:36-37`, compare `convex/catalog/getPuzzleById.ts:23-28`). Browse search and copy views join raw puzzle text (`convex/library/mappers.ts:18-34`). Favorites accept and list any status (`convex/catalog/toggleFavorite.ts:15-16`, `listMyFavorites.ts:24-27`). Box art that passed its own moderation is served for rejected or disabled definitions too.                                                                                                       | Apply the `getPuzzleById` gate (approved, submitter or admin) in these reads. Show only the copy snapshot for non-approved definitions. Decide whether non-approved copies may be offered.                               |
| SEC-35 | Low  | Confirmed (repro)                  | The copy timeline includes unfinished solves (start date, solver) for any `canViewCopy` viewer (`convex/library/getCopyInstanceView.ts:159-169`). Elsewhere the rule is opt-in and friends-only (`convex/social/getActivityFeed.ts:157`).                                                                                                                                                                                                                                                                                                               | Build entries from completed solves, or include in-progress ones only for self, or when `shareInProgress` and mutual follow hold.                                                                                        |
| SEC-36 | Low  | Confirmed (repro)                  | An open loan is not a reservation (`convex/library/adapters/convexCopyReservationPort.ts:8`). `makeOpenLoan` does not check for an existing loan, and `transferTo` does not close loans. A second lend leaves two open loans, and the first borrower's return resets `heldBy` during the second.                                                                                                                                                                                                                                                        | Treat open loans as reservations. Close loans on transfer. Make return and recall no-ops when the loan is not the copy's current one.                                                                                    |
| SEC-37 | Low  | Confirmed (repro)                  | `getUserCollections({includePublic:true})` returns every public collection on the platform with owner ids and wishlists; it is unbounded and ignores blocks and private profiles (`convex/library/getUserCollections.ts:45-61`). `getCollectionById` also ignores blocks (`convex/library/getCollectionById.ts:21-27`). The web never sends `includePublic`.                                                                                                                                                                                            | Remove `includePublic`. Return nothing to a viewer the owner has blocked, as `getUserStats` does.                                                                                                                        |
| SEC-38 | Low  | Confirmed (repro)                  | After a transfer, `removeCopyPhoto` allows only `canManageCopy` (`convex/library/removeCopyPhoto.ts:23`), so the previous owner cannot remove photos of their home.                                                                                                                                                                                                                                                                                                                                                                                     | Let the uploader (`image.uploaderId === memberId`) remove their own photo.                                                                                                                                               |
| SEC-39 | Low  | Confirmed (repro)                  | A cancelled pending request is deleted, so a re-request gets a new id; a declined-in-cooldown request is reopened with the same id (`domain/social/application/use-cases/cancel-follow-request.ts:33-37`, `request-follow.ts:59-66`). This reveals the "silent" decline.                                                                                                                                                                                                                                                                                | Make both paths identical: tombstone the pending row (also helps SEC-23), or mint a fresh id on reopen.                                                                                                                  |
| SEC-40 | Low  | Confirmed (repro)                  | The chokepoint reveals members the viewer blocked (`convex/social/privacy.ts:303-311`), and lists drop blocked authors. Blocking a candidate and reloading confirms who an anonymous entry is (`blockToggle` allows 30/day).                                                                                                                                                                                                                                                                                                                            | Keep anonymous entries anonymous for the blocker (anonRef plus a "blocked" flag). Show names only in `listMyBlocks`.                                                                                                     |
| SEC-41 | Low  | Confirmed (repro)                  | `followersYouKnow` checks only the target's visibility (`convex/social/followersYouKnow.ts:39-44`, `knownFollowers.ts:58-61`), so a one-way follower of a private member can test whom they follow. Survives the SEC-13 fix.                                                                                                                                                                                                                                                                                                                            | Exclude members whose follow graph the viewer may not see.                                                                                                                                                               |
| SEC-42 | Low  | Confirmed (repro)                  | Network invite tokens never expire and can be reused. Accepting creates both follow edges, skipping a private owner's approval (`convex/social/acceptQrFollow.ts:20-34`). A forwarded link gives friend-level access indefinitely.                                                                                                                                                                                                                                                                                                                      | For private owners, turn the scan into a request or offer. Add expiry and a use count, or create only the scanner→owner edge.                                                                                            |
| SEC-43 | Low  | Confirmed                          | Completion and exchange feed entries are not gated by `canSeeProfileContent`, unlike acquisitions (`convex/social/getActivityFeed.ts:428-474` vs `:251`). One-way followers of a member who later went private keep seeing activity. This is intended per `activityFeedTargets.test.ts:175`.                                                                                                                                                                                                                                                            | Gate every entry kind per actor, or document the choice.                                                                                                                                                                 |
| SEC-44 | Low  | Confirmed (repro)                  | A missing profile row counts as public (`convex/social/privacy.ts:44`), so anonymous `getPublicProfile` returns location, stats and records. `noindex` is set only for private profiles (`apps/web/src/routes/members.$handle.tsx:96-98`), while `projectPublicAuthor` fails closed.                                                                                                                                                                                                                                                                    | Treat a missing row as locked on the anonymous path, or emit `noindex` unless visibility was chosen explicitly.                                                                                                          |
| SEC-45 | Low  | Confirmed                          | Accepting a circle invite checks blocks only between invitee and inviter (`domain/sharing/application/use-cases/accept-circle-invite.ts:31`), and co-members are shown across blocks. An admin who is a mutual follow can seat a victim with their blocker.                                                                                                                                                                                                                                                                                             | Refuse when the invitee is blocked either way with any current member, or correct the comment at `convex/sharing/addMember.ts:37`.                                                                                       |
| SEC-46 | Low  | Confirmed                          | Each member gets 60 picker views and 60 searches an hour, against a global 2,000/h and 20,000/day MapTiler budget (`convex/lib/rateLimits.ts:27-30`, `:91-92`). About 5 accounts switch location sharing off for everyone.                                                                                                                                                                                                                                                                                                                              | Lower the per-member allowance, add a daily cap, and reserve budget for final renders.                                                                                                                                   |
| SEC-47 | Low  | Confirmed                          | `posthog.init` uses defaults (autocapture on, no text masking) (`apps/web/src/lib/analytics-client.ts:22-28`). Clicking a link in a DM sends its href and text to PostHog, tied to an identity that includes the email (`apps/web/src/components/messaging/message-text.tsx:24-33`).                                                                                                                                                                                                                                                                    | Add `ph-no-capture` to the thread view, composer and inbox. Mask text on messaging routes, or disable autocapture there.                                                                                                 |
| SEC-48 | Low  | Confirmed                          | `listMyPendingAttachments`, `sendStagedImages` and `settleSendBatch` collect every attachment for (thread, uploader), delivered ones included (`convex/conversation/listMyPendingAttachments.ts:20-36`, `messageAttachments.ts:500-519`). Bounded by 100 stages a day.                                                                                                                                                                                                                                                                                  | Index on (thread, uploader, `messageId`/`sendRequestedAt`).                                                                                                                                                              |
| SEC-49 | Low  | Confirmed (repro for feed limit)   | Client-controlled sizes are not clamped: `getRecentPuzzles` (`.filter` + `take(limit)`, anonymous, `convex/catalog/getRecentPuzzles.ts:12-17`), `browsePublicCatalog`/`listAllPuzzles` `numItems` with per-row fan-out (`convex/catalog/browsePublicCatalog.ts:19-26`, `:88-110`), `getPuzzleSuggestions`, `getThreadMessages` (`convex/conversation/getThreadMessages.ts:31`, `:43`), and `getActivityFeed` `limit` (`:77`, `:183-185`). Anonymous full collects in `getGlobalStats`, `getExchangeStats` (unused by the web) and `listSitemapEntries`. | Clamp server-side as `listThreadMessages` does (1..100). Use the `by_status` index instead of `.filter`. Maintain counters instead of collecting. Remove or admin-gate `getExchangeStats`.                               |
| SEC-50 | Low  | Confirmed (repro)                  | The `isPrivateIp` denylist misses 198.18/15, 224/4, 240/4, broadcast, NAT64 `64:ff9b::/96`, IPv4-compatible, SIIT and 6to4 forms (`domain/catalog/domain/is-private-ip.ts:5-41`).                                                                                                                                                                                                                                                                                                                                                                       | Use an allowlist (`ipaddr.js` `range() === "unicast"`) with unwrapping of embedded IPv4; add tests for each range.                                                                                                       |
| SEC-51 | Low  | Confirmed (repro)                  | The browser tier calls `arrayBuffer()` and only then truncates (`convex/catalog/adapters/browserStorePageFetcher.ts:171-178`). `importPuzzleImage` buffers the whole body before checking `MAX_BYTES` (`convex/catalog/importPuzzleImage.ts:81-87`). A 25 MB chunked body was read in full.                                                                                                                                                                                                                                                             | Read with a stream reader and cancel at the cap.                                                                                                                                                                         |
| SEC-52 | Low  | Confirmed (repro)                  | The barcode duplicate check counts rejected rows (`convex/catalog/adapters/convexPuzzleDefinitionRepository.ts:76-87`), and lookup takes `.first()` per EAN, returning null when the oldest row is not approved (`convex/catalog/findPuzzleByBarcode.ts:15-18`). Junk submissions squat EANs, even against admins.                                                                                                                                                                                                                                      | Ignore rejected rows in the duplicate check, index on `[ean, status]`, and release barcodes on reject.                                                                                                                   |
| SEC-53 | Low  | Confirmed                          | Eight read paths look up `by_clerk_id` without the `isActive` check (for example `convex/exchange/getUserExchanges.ts:30-36`, `convex/search/globalSearch.ts:47-51`). `extractFromUrl` checks only for an identity (`:45-52`). Exposure is tiny, since tombstones exist only during CSAM escalations.                                                                                                                                                                                                                                                   | Use `requireMember`/`optionalActingMember`. Add a lint rule against `withIndex("by_clerk_id"` outside `identity/`.                                                                                                       |
| SEC-54 | Low  | Confirmed                          | Sign-out does not unregister push (`apps/web/src/components/dashboard-layout/shell-user-button.tsx:193`), and there is no device list to revoke from. DM previews keep reaching a shared browser (`convex/notifications/copy.ts:107-108`).                                                                                                                                                                                                                                                                                                              | Unsubscribe and unregister before Clerk `signOut`. Add a device list with revoke. Consider a "hide previews" preference.                                                                                                 |
| SEC-55 | Low  | Confirmed (repro)                  | `hashCheckPendingSince` is cleared only on `no_match` (`convex/lib/imageModeration/pipeline.ts:613`). Refused and quarantined rows stay in the index, and `listCsamEscalations` reads `.take(200)` before filtering (`convex/admin/listCsamEscalations.ts:83-86`), so it reports 0 waiting photos.                                                                                                                                                                                                                                                      | Clear the field whenever a row leaves the waiting state, and filter before `take`.                                                                                                                                       |
| SEC-56 | Low  | Confirmed                          | `recheckPhoto`, catalog category create/update/activate/reorder and `markContactMessageHandled` do not call `stampModerationAction` (`convex/admin/recheckPhoto.ts:35-98`, `convex/catalog/createCatalogCategory.ts:16-25`).                                                                                                                                                                                                                                                                                                                            | Stamp them with new action kinds, keeping the enum sync points in mind.                                                                                                                                                  |
| SEC-57 | Low  | Confirmed                          | Moderation audit rows store `targetLabel` = name, falling back to email (`convex/admin/decideReport.ts:108-114`, `convex/admin/roleChange.ts:58-64`, `convex/identity/memberDisplayName.ts:28-35`). The purge never touches `moderationActions`, so labels outlive account deletion.                                                                                                                                                                                                                                                                    | Store the id only and resolve the label at read time, or scrub labels in the purge. Never fall back to email.                                                                                                            |
| SEC-58 | Low  | Confirmed (live)                   | Production responses carry only HSTS (`max-age=63072000`, no `includeSubDomains`). There is no CSP, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy or Permissions-Policy, and the repo sets none (`apps/web/vercel.json:1-9`, `apps/web/vite.config.ts:47-55`).                                                                                                                                                                                                                                                                              | Add `X-Frame-Options: DENY` with `frame-ancestors 'none'`, nosniff, `Referrer-Policy`, a minimal `Permissions-Policy`, and HSTS with `includeSubDomains`. Roll out a CSP in report-only mode first.                      |
| SEC-59 | Low  | Confirmed                          | PostHog `identify` sends email and username (`apps/web/src/components/analytics-page-view.tsx:36-39`), and `$current_url` includes the query string, so `?invite=` tokens are captured (`:22-30`). Nothing calls `reset()`, nothing deletes the PostHog person on account deletion, and there is no way to withdraw consent in the app (`apps/web/src/components/blocks/cookie-consent.tsx:73-85`). The banner does not mention analytics (`apps/web/locales/en.json:1503`), and the policy does not disclose identity data (`en.json:1283`).           | Identify by opaque id only. Strip the query string in `before_send`. Call `reset()` on sign-out. Delete the person on `user.deleted`. Add a withdraw toggle that calls `opt_out_capturing()`. Rewrite the banner.        |
| SEC-60 | Low  | Confirmed (config)                 | The production deploy job checks only `event_name` and `conclusion` (`.github/workflows/convex-deploy.yml:124-126`) and checks out `head_sha` (`:137`). A fork PR from a branch named `main` matches. Mitigated today because the stale-commit guard runs before any repo code and the fork-PR approval policy is `all_external_contributors`.                                                                                                                                                                                                          | Add `github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository`. Put `CONVEX_DEPLOY_KEY_PROD` in a protected Environment.                                    |
| SEC-61 | Low  | Confirmed (config)                 | `pnpm/action-setup@v4` runs on a mutable tag in jobs that later receive the deploy keys (`.github/workflows/convex-deploy.yml:69`, `:157`, `convex-preview.yml:88`). `npx --yes vercel@62.2.0` runs with `VERCEL_TOKEN` and no lockfile (`vercel-preview.yml:91`). (The default token permission is already read-only.)                                                                                                                                                                                                                                 | Pin every `uses:` by SHA and let Renovate or Dependabot bump them. Install the Vercel CLI as a lockfile devDependency. Add explicit `permissions: contents: read`.                                                       |
| SEC-62 | Low  | Confirmed                          | The `fetchClerkAuth` GET server fn returns the Convex JWT, which is dehydrated into SSR HTML (`apps/web/src/routes/__root.tsx:30-34`, `:132`), and both are served with `Cache-Control: public, max-age=0, must-revalidate`. TanStack's CSRF middleware is not active (`apps/web/src/start.ts:7`). `clerkMiddleware()` has no `authorizedParties`. No current impact.                                                                                                                                                                                   | Send `private, no-store` on signed-in responses and server fns. Add `createCsrfMiddleware`. Set `authorizedParties`. Keep the JWT template lifetime short.                                                               |
| SEC-63 | Low  | Confirmed (audit)                  | `pnpm audit --prod` reports 52 advisories (23 high, 22 moderate, 7 low). seroval 1.6.9 is the SSR serializer (not reachable, since Convex values carry no RegExp or typed arrays). The undici override resolves to 7.28.0, below the fixes (`pnpm-workspace.yaml:49`), and the js-yaml override is below 3.15.2 (`:52`).                                                                                                                                                                                                                                | Bump TanStack Start/Router so seroval is ≥ 1.6.11. Raise the overrides (undici ^7.30.1, js-yaml ^3.15.2 and ^4.3.2). Consider `cheerio/slim`. Add a non-blocking audit to CI.                                            |
| SEC-64 | Low  | Confirmed (live)                   | The policy's processor list (`apps/web/locales/en.json:1462`) omits AhaSend, which receives addresses, names, DM previews and invitee addresses, and Firecrawl, which receives submitted URLs. DM previews (80 characters) go to email and push with no toggle (`convex/notifications/resolveNotificationView.ts:567-570`, `packages/email/src/copy.ts:196`).                                                                                                                                                                                           | Name both processors. Add an "include message previews" preference, off by default for email.                                                                                                                            |
| SEC-65 | Low  | Confirmed (live)                   | Google Fonts preconnect and stylesheet links sit in the root head unconditionally (`apps/web/src/routes/__root.tsx:101-111`), so visitor IPs go to Google before any consent; this is not disclosed.                                                                                                                                                                                                                                                                                                                                                    | Self-host Baloo 2 and Poppins (@fontsource).                                                                                                                                                                             |
| SEC-66 | Low  | Confirmed                          | `exportUserData` leaves out messages, photos (ids only), the profile, follows, memberships, comments, favorites, loans, proposals and preferences (`convex/insights/exportUserData.ts:39-149`).                                                                                                                                                                                                                                                                                                                                                         | Add those tables and the member's own photos (signed URLs, or a ZIP built in a background job).                                                                                                                          |
| SEC-67 | Low  | Confirmed                          | The policy promises sent photos still in checking are deleted after a week (`apps/web/locales/en.json:1416`), but that rule is a no-op for sent photos (`convex/conversation/messageAttachments.ts:383-431`). Auto-rejected copy photos have no TTL (`convex/library/moderationStore.ts:91-116`). The Terms say unchecked photos are shown blurred, but they are never served (`en.json:1585`).                                                                                                                                                         | Add the TTLs, or correct the policy and Terms text.                                                                                                                                                                      |
| SEC-68 | Low  | Confirmed                          | `memberName()` snapshots `actorName` into other members' notifications (`convex/notifications/subscriber.ts:131-145`). The purge does not strip it, and legacy rows still display it (`convex/notifications/resolveNotificationView.ts:886-893`).                                                                                                                                                                                                                                                                                                       | Stop snapshotting when `actorIds` is present, and add a purge phase that strips `params.actorName`.                                                                                                                      |
| SEC-69 | Low  | Confirmed                          | For completions kept on copies now owned by someone else, the purge clears photos but keeps the deleted member's private `notes` (`convex/conversation/purgeMemberLibrary.ts:319-345`).                                                                                                                                                                                                                                                                                                                                                                 | Patch `notes: undefined` too, and backfill already-deleted accounts.                                                                                                                                                     |
| SEC-70 | Low  | Confirmed                          | DM and exchange threads are kept even after both parties are deleted (`convex/conversation/purgeMemberMessagingData.ts:357-378`). Authors cannot delete their comments or reviews, and comment tables have no author index (`convex/schema.ts:1556-1581`).                                                                                                                                                                                                                                                                                              | Purge a thread once all participants are gone. Add `by_author` indexes and author delete actions, plus an admin remove-by-member tool.                                                                                   |
| SEC-71 | Low  | Confirmed                          | `domainEvents` has no retention (`convex/crons.ts:8-22`). Payloads keep superseded free text (notes, display name, comment text). The scrub keeps a former owner's notes when the copy still exists (`convex/conversation/purgeMemberEvents.ts:109-133`), keeps rows (so feed-flood rows survive a ban), and scans the whole table on every deletion (`:139-153`). `getUserDetail` collects without a bound (`convex/admin/getUserDetail.ts:39-51`).                                                                                                    | Add a retention cron for dispatched events older than 90 days. Delete feed events on purge. Index events by actor. Stop copying free text into payloads. Bound `getUserDetail`.                                          |
| SEC-72 | Low  | Confirmed (repro)                  | `walkWebp` copies kept chunks verbatim and never parses ANMF, and `findMetadata` uses the same walker (`convex/lib/imageModeration/stripMetadata.ts:270-297`, `:360-369`). EXIF/GPS and a hidden JPEG nested in ANMF survived, and the check returned `[]`.                                                                                                                                                                                                                                                                                             | Re-encode every WebP, or rebuild the container from frame bitstreams only. Make the post-strip check independent of the stripper.                                                                                        |
| SEC-73 | Low  | Plausible                          | `isAdmin` reads `claims.metadata?.role ?? claims.role` (`convex/identity/isAdmin.ts:14-19`). The Clerk template is documented only in a comment (`:8-10`), and the web writes client-controlled `unsafeMetadata` (`apps/web/src/components/dashboard-layout/preferences.tsx:105`). Exploitable only if the template is misconfigured.                                                                                                                                                                                                                   | Drop the flat `role` fallback. Version the template in the repo with a deploy-time check that it never maps `unsafe_metadata`. Optionally re-check the role with Clerk for `setUserRole` and CSAM operations.            |
| SEC-74 | Low  | Plausible (live CORS)              | `/ingest/**` becomes a Vercel external rewrite (`apps/web/vite.config.ts:49`) and `api_host` is same-origin (`apps/web/src/lib/analytics-client.ts:23`), so Clerk's `__session` cookie most likely reaches PostHog (forwarding not observed). Live: the endpoint reflects `Origin: https://evil.example` with credentials allowed.                                                                                                                                                                                                                      | Use a runtime proxy that drops `cookie` and `authorization`, or a dedicated subdomain. Strip upstream CORS headers.                                                                                                      |
| SEC-75 | Low  | Plausible                          | The AhaSend adapter throws 500 characters of the response body (`convex/notifications/adapters/ahasendEmailSender.ts:54-57`), and `sendEmail` logs it to Axiom (`convex/notifications/sendEmail.ts:112-117`). The invite path deliberately logs only `error.name` (`convex/invitations/sendEmailInvite.ts:143-147`). Whether AhaSend echoes the recipient is unverified.                                                                                                                                                                                | Log only the HTTP status and the provider error code. Remove `message.to` from the noop sender warning.                                                                                                                  |
| SEC-76 | Low  | Plausible (repro for pass-through) | An upright WebP is stored as uploaded, ANIM/ANMF included (`convex/lib/imageModeration/pipeline.ts:546-550`, `stripMetadata.ts:262-263`), and the classifier receives the multi-frame file. HF probably scores frame 0 only. Sightengine documents frame-by-frame analysis for GIF (likely mitigated in prod) and may bill per frame.                                                                                                                                                                                                                   | Refuse animated WebP (VP8X flag 0x02 or ANIM/ANMF), or decode and re-encode every WebP.                                                                                                                                  |
| SEC-77 | Low  | Plausible (local)                  | The cached WASM WebP decoder never shrinks its memory (`convex/lib/imageModeration/normaliseImage.ts:36-52`). After a 25 MP rotated WebP, RSS stays around 415-442 MiB, and a following 12 MP JPEG is OOM-killed under 512 MiB. Warm-instance reuse is unverified.                                                                                                                                                                                                                                                                                      | Instantiate per call, or drop the instance after a large decode. Lower the WebP pixel cap.                                                                                                                               |
| SEC-78 | Info | Confirmed (repro)                  | `EMAIL_RE` allows `?`, `&` and `=` (`convex/contact/submitContactMessage.ts:12`), and the admin inbox renders ``href={`mailto:${message.email}`}`` (`apps/web/src/routes/_dashboard/admin/contact.tsx:80`). A `%40`-encoded `?bcc=` is accepted (a literal second `@` is rejected).                                                                                                                                                                                                                                                                     | Reuse the strict invite email regex and `encodeURIComponent` the address.                                                                                                                                                |
| SEC-79 | Info | Confirmed (repro)                  | Posting to a DM whose partner was deleted re-creates one preferences row and one grouped notification row per (deleted member, thread) (`convex/notifications/subscriber.ts:361-368`). Bounded, not unbounded.                                                                                                                                                                                                                                                                                                                                          | Refuse with `CannotReply` when no active partner remains, and skip inactive recipients.                                                                                                                                  |
| SEC-80 | Info | Confirmed                          | `canMessage`/`openDmThread` return true when any pair thread exists, regardless of kind (`convex/conversation/adapters/connectionPolicy.ts:36-42`), and skip the anonymity gate that `startCopyConversation` applies. Documented as intended.                                                                                                                                                                                                                                                                                                           | Answer like `NotConnected` when `projectMemberIdentity` is anonymous.                                                                                                                                                    |
| SEC-81 | Info | Confirmed (repro)                  | `CopyRepository.remove` deletes image rows but not their blobs (`convex/library/adapters/convexCopyRepository.ts:118-121`), so issued URLs keep working.                                                                                                                                                                                                                                                                                                                                                                                                | Delete the blobs unless preserved and, after SEC-01, unless referenced elsewhere.                                                                                                                                        |
| SEC-82 | Info | Confirmed                          | `recordInviteLanding` has no auth and no limit (`convex/social/recordInviteLanding.ts:14`); this only affects a growth metric.                                                                                                                                                                                                                                                                                                                                                                                                                          | Accept as noise, or de-duplicate per session.                                                                                                                                                                            |
| SEC-83 | Info | Confirmed                          | `isRootRelative` accepts `/\host`, which resolves off-site (`packages/email/src/render.tsx:56-59`). Not reachable today, because every href starts with a fixed path.                                                                                                                                                                                                                                                                                                                                                                                   | Compare origins: `new URL(path, base).origin === new URL(base).origin`.                                                                                                                                                  |
| SEC-84 | Info | Confirmed                          | Notification email has no `List-Unsubscribe` header (`convex/notifications/adapters/ahasendEmailSender.ts:24-52`). This is a deliverability and compliance gap.                                                                                                                                                                                                                                                                                                                                                                                         | Add an RFC 8058 one-click unsubscribe backed by an HMAC token.                                                                                                                                                           |
| SEC-85 | Info | Confirmed                          | `propose` throws `NotConnected` for a block before its reachability check (`convex/exchange/propose.ts:56`). The profile endpoint already reveals the same fact.                                                                                                                                                                                                                                                                                                                                                                                        | Run `canViewCopy` first and answer a block with `CopyNotReachable`.                                                                                                                                                      |
| SEC-86 | Info | Confirmed                          | Any circle Admin can remove or demote other Admins (`domain/sharing/domain/circle.ts:160`, `:188`). The comment at `convex/library/circleSharedCopies.ts:54` is stale.                                                                                                                                                                                                                                                                                                                                                                                  | Consider owner-only removal of Admins, and update the comment.                                                                                                                                                           |
| SEC-87 | Info | Confirmed                          | `ChartStyle` writes config keys into a `<style>` via `dangerouslySetInnerHTML` (`apps/web/src/components/ui/chart.tsx:83`). The keys are a difficulty enum today (`apps/web/src/components/insights/collection-breakdown.tsx:118`).                                                                                                                                                                                                                                                                                                                     | Use index-based keys or check them against `/^[a-z0-9_-]+$/i`.                                                                                                                                                           |
| SEC-88 | Info | Confirmed (live)                   | `x-vercel-id: fra1::iad1`: authenticated SSR queries render member data in the US region (`apps/web/src/routes/__root.tsx:127-130`), and `vercel.json` pins no region, while the policy says the data stays in the EU (`apps/web/locales/en.json:1515`).                                                                                                                                                                                                                                                                                                | Pin functions to `fra1`.                                                                                                                                                                                                 |
| SEC-89 | Info | Confirmed                          | Retention relies only on per-row scheduled jobs. Undecided reports never enter retention (`convex/reports/retention.ts:13-36`, `convex/admin/decideReport.ts:91`).                                                                                                                                                                                                                                                                                                                                                                                      | Add a daily backstop sweep by index, and a bound for reports left open.                                                                                                                                                  |
| SEC-90 | Info | Confirmed                          | Anonymous `getCommunityAvatars` samples private members too. It returns initials only, shuffled (`convex/insights/getCommunityAvatars.ts:88-92`).                                                                                                                                                                                                                                                                                                                                                                                                       | Sample only opted-in or public members.                                                                                                                                                                                  |
| SEC-91 | Info | Confirmed                          | WebP is sent to Sightengine named `photo.jpg` (`convex/library/adapters/photoModeration.ts:426`). APNG always fails with `decode_failed`. The ICC verbatim copy is reachable only from an internal backfill.                                                                                                                                                                                                                                                                                                                                            | Derive the filename from the mime type, and document that APNG is refused.                                                                                                                                               |
| SEC-92 | Info | Confirmed                          | `isReferenced` misses `messageAttachments.mapFileId` (no index, `convex/schema.ts:1098`), `thumbFileId` and legacy `completions.photos` (`convex/lib/imageModeration/blobReferences.ts:9-31`). `boxArtUploads` rows are never deleted.                                                                                                                                                                                                                                                                                                                  | Before building the SEC-20 sweep: add a `by_map_file` index, backfill `completionImages`, use a margin of 24 h or more, add a TTL for never-attached box art, and test every reference kind.                             |
| SEC-93 | Info | Plausible                          | The legacy `messages` table (`convex/schema.ts:885-901`) is not in the purge phases. Whether production still has rows is unknown.                                                                                                                                                                                                                                                                                                                                                                                                                      | Drop the table if the backfill has run; otherwise add a purge phase.                                                                                                                                                     |
| SEC-94 | Info | Plausible                          | Previews are seeded with `convex export --include-file-storage` from dev (`.github/workflows/convex-preview.yml:141`), and the preview URL is posted on public PRs (`vercel-preview.yml:133`). Impact depends on whether dev holds real data and whether Vercel Deployment Protection is on.                                                                                                                                                                                                                                                            | Confirm dev data is synthetic, enable Deployment Protection, or seed from a scrubbed fixture.                                                                                                                            |
| SEC-95 | Info | Plausible                          | Account-deletion coverage matrix (reference): see section 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Close the gaps listed there.                                                                                                                                                                                             |

---

## 6. What is already good

Positives that the slices reported, with duplicates removed. They matter because most fixes above reuse these patterns.

**Identity and authorization gates**

- `requireMember` takes the actor from the Clerk `subject` and refuses missing or inactive rows with a generic error (`convex/identity/requireMember.ts:9-19`). A backend-wide grep found no `args.x ?? await requireMember(ctx)` short-circuit. No public function trusts a client-supplied userId, ownerId or senderId.
- `isAdmin` reads the JWT claim and fails closed. Authorization never reads the `users.role` mirror. `setUserRole` re-checks inside a transaction and refuses self-changes (`convex/identity/isAdmin.ts:11-20`, `convex/admin/roleChange.ts:21-43`). Every admin function runs `requireMember` + `isAdmin` before reading data.
- All backfills, migrations, sweeps and purges are internal-only. No public function uses `v.any()`.
- The presence heartbeat checks the client `userId` against auth, bounds intervals, is rate-limited, and `list` returns `[]`, so the roster cannot be read (`convex/presence.ts:38-97`).
- `getUserByClerkId` returns only the caller. `resolveMemberByHandle` tries the id first, and `setSlug` rejects id-shaped and reserved slugs (`convex/identity/getUserByClerkId.ts`, `convex/identity/setSlug.ts:58-92`).
- The Clerk webhook verifies the svix signature over the raw body, applies a 5-minute timestamp tolerance, and answers 503 when the secret is missing (`convex/http.ts:12-26`, `:96-117`). Only the verified primary email is mirrored (`convex/users.ts:137-146`).

**Privacy chokepoints**

- `projectMemberIdentity` with an HMAC `anonRef` that falls back to a per-request random key, never an unkeyed hash, when the secret is missing (`convex/social/privacy.ts:149-241`, `:279-328`).
- Owner-only copy and collection fields are opt-in in the mappers (`convex/library/mappers.ts:57-127`, `:176-195`). `canViewCopy` is the single read gate, with a block veto after owner and holder (`convex/library/canViewCopy.ts:110-141`).
- Exchange reads are party-only, a hidden party's raw id is left out, and the trade reveal is scoped to one exchange and append-only (`convex/exchange/readViews.ts`, `convex/exchange/tradeParty.ts`).
- Blocks are enforced broadly and silently. `blockMember` severs follows, declines pending requests and closes pending exchanges in one transaction.
- Presence exposes no timestamps; hidden, offline and not-sharing look the same. `listPublicPuzzleReviews` uses `projectPublicAuthor`, which fails closed. The sitemap lists approved entries only, and private member pages emit `noindex`.

**Messaging**

- `readableThreadOf` is the one thread read gate, including the circle history floor (`convex/conversation/readModelHelpers.ts:51-96`). Author ids never leave the server in DM and exchange threads.
- Photo serving is strict: approved or blurred, hash-cleared, re-encoded; reveal re-checks thread, floor, block, removal and report (`convex/conversation/messageAttachments.ts:169-172`, `convex/conversation/revealMessageImage.ts:20-74`). Staging requires a fresh, unreferenced blob (`convex/conversation/stageMessageImage.ts:30-79`).
- Message markup produces typed nodes only; links must parse as http(s) and render with `rel="noopener noreferrer nofollow ugc"` (`packages/contracts/src/conversation/message-markup.ts:93-106`, `apps/web/src/components/messaging/message-text.tsx:24-33`).
- MapTiler calls use a fixed origin, `redirect: "error"`, timeouts and byte caps. Coordinates are snapped on the server, nothing is logged, and a deployment-wide budget applies (`convex/conversation/adapters/mapTiler.ts`, `convex/lib/rateLimits.ts:84-156`). `listThreadMessages` clamps its page size to 1..100.

**Image pipeline and moderation**

- Classifier failures end `unscored`, never approved, and a mistyped provider falls back to a real classifier rather than `none` (`convex/library/adapters/photoModeration.ts:505-512`).
- Formats are detected from magic bytes, size and pixel guards run before decoding, metadata is stripped and the output re-checked (`convex/lib/imageModeration/guards.ts`, `pipeline.ts:541-584`). The stored content type is never the client's claim.
- No URL is issued before the hash gate passes. Waiving the check is an explicit, audited admin decision, and a later match still quarantines the photo (`convex/lib/imageModeration/hashCheckFields.ts`, `boxArtUrl.ts:16-39`, `convex/admin/decideUncheckedPhoto.ts:42-74`).
- The HCS adapter is https-only, with `redirect: "error"`, a 10 s timeout and a 64 KB response cap, and never logs hashes or credentials (`convex/lib/imageModeration/csamHashCheck.ts:127-178`). Quarantine preserves evidence, `isPreservedBlob` is checked before every delete, and the uploader is deliberately not told.
- Box-art, message-photo and circle-icon claims already use the fresh-and-unreferenced rule (`convex/catalog/boxArtModerationStore.ts:36-53`, `convex/sharing/setCircleIcon.ts:41-49`). That is the template for fixing SEC-01.
- Reports are limited to 10/day, target resolution gives a uniform `NotFound`, the moderator is never named, and the reporter is anonymised after 12 months (`convex/reports/fileReport.ts`, `convex/reports/retention.ts`). Admin health views show env var names, never values.

**Catalog and URL import**

- URL import does a DNS-resolved public-host check, follows redirects manually with re-validation on every hop (at most 5), uses timeouts and a 10 MB image cap with magic-byte typing, keeps the Firecrawl key server-side, and returns only error codes to the client (`convex/catalog/adapters/assertPublicUrl.ts:37-66`, `convex/catalog/importPuzzleImage.ts:48-75`).
- Public catalog reads filter `approved` at the search index. `getPuzzleById` restricts non-approved rows to the submitter or an admin. Admin catalog operations are gated and audited. Submitter and proposer ids come from auth.

**Notifications and email**

- Delivery is re-resolved at send time, deleted recipients get nothing, and circle push and email never carry message text (`convex/notifications/resolveForDelivery.ts`). Email and push are off by default, and email is limited to eligible types.
- react-email escapes all user strings, CR/LF is stripped from headers, AhaSend runs in sandbox unless explicitly disabled, and each send has an idempotency key.
- The invite email path is hardened: brand-only From name, sanitized and capped inviter name, HMAC-only address log, uniform responses padded to a time floor (`convex/invitations/sendEmailInvite.ts:194-202`). The service worker has no fetch handler.

**Abuse-control infrastructure**

- `convex/lib/rateLimits.ts` is a reusable fixed-window limiter that writes nothing on refusal and logs refusals as structured events. It already backs global MapTiler and Clerk budgets, so adding the buckets in section 1 is cheap.

**Data lifecycle**

- The account purge has 46 paginated, self-rescheduling phases. It tombstones the account while a CSAM escalation is open, scrubs ids and personal fields from the event log, clears location coordinates, expires unsent staged photos after 24 h and rejected message photos after 30 days, and schedules report and evidence retention (`convex/conversation/purgeMemberMessagingData.ts`, `convex/conversation/purgeMemberEvents.ts`).

**Web and CI**

- `safeReturnTo` is applied in `validateSearch`. `dangerouslySetInnerHTML` is limited to build-time, repo-authored markdown (and the SEC-87 chart CSS). Each SSR request gets its own Convex and Query clients, seroval escapes `<` in dehydrated payloads, and server functions send no CORS headers. PostHog is loaded only after consent, via dynamic import, with replay masking on.
- Workflows avoid `pull_request_target`, never interpolate `${{ }}` into `run:`, pin the gh-pages action by SHA, scope one deploy key per step, and guard prod with CI success plus a stale-commit check. pnpm uses a frozen lockfile, an install-script allow-list and `minimumReleaseAge`.

---

## 7. Refuted candidates and corrected sub-claims

No candidate was fully refuted, and the input had no unverified items. For transparency, these are the parts of candidates that verifiers refuted, corrected or re-rated, and that this chapter therefore does not claim:

- **IDENT-3 (SEC-32):** the role-mirror half is weaker than claimed. `schema.ts:93-96` and `subscriber.ts:189-191` document `users.role` as display plus notification targeting; only `users.ts:41-42` calls it display-only.
- **IDENT-7 (SEC-78):** the literal payload with a second raw `@` is rejected by `EMAIL_RE`. Only the `%40`-encoded form works.
- **CONV-1 (SEC-24):** measured cost is 13.1 `db` calls per thread, not about 15.
- **CONV-7 (SEC-79):** "grows without bound" is refuted. In-app rows are grouped per thread, so it is one preferences row and one notification row per (deleted member, thread). Re-rated low → info.
- **LIB-4 (SEC-34):** re-rated medium → low. Disabled definitions keep rendering by design, and self-acquiring a pending submission is a feature. Correction in the other direction: `boxArtUrl` gates on the image's own moderation, so approved box art of rejected definitions is also served.
- **LIB-6 (SEC-28):** the owner or an admin _can_ delete the whole photo, which hides its comments (the rows are orphaned, not deleted).
- **SOC-6 (SEC-14):** the impersonation angle is weaker, because the Clerk-synced name is also member-chosen. **SOC-9 (SEC-41):** subsumed by SEC-13 today.
- **SHARE-2 (SEC-31):** re-rated medium → low. In the leave variant the attacker is a former admin who could have seated the sockpuppet earlier, and the current admin can see and revoke leftover invites.
- **SHARE-7 (SEC-85):** re-rated low → info. A blocked member can already tell from `getPublicProfile` returning null.
- **ADMIN-2 (SEC-03):** re-rated high → medium. A deliberate attacker beats any exact-hash list by changing one byte, whatever the client does. "Prod runs `none`" is likely but was not checked.
- **ADMIN-7 (SEC-56):** the exploit was overstated. `recheckPhoto` only re-runs `unscored` rows, so an admin cannot loop a rejected photo until it passes.
- **ADMIN-9 (SEC-26):** the email channel is ruled out. `admin_*` types are not email-eligible.
- **ADMIN-10 / PRIV-8 (SEC-57):** "past report retention" is weak. The 12-month promise covers the reporter's identity, not the reported member's.
- **CAT-9 (SEC-34):** the realistic sources of a pending definition's id already expose the same fields; the remaining gap is disabled or rejected text served through favorites.
- **CAT-10 (SEC-49):** `globalSearch` requires an identity; it is not anonymous as the title said.
- **SURF-4 (SEC-16):** SSRF into internal or metadata services is unrealistic (HTTPS only, certificates validated, response not returned), so it is rated as cost and DoS.
- **SURF-6 (SEC-19, SEC-23):** the notification-flood part was overstated. In-app `new_follower` is grouped and email is opt-in.
- **SURF-8 / CAT-12 (SEC-53):** tombstones exist only during CSAM escalations, so exposure is a short-lived token window.
- **WEB-4 (SEC-60):** "fork PRs from established accounts often run without approval" is refuted. The repo's fork-PR approval policy is `all_external_contributors`, and the stale-commit guard runs before any repo code.
- **WEB-5 (SEC-61):** "GITHUB_TOKEN may be read-write" is refuted. The repo default workflow permission is read-only.
- **WEB-6 (SEC-62):** the default cache header does not cause cross-user CDN caching without `s-maxage`; only a local disk cache could hold the short-lived JWT.
- **GAP1-2 / GAP1-4 (SEC-76):** re-rated medium → low. On prod (Sightengine) the bypass is probably mitigated, and the billing amplification factor is unknown.
- **GAP1-3 (SEC-18):** "18 MP photos are OOM-killed" was not reproduced; 12 and 18 MP RGB JPEGs completed under 512 MiB.
- **GAP2-5 (SEC-01):** re-rated _up_, low → high. The finding assumed storage ids never reach non-owners, but they do: copy snapshot, exchange views and change proposals.
- **GAP3-2 (SEC-30):** the subscription fan-out cannot be reproduced in `convex-test`; it rests on Convex read-set semantics.
- **PRIV-7 (SEC-66):** the 5,000-row cap is not silent; the UI warns (`export-button.tsx:42-43`).
- **PRIV-9 (SEC-67):** "auto-rejected completion photos have no time limit" is refuted. They are detached and their blob deleted on rejection (`convex/solving/completionModerationStore.ts:113-150`).
- **Citations corrected:**
  - PRIV-5 cited `analytics-client.ts:96-110`, but that file has 51 lines.
  - NOTIF-6 cited `deliveryContent.ts:161`, but that file has 93 lines.
  - GAP3-1 cited `recordCompletion.ts:203-261`/`:224` and `startCompletion.ts:120-160`, but those files have 137 and 75 lines. The copy-optional gate is at `recordCompletion.ts:51-52`.
  - Several verifier write-ups quote line numbers past the end of a file (for example `removeCopyPhoto.ts:151-170` in a 47-line file, `request-follow.ts:89-121` in an 83-line file). This chapter uses in-range references spot-checked against the files.

---

## 8. Coverage and limitations

### What was reviewed

| Slice | Scope (all at `6b04171e55`)                                                                                                                              | Not covered or not verifiable                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| IDENT | `http.ts`, `auth.config.ts`, `users.ts`, all of `identity/`, `invitations/`, `onboarding/`, `settings/`, `contact/`; svix/standardwebhooks verify source | Clerk dashboard (JWT template, webhook subscriptions, sign-up rules); live svix ordering                     |
| CONV  | Every public function in `conversation/`, presence, subscribers, location adapters, message markup, messaging web sinks                                  | Image pipeline internals, admin report decisions, most purge phases, backfills                               |
| LIB   | All of `library/`, `custody/`, matching domain use cases, mappers, `canViewCopy`                                                                         | `guards`/`stripMetadata` internals (covered by GAP1), solving pipeline, shelf/recommendation reads           |
| SOC   | All 50 files in `social/`, `reputation/`, identity helpers, members route                                                                                | Household domain, deeper circle surfaces                                                                     |
| CAT   | All 56 files in `catalog/`, `search/`, `docs/`, `whatsNew/`, `puzzles.ts`, bundled ogie fetch code                                                       | Pipeline internals; the actual network reachable from Convex's Node runtime (SEC-15 impact)                  |
| NOTIF | All of `notifications/`, `events/`, `packages/email`, service worker, web push client, web-push library                                                  | `sendEmailInvite` internals, every `decide*` view rule                                                       |
| SHARE | All of `sharing/`, `household/`, `exchange/` and their domain layers                                                                                     | Conversation exchange threads, loan return internals                                                         |
| ADMIN | All of `admin/`, `reports/`, most of `lib/imageModeration/`, crons                                                                                       | `stripMetadata`/`normaliseImage` internals; production env and Clerk template                                |
| SURF  | All 304 public functions classified by script; every function without a visible gate or taking a member id read by hand                                  | Domain policies behind exchange, sharing and household use cases confirmed invoked but not fully re-verified |
| WEB   | Web loaders, server fns, sinks, auth and redirect paths, 8 workflows, build scripts, `pnpm audit`, live headers                                          | Signed-in SSR HTML, Clerk cookie attributes, Vercel Deployment Protection, PostHog retention                 |
| PRIV  | Purge modules, retention, export, logging, email adapters, privacy policy and terms text (live `/privacy` checked)                                       | Clerk/Axiom/PostHog dashboard settings, production env vars, whether legacy `messages` rows exist            |
| GAP1  | Full image pipeline, guards, walkers, decoders, pngjs/jpeg-js limits; local fixtures with memory measured under a 512 MiB cgroup                         | Sightengine and HF animated-WebP behaviour and billing (docs only), Lambda timings                           |
| GAP2  | Every upload-URL mint and claim path, storage references, Convex upload limits (docs)                                                                    | Convex plan, ingest throughput (no live uploads)                                                             |
| GAP3  | Activity feed, all event producers, dispatch, purge of events                                                                                            | Live re-run batching, `ExchangeCompleted` flooding with colluding accounts                                   |

### Limitations

- **No live exploitation.** No mutation or action was called against any Convex deployment, and no account was created. Every repro ran in `convex-test`, in memory.
- **`convex-test` blind spots.** It enforces no read, scan or call limits, no reactive subscriptions and no memory limits. Every "breaks at scale" statement (SEC-22, SEC-23, SEC-24, SEC-26, SEC-27, SEC-28, SEC-29, SEC-30) is inferred from Convex's documented limits and marked as such.
- **Not exercised in a browser:** the admin UI, signed-in pages and the cookie-consent flow. Clerk session cookie attributes and the `convex` JWT template lifetime were not observed.
- **Configuration that lives outside the repo:** the Clerk JWT template (SEC-73), the production `CSAM_HASHCHECK_PROVIDER` and `MODERATION_PROVIDER` (SEC-03, SEC-76), `AHASEND_SANDBOX`, MapTiler cap overrides, Vercel Deployment Protection (SEC-94), PostHog replay settings beyond the public remote config, and the Convex plan. Where findings depend on these, they are marked plausible or say so.
- **Third-party behaviour taken from documentation:** Sightengine (animated images, billing), Svix (retry and ordering), Convex upload limits.
- **Production data was not read.** Whether SEC-01 or SEC-02 has already happened, and whether legacy `messages` rows exist (SEC-93), can only be answered with internal queries on prod.

### Account-deletion coverage (from PRIV-19, spot-checked)

- **Deleted:** users (tombstoned while a CSAM escalation is open), profiles, all preference tables, onboarding and what's-new state, push subscriptions, favorites, per-member rate-limit rows, own notifications, image reveals, GPS views, typing indicators, circle participant rows, blocks (both directions), circle, household and connection invites, join requests, follows and follow requests, invite links and redemptions, sent email invites (Clerk invitation revoked), owned copies (with photos, blobs, collection memberships, copy reviews, circle shares and copy-scoped comments), photos uploaded to other copies, own completions (with photos), goals, collections, categories. Owned circles are handed over or deleted, and the household seat is left.
- **Anonymised:** message attachments (blobs deleted, location cleared), reports they filed, `domainEvents` payloads, follow notifications in others' inboxes.
- **Kept and disclosed:** message text, DM and exchange threads, exchanges (open ones cancelled), loans (open ones closed), custody entries, completions on others' copies (photos removed), reviews given and received, reputation profiles, puzzle reviews, definition comments, comments on others' photos, change proposals, submitted puzzles, `boxArtUploads` rows and blobs, icons in surviving circles, reports about them (until retention), trade reveals.
- **Kept, not disclosed or a gap:** moderation labels (SEC-57), others' `actorName` snapshots (SEC-68), completion notes on others' copies (SEC-69), DM threads between two deleted members (SEC-70), the PostHog person with email (SEC-59), contact and doc-feedback rows (SEC-22), the legacy `messages` table (SEC-93). The CSAM `uploaderSnapshot` is kept deliberately.

### Source-ID crosswalk

| Source  | SEC      | Source | SEC | Source   | SEC    | Source  | SEC        |
| ------- | -------- | ------ | --- | -------- | ------ | ------- | ---------- |
| IDENT-1 | 27       | LIB-9  | 11  | NOTIF-4  | 54     | SURF-8  | 53         |
| IDENT-2 | 22       | LIB-10 | 37  | NOTIF-5  | 83     | SURF-9  | 37         |
| IDENT-3 | 32       | LIB-11 | 38  | NOTIF-6  | 64     | SURF-10 | 12         |
| IDENT-4 | 33       | LIB-12 | 81  | NOTIF-7  | 84     | SURF-11 | 03         |
| IDENT-5 | 07       | SOC-1  | 12  | SHARE-1  | 02     | SURF-12 | 34, 66, 90 |
| IDENT-6 | 73       | SOC-2  | 13  | SHARE-2  | 31     | WEB-1   | 58         |
| IDENT-7 | 78       | SOC-3  | 11  | SHARE-3  | 09     | WEB-2   | 74         |
| CONV-1  | 24       | SOC-4  | 07  | SHARE-4  | 10     | WEB-3   | 59         |
| CONV-2  | 25       | SOC-5  | 23  | SHARE-5  | 24     | WEB-4   | 60         |
| CONV-3  | 49       | SOC-6  | 14  | SHARE-6  | 45     | WEB-5   | 61         |
| CONV-4  | 20       | SOC-7  | 39  | SHARE-7  | 85     | WEB-6   | 62         |
| CONV-5  | 46       | SOC-8  | 40  | SHARE-8  | 49     | WEB-7   | 63         |
| CONV-6  | 47       | SOC-9  | 41  | SHARE-9  | 86     | WEB-8   | 94         |
| CONV-7  | 79       | SOC-10 | 42  | ADMIN-1  | 01     | WEB-9   | 87         |
| CONV-8  | 93       | SOC-11 | 43  | ADMIN-2  | 03     | PRIV-1  | 08         |
| CONV-9  | 48       | SOC-12 | 44  | ADMIN-3  | 04     | PRIV-2  | 22         |
| CONV-10 | 80       | SOC-13 | 28  | ADMIN-4  | 19     | PRIV-3  | 64         |
| LIB-1   | 01       | SOC-14 | 82  | ADMIN-5  | 22     | PRIV-4  | 65         |
| LIB-2   | 19       | CAT-1  | 05  | ADMIN-6  | 55     | PRIV-5  | 59         |
| LIB-3   | 29       | CAT-2  | 15  | ADMIN-7  | 56     | PRIV-6  | 59         |
| LIB-4   | 34       | CAT-3  | 21  | ADMIN-8  | 73     | PRIV-7  | 66         |
| LIB-5   | 06       | CAT-4  | 19  | ADMIN-9  | 26     | PRIV-8  | 57         |
| LIB-6   | 28       | CAT-5  | 26  | ADMIN-10 | 57     | PRIV-9  | 67         |
| LIB-7   | 35       | CAT-6  | 22  | SURF-1   | 01     | PRIV-10 | 68         |
| LIB-8   | 36       | CAT-7  | 50  | SURF-2   | 11     | PRIV-11 | 69         |
| NOTIF-1 | 16       | CAT-8  | 51  | SURF-3   | 27, 28 | PRIV-12 | 32         |
| NOTIF-2 | 23       | CAT-9  | 34  | SURF-4   | 16     | PRIV-13 | 70         |
| NOTIF-3 | 14       | CAT-10 | 49  | SURF-5   | 22     | PRIV-14 | 75         |
| GAP1-1  | 17       | CAT-11 | 52  | SURF-6   | 19, 23 | PRIV-15 | 71         |
| GAP1-2  | 76       | CAT-12 | 53  | SURF-7   | 49     | PRIV-16 | 88         |
| GAP1-3  | 18 (+01) | GAP2-1 | 20  | GAP2-5   | 01     | PRIV-17 | 89         |
| GAP1-4  | 76       | GAP2-2 | 20  | GAP3-1   | 30     | PRIV-18 | 90         |
| GAP1-5  | 72       | GAP2-3 | 20  | GAP3-2   | 30     | PRIV-19 | 95         |
| GAP1-6  | 77       | GAP2-4 | 92  | GAP3-3   | 71     |         |            |
| GAP1-7  | 91       |        |     | GAP3-4   | 49     |         |            |
