# JigSwap: proposals and roadmap (2026-10-29 review)

**Audience:** the owner/developer, deciding what to do next.
**Written:** 2026-10-30, against the review of `main` at `6b04171e55`.
**Inputs:** `01-current-state.md`, `02-security-review.md` (findings `SEC-nn`), `03-ui-ux-review.md` (findings `UX-nn`), `04-performance.md` (items such as A1, B1, "perf #5"), `06-appendix-market-scan.md` (cited as "market §n") and `07-appendix-roadmap-gaps.md` (cited as "roadmap §n").
**What this chapter is:** 45 consolidated proposals (P-01 to P-45), scored by three independent judges and placed on a three-horizon roadmap. The scores are structured judgement, not measurement.

---

## 1. Summary

1. **Fix first** the two High findings that let any member destroy shared data, box art deletable through raw storage ids (SEC-01) and stale exchanges that move a copy out of a non-party's library (SEC-02), together with the leaks that break "private means private" (above all the verified email revealed after a one-line reply, SEC-08), an honest statement about the inert CSAM check, throttles on the endpoints that cost money, and a sweep of 13 small fixes that clears all three UX blockers; turn on and test backups before any of it.
2. **Build next**, over the winter, what members touch every day and the catalogue they depend on: an exchange loop that shows whose turn it is (P-02, P-15), a solve log and yearly goals that keep what members enter before 1 January (P-09, P-10), sharing controls that never silently publish a private copy (P-17), one settled vocabulary and natural Dutch (P-34, P-38), and Jan van Haasteren and Wasgij coverage seeded in bulk before the Obdam swap fair on 20 February 2027 (P-23), because 9 approved catalogue puzzles is the real activation bottleneck.
3. **JigSwap's distinctive position** is private, household- and circle-scoped lending and swapping of physical puzzles with an honest custody history, in Dutch-first quality and EU-hosted, with a privacy story that is actually true; MySpeedPuzzling, the main competitor, has none of this (no Dutch UI, no households or circles, no loans).
4. **Do not build for scale or institutions JigSwap doesn't have yet**: the listings and feed read models, 10k-member fixtures, capacity panels, a restrictions engine, circle library mode, timers and table mode, an offline fair mode and stranger-trade machinery all wait for a measured trigger, and P-21, P-12 and the fair mode (P-27) are parked.
5. **The binding constraint is your verification time, not agent throughput**: split every programme into small PRs that each flip a regression test, gate production deploys on CI, and talk to the 13 current members and the Obdam organiser before building fair, library or wishlist-alert features.

**At a glance**

| Horizon | Window                    | Rough effort                                 | What it delivers                                                                                                                                                        |
| ------- | ------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Now     | 2 Nov – 27 Nov 2026       | ~24 owner-days                               | Both High findings, 14 of 28 Medium findings closed and 6 more partly closed, all 3 UX blockers, first-session fixes, backups                                           |
| Next    | 30 Nov 2026 – 26 Feb 2027 | ~60 owner-days above the cut line, ~26 below | The remaining Medium findings, a correct exchange loop, solve log and goals, sharing controls, vocabulary and Dutch, catalogue seeding for Obdam, regression guardrails |
| Later   | March 2027 onwards        | ~150 owner-days if everything were built     | A menu of items, each with the trigger that should start it                                                                                                             |
| Parked  | —                         | —                                            | P-21, P-12, P-27, most of P-13, P-19 and P-43; cheap slices of each are kept                                                                                            |

---

## 2. How the proposals were made

**Six lenses.** Six proposal writers each read the review chapters and both appendices from one angle and wrote 10 proposals, 60 in total. Each proposal states its problem with evidence, the change, user value, effort, dependencies, risks, success metrics and a first step.

| Lens                         | Prefix     | Angle                                                                   |
| ---------------------------- | ---------- | ----------------------------------------------------------------------- |
| Core collector loop          | CORE       | Cataloguing, adding copies, solving, goals, insights, import and export |
| Sharing and exchange         | SHARE      | Swaps, loans, sales, circles, households, trust between members         |
| Community and growth         | COMMUNITY  | Invites, catalogue coverage, SEO, Dutch market, partners                |
| Experience and accessibility | EXPERIENCE | Shell, navigation, responsive layout, WCAG, Dutch language quality      |
| Trust and safety             | TRUST      | Security findings, privacy, GDPR, DSA, moderation                       |
| Platform and delivery        | PLATFORM   | Release process, observability, performance, cost, test infrastructure  |

**Consolidation.** Overlapping proposals were merged into 45 (P-01 to P-45). Each proposal in §4 lists the lens proposals it came from. Duplicates were dropped and scope was moved to a single owner; §5.3 lists all 24 consolidation decisions. Some sub-items were checked against the code during consolidation, and two turned out to be built already (re-tap scroll-to-top on the tab bar, and the `/trades?exchange=` deep link).

**Three judges.** Each judge scored every proposal independently from 1 to 5 on four criteria, could vote to cut it, and wrote a comment and a portfolio-level view.

| Judge                          | Speaks for                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- |
| Member advocate ("member")     | The 30-75 family audience: privacy, clarity, everyday usefulness           |
| Pragmatic engineer ("builder") | Cost, risk and maintenance for one developer working with agents           |
| Strategist                     | Positioning against the market, sequencing, what makes JigSwap distinctive |

**Scoring formula.** Each criterion is the mean of the three judges' scores:

> priority = 0.35 × value + 0.20 × feasibility + 0.20 × fit + 0.25 × urgency − effort penalty

The effort penalty is 0.15 for M, 0.40 for L and 0.80 for XL; no proposal was sized S. Scores run from 1.48 (P-21) to 4.47 (P-01).

**Read the scores as judgement, not data.**

- The judges saw the same evidence, so their agreement is not independent confirmation.
- Effort sizes are the proposers' estimates.
- A difference under about 0.2 is noise.
- The formula can't see that several L proposals bundle a cheap, urgent fix with a large speculative build. All three judges said so, which is why the roadmap splits those proposals into slices.

**From scores to roadmap.** Placement starts from the score and is then overridden by urgency (security and data loss first), dependencies, calendar deadlines and capacity. Every override is explained in the roadmap's "why" column.

**Effort scale used in this chapter.** Efforts are in owner time, meaning you directing agents and verifying what they produce. S is up to about a day, M is about 3-6 days, L is about 2-3 weeks and XL is a month or more. Horizon totals count S as 1 day, M as 4 and L as 10, adjusted where a slice is clearly smaller.

---

## 3. Roadmap

### 3.1 Placement rules and assumptions

1. **Irreversible harm and confirmed High or Medium security findings go first, whatever their score.** P-03 Stage 1 ranks 13th and P-04 ranks 19th by score, but their urgent parts sit in Now.
2. **Unbundle.** Where a large proposal hides a cheap, urgent fix, the fix ships on its own: 13 slices go into the Now hotfix sweep. All three judges asked for this.
3. **Respect dependencies.**
   - P-41's A1 split before any edit to the 1,476-line `copies/$id.tsx` (P-06, P-17).
   - P-01 Phase A before P-06's cover persistence and P-20's evidence photos.
   - P-23 Phase A before P-23 Phase B, P-13 and P-14 import.
   - P-34's glossary before P-38's Dutch pass, so each string is touched once.
   - P-09's `lib/date-input.ts` before P-10's period boundaries.
   - P-02 before P-15, P-16, P-18 and P-20.
   - P-17's visibility-preference rule before any bulk "offer" (P-08).
   - P-43's memberFeed before trimming `domainEvents` (P-31), because the feed reads them today.
   - P-01 Phase B before P-42's renditions.
4. **Respect the calendar.** Goals must be right before 1 January, when members set yearly goals. Catalogue seeding must be done before the Obdam fair on 20 February 2027. December has holidays.
5. **Later items carry a trigger.** Each names the measurement or event that should start it.
6. **Capacity assumption.** About 5 focused owner-days a week. JigSwap's history is bursty: nothing from mid-July to mid-October, then 227 merged PRs in five days (01 §8.1). If the real figure is lower, keep the order and stretch the calendar rather than skimping on verification.
7. **Small PRs.** Keep each PR to about 300 lines, tied to a flipped regression test or a visible check, instead of the current median of 554 lines merged in 44 minutes (01 §8.2). This is the builder's advice and matches the repo's own CLAUDE.md.
8. **Bundle user-visible changes into a few announced releases.** The vocabulary rename (P-34), the one-deal-per-copy rule (P-02), favourites becoming a wishlist (P-18), the tab-bar change (P-33) and URL changes (P-24) should each reach members through a release with a What's new entry in EN and NL, not drip across dozens of PRs. The member judge raised this.
9. **Owner-only work is the real bottleneck,** as the builder pointed out. Estimates include it where marked "+ owner". It covers:
   - Dutch proofreading of a few hundred strings (P-34, P-38);
   - about 10 hours of catalogue review (P-23);
   - public wording on screening and privacy (P-03, P-05, P-31);
   - counsel review (P-29);
   - conversations with members and the Obdam organiser (G-2).

Rows marked **G-n** are gaps the judges found that no proposal covered. They are not scored.

### 3.2 Now: weeks 1-4 (2 Nov – 27 Nov 2026)

Fix-programmes for the two High findings and the most exploitable Medium findings, all three UX blockers, the first-session data loss, and cheap, high-value slices. Rows are in the suggested order.

| ID              | Title                                                                                                                                                                                  | Theme                      | Effort         | Score | Why now                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1             | Backups and a tested restore                                                                                                                                                           | Platform & delivery        | S              | —     | SEC-01 is "irreversible" only because there is no restore. The repo has no backup workflow. Turn on scheduled Convex backups for prod (or schedule `npx convex export` to EU storage) and restore once into a scratch deployment. This is the cheapest mitigation in the whole portfolio and protects every later migration. The builder and strategist both raised it. |
| P-01 (Phase A)  | Claim-once rule for copy and completion photos; no raw storage ids in responses; dangling box-art check on prod                                                                        | Fix & harden               | S–M (2 days)   | 4.47  | Highest score. SEC-01 is High, confirmed and scriptable: one script can wipe catalogue box art for good. It also closes SEC-06 and unblocks P-06's cover persistence.                                                                                                                                                                                                   |
| P-07 (slice)    | Filter `undefined` out of `getAllBrands`; render each filter independently                                                                                                             | Core collector loop        | S              | 2.42  | UX-01 blocker: catalogue Filters never load for anyone, and brand autocomplete breaks in 4 forms. One line.                                                                                                                                                                                                                                                             |
| P-05 (slice)    | `grid-cols-1` and `break-all` on the Edit Profile form                                                                                                                                 | Fix & harden               | S              | 4.03  | UX-03 blocker: the only Private switch after onboarding is unreachable on phones. Two classes.                                                                                                                                                                                                                                                                          |
| P-32 (slice)    | Read the `sidebar_state` cookie; messages split view from `lg` with composer `min-w-32`; wrap PageHead and MobilePageActions; preferences `@container` on a wrapper                    | Experience & accessibility | S              | 3.28  | UX-02 blocker (34px composer on tablets), plus UX-04, UX-05 persistence and UX-33. Every page benefits.                                                                                                                                                                                                                                                                 |
| P-41 (slice)    | A1: move `CopyInstanceScreen` out of the route file; B1: pin Vercel functions to `dub1`; a test that route modules export only `Route`                                                 | Platform & delivery        | S              | 3.28  | Measured −31% entry JS on every page. SSR moves to the EU, closing SEC-88. A1 must land before P-06 and P-17 edit `copies/$id.tsx`.                                                                                                                                                                                                                                     |
| P-39 (slice)    | Ruleset on `main` requiring the CI jobs; web prod deploy after CI instead of Vercel's Git integration; SEC-60 trigger condition                                                        | Platform & delivery        | S–M            | 3.20  | Every fix below ships through this. Today a red `main` can reach members, and web can run against an old backend (01 §8.4). Run one preview through the CI build first.                                                                                                                                                                                                 |
| P-22 (slice)    | `SignUpLink` forwards props and ref; og/twitter tags on invite profiles; `noindex` on `?invite`                                                                                        | Community & growth         | S              | 3.32  | UX-13: the invite landing's only call to action renders as plain text. Invites are the one channel that works.                                                                                                                                                                                                                                                          |
| P-35 (slice)    | Contrast tokens (`--mk-text-muted`, `--muted-foreground`, `--success-strong`); labelling pass (skip link, `<nav>`, `bellWithCount`, names on Browse and catalogue controls)            | Experience & accessibility | S              | 2.75  | UX-08, 09, 10 (part), 12, 15, 25 (names), 107. About 88% of 3,138 axe nodes come from these root causes.                                                                                                                                                                                                                                                                |
| P-37 (slice)    | Install tip hidden on immersive routes and `/welcome`; ✕ snoozes instead of "never"; Toaster offset above the tab bar                                                                  | Experience & accessibility | S              | 2.83  | UX-07 (top-10 #7) and UX-61: the tip covers about 27% of every phone screen, including the newest chat messages.                                                                                                                                                                                                                                                        |
| P-38 (slice)    | `useFormatter` on `/catalog/<id>`; oxlint rule against argument-less `toLocale*String()`; `nl-style.test.ts` in report-only mode                                                       | Experience & accessibility | S              | 3.72  | UX-63: a hydration error and wrong number format for Dutch visitors in production. The test produces the list for the later Dutch pass.                                                                                                                                                                                                                                 |
| P-40 (slice)    | Global `MutationCache`/`QueryCache` `onError` with a localized toast; `describeConvexError()`                                                                                          | Platform & delivery        | S              | 2.78  | About 150 mutations fail silently (UX-37, UX-101-103). One place fixes the class.                                                                                                                                                                                                                                                                                       |
| P-31 (slice)    | Withdrawable analytics consent; PostHog identifies by opaque id, strips query strings, `reset()` on sign-out, no capture on messaging routes                                           | Trust & safety             | S              | 3.43  | GDPR Art. 7(3) (UX-75), SEC-47, SEC-59. Legally overdue and cheap.                                                                                                                                                                                                                                                                                                      |
| P-30 (slice)    | "Photo appeals" admin tab on the existing `listImageReviewRequests` and `decideImageReview`                                                                                            | Trust & safety             | S              | 2.17  | UX-50: the docs promise a moderator review that nobody ever sees. The backend exists.                                                                                                                                                                                                                                                                                   |
| P-06 (step 1)   | Offers off by default; land on the new copy; retitle copy mode                                                                                                                         | Core collector loop        | S              | 4.18  | UX-19, UX-92, UX-95: single add currently puts new copies on the market.                                                                                                                                                                                                                                                                                                |
| P-02 (core)     | Settlement guard, `expectedPreviousOwner`, reserve on accept, exchange-party access rules (items 1-3 and 8); prod settlement audit and conflict migration                              | Fix & harden               | M (4 days)     | 4.20  | SEC-02 (High, reproduced) and SEC-09: a stale deal moves a copy, with its photos and solve history, out of a non-party's library.                                                                                                                                                                                                                                       |
| P-03 (Stage 1a) | Never serve quarantined bytes; record unchecked hashes honestly; admin "hash matching OFF" banner; truthful public wording                                                             | Fix & harden               | S (1.5 days)   | 3.35  | SEC-04 is safety-critical, and SEC-03's false assurance has legal weight. The score understates the urgency.                                                                                                                                                                                                                                                            |
| P-05 (core)     | Consented email sharing (SEC-08); identity-only MemberCard for reviews, comments, follow requests and loans (SEC-11, 12, 13); household reveal (SEC-10); one handle namespace (SEC-07) | Fix & harden               | M (4 days)     | 4.03  | The brand promise. Answering a trade request currently reveals the owner's verified email, and it stays visible after a decline.                                                                                                                                                                                                                                        |
| P-23 (Phase A)  | Catalogue integrity: approved definitions change only via proposals; `[ean, status]` index; barcodes released on reject; one batched admin notification                                | Community & growth         | S (1.5 days)   | 3.95  | SEC-05 and SEC-52. A precondition for seeding (P-23 Phase B), scanning (P-13) and import (P-14).                                                                                                                                                                                                                                                                        |
| P-04 (wave 1)   | Throttle the paid and anonymous endpoints; length caps on profile, review, comment and submission text; brand-only email From name                                                     | Fix & harden               | M (3.5 days)   | 3.25  | Closes SEC-14, 19, 21 and 27, and the cost and cap halves of SEC-20, 22, 26 and 28. Must land before anyone new arrives. The score is low only because the whole programme is L.                                                                                                                                                                                        |
| P-06 (rest)     | Quick-setup Continue commits picks; inline username; one step count; cover photo persisted (after P-01 Phase A); one add model; condition labels                                       | Core collector loop        | M (3 days)     | 4.18  | UX-16 (top-10 #8), 18, 24, 29, 83-85, 93, 96, 97, 100. Every newcomer hits this now. Items 4-8 are the cut line.                                                                                                                                                                                                                                                        |
| G-2             | Talk to the 13 members; ask the Obdam organiser one question                                                                                                                           | —                          | S (owner time) | —     | All three judges noted the personas are inferred from a review, not from real members. Before Next's product work, hold short conversations or run a 3-question survey. Contacting the organiser is outward-facing, so it is your call.                                                                                                                                 |

**Effort: about 24 owner-days, four full weeks.** That is the top of the 2-4 week range, so the order is the cut line. If week 4 slips, P-06 items 4-8 and P-04's anonymous-form budget move to the start of Next. The security rows don't move.

### 3.3 Next: December 2026 – February 2027 (through the Obdam fair on 20 February)

Finish the security programmes before opening wider, make the core loops correct, settle the language, seed the catalogue and add the guardrails that keep fixes fixed. The window is 13 weeks with about 2 holiday weeks, roughly 55 working days.

| ID                     | Title                                                                                                                                                                                                               | Theme                      | Effort                           | Score | Why next                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-09                   | A solve log members can trust: recorded times shown, edits that work, in-progress made easy                                                                                                                         | Core collector loop        | M                                | 3.87  | Correctness bugs in the heartbeat loop (UX-48, 133-135; SEC-35). Its `date-input` helper lands first because P-10 needs it.                                                                            |
| P-10                   | Goals that mean what they say: period-scoped progress, edit, archive, delete                                                                                                                                        | Core collector loop        | M (3 days)                       | 3.38  | **Deadline: mid-December.** New yearly goals currently jump to the lifetime count and show "Achieved" (UX-42). Members set 2027 goals in January.                                                      |
| P-02 (rest)            | Sibling resolver, loans as reservations (SEC-36), back out after accept, status chip, Browse leaves out held copies                                                                                                 | Fix & harden               | M                                | 4.20  | Completes the integrity programme. Ship it as one stack with P-15, which carries the Withdraw UI and error copy.                                                                                       |
| P-15 (core)            | Whose turn it is, errors that show, a guarded final hand-over, the offered price, phone-friendly rows                                                                                                               | Sharing & exchange         | M                                | 3.73  | Top-10 #10 (UX-35, 36, 37, 40, 113). The confirmation timestamps are already sent and unused.                                                                                                          |
| P-17                   | One Sharing card: offers that respect privacy, circle share picker and unshare, explained permissions                                                                                                               | Sharing & exchange         | M                                | 3.68  | UX-20 is an ongoing privacy defect: one-tap offers publish private copies and never revert them. A prerequisite for P-08 and P-18. Sharing defaults and the asking price can slip.                     |
| P-05 (rest)            | Privacy card on `/profile` with Undo; Public/Private badge; bundled privacy lows                                                                                                                                    | Fix & harden               | M (3 days)                       | 4.03  | UX-117, UX-120, SEC-34, 37, 39, 40, 43, 44, 45, 80, 90. "See what others see" is optional.                                                                                                             |
| P-04 (wave 2)          | Harassment throttles (follow, propose, DM email, feed); safe outbound calls (push endpoints, URL import); `requireMember` everywhere                                                                                | Fix & harden               | M                                | 3.25  | SEC-15, 16, 23, 24, 25, 30, 50, 51, 53. These must be in place before strangers can reach members. Turnstile only if you choose it (§6).                                                               |
| P-03 (Stage 1b)        | Image-pipeline guards (one fixture per bypass), RevealGuard for admins, hash-pending index fix, confirmed "Close escalation"                                                                                        | Fix & harden               | S–M                              | 3.35  | SEC-17, 18, 55, 72, 76, 77, 91; UX-141, 144. Needs a malicious member to exploit, so it comes after Stage 1a.                                                                                          |
| P-43 (slice)           | Clamp client sizes; page admin, contact and inbox lists (inbox via the existing `by_member_activity` index); build the visibility context once; non-live pulse feed; delete `getExchangeStats`; `puzzles.by_status` | Platform & delivery        | S–M                              | 1.92  | The read-side halves of SEC-22, 24, 26, 30 and 49, and perf #5, #8, #9 and #11. Pulled forward despite the low score: the low score belongs to the parked read models (§5.1), not to these quick wins. |
| P-07 (slice)           | Catalogue text search on the existing search index; Browse on an `isOpen` index with newest-first paging                                                                                                            | Core collector loop        | M (3 days)                       | 2.42  | SEC-29 (Medium: one member can freeze Browse), UX-26, UX-27, perf #1. This is the simple fix, not the listings read model.                                                                             |
| P-34                   | One vocabulary: glossary, a copy-only PR, a glossary test                                                                                                                                                           | Experience & accessibility | M (3 days, + owner)              | 3.67  | The one root cause across all three persona journeys (UX-53). Must come before P-38. The `/trades` → `/exchanges` rename is optional.                                                                  |
| P-38 (rest)            | Dutch sentence case, "stukjes", locale-correct formatting, no hard-coded English, Dutch push                                                                                                                        | Experience & accessibility | M (3 days, + owner)              | 3.72  | Dutch quality is the main edge over MySpeedPuzzling (market §1). Runs after P-34 so each string is touched once.                                                                                       |
| P-23 (Phase B)         | Admin bulk import at `/admin/puzzles/import`; seed about 600 JvH, Wasgij and top Dutch titles                                                                                                                       | Community & growth         | M (5 days, + ~10 h owner review) | 3.95  | **Deadline: 20 Feb 2027 (Obdam).** Start the tooling in December so review runs through January. Nine approved puzzles starve every loop. Settle the box-art rights question first (§6).               |
| P-32 (wave 1)          | Compact tablet tier (icon rail at 768-1279px); profile hero container queries; phone preference headers; ResponsiveDialog for the six form dialogs                                                                  | Experience & accessibility | M (5 days)                       | 3.28  | UX-05, 31, 32, 34, 60. Marco's iPad journey and older members' tablets.                                                                                                                                |
| P-45 (core)            | Public-surface manifest, generic gate tests, canary privacy fuzz, security regression ledger, README and CONTRIBUTING truth, type-enforced notification enum sync points                                            | Platform & delivery        | M (5 days)                       | 2.88  | Locks in Now's fixes against agent-introduced regressions. The builder added the enum point (G-3): at least six proposals add notification kinds, so make the sync points type-enforced first.         |
| P-39 (rest)            | Smoke checks and auto-rollback, basic security headers, CSP report-only, pinned actions, `no-store` and CSRF on auth responses, PostHog proxy, PR template                                                          | Platform & delivery        | M (3 days)                       | 3.20  | SEC-58, 61, 62, 63, 73, 74. Cheap and high-leverage once the CI-gated deploy from Now works.                                                                                                           |
| P-29 (minimum)         | `/safety` page with points of contact; statements of reasons for automated photo rejections; a reason dialog for catalogue rejection; report puzzle reviews and comments                                            | Trust & safety             | M (3 days, + counsel)            | 2.73  | DSA duties that apply at any size (market §4), UX-49 and roadmap #3. Cheap, and needed before opening wider.                                                                                           |
| **Cut line**           | _Everything above is about 60 owner-days. Rows below are next in line and roll into Later if February runs out._                                                                                                    |                            |                                  |       |                                                                                                                                                                                                        |
| P-14 (export)          | Collector CSV export (Dutch-Excel friendly) and a complete GDPR export                                                                                                                                              | Core collector loop        | M                                | 3.35  | SEC-66: the privacy policy promises an export the code doesn't deliver. Until this ships, make the policy text match what the export actually covers.                                                  |
| P-31 (rest)            | Erasure gaps, processors named in the policy, List-Unsubscribe, push unsubscribed on sign-out, AhaSend log redaction, PostHog person deletion                                                                       | Trust & safety             | M                                | 3.43  | SEC-32, 54, 57, 64, 68-70, 75, 79, 84, 93. Low severity each, but together they decide whether the policy is true.                                                                                     |
| P-16 (slice)           | Return-by presets; due dates shown; "On loan" instead of "Completed"; a Loans tab from the unused `lentOut` query; `/borrowed` redirect                                                                             | Sharing & exchange         | M (3 days)                       | 3.25  | UX-36, 38, 39. Lending is the founding family use case, and the backend already accepts `loanReturnDate`.                                                                                              |
| P-22 (PR1 rest, PR2-3) | Invite-aware hero; AuthShell around sign-up; invite hardening (SEC-31, 33, 42, 82); one QR button that copies what it shows                                                                                         | Community & growth         | M (3 days)                       | 3.32  | UX-73, 123, 184. Needed before invites are pushed beyond family.                                                                                                                                       |
| P-44 (starter)         | Persona seed replacing the dev export for previews (SEC-94); public-route geometric and axe checks at 390, 820 and 1440 in EN and NL, non-blocking                                                                  | Platform & delivery        | M (3 days)                       | 2.47  | Verification is the bottleneck. The review's one-off capture run found every blocker; this keeps them found.                                                                                           |
| Small-slice lane       | 13 slices of about a day each from Later proposals, for when a big item waits on review (listed below)                                                                                                              | mixed                      | ~9 days                          | —     | Each closes a visible dead end cheaply.                                                                                                                                                                |

**Small-slice lane:**

- P-33: Messages icon with an unread count in the phone top bar, `sr-only` counts and real quick-action destinations (UX-06 in part, UX-09, UX-58).
- P-18: wire the Browse heart to favourites, and add a `/wishlist` page listing them (UX-25, roadmap contradiction #2).
- P-20 Phase B: "Last solved complete on 3 Oct" on the copy page and in the request dialog.
- P-08: collection picker includes unoffered copies; collection create feedback and delete; a confirmed Recall; an honest empty-filter state (UX-21, 101-103).
- P-11: Insights chart accessibility, zero-month baseline, the phone toggle, translated "Unknown" (UX-45-47, 136, 137).
- P-36: theme and language radios with checked state, reachable on phones (UX-56, 57).
- P-26: circle rename, description and house rules; owner-only Admin removal (SEC-86).
- P-19: "New to JigSwap" instead of "0.0 ☆☆☆☆☆", plus the one-time scam banner on sale threads (UX-121).
- P-41: physics loaded on interaction, three.js gated on phones, render on demand, self-hosted fonts (A2, A3, D2, C5; SEC-65).
- P-24: `seoHead` on `/` and the docs, docs lookup in a loader so missing pages return a real 404 (UX-14 in part).
- P-37: What's new entries collapsed with dynamic bodies; the update prompt collapses after 60 seconds (UX-90, perf A5).
- P-35: `FilePickButton` on all three photo pickers (UX-11, WCAG A).
- P-13 Phase 1: USB barcode scanners in the add picker, after P-23 Phase A.

**Effort: about 60 owner-days above the cut line, which fills the window; about 26 below it.** Expect most of the below-the-line work to land in March.

### 3.4 Later: March 2027 onwards (3-6+ months)

Start with whatever is left below Next's cut line. After that, this is a menu: each row names its trigger. Rows are ordered by score.

| ID               | Title                                                                                               | Theme                      | Effort    | Score | Why later / trigger                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------- | --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-01 (Phase B)   | Upload ledger and storage garbage collection                                                        | Fix & harden               | M         | 4.47  | Not urgent at 13 members: P-04's upload bucket caps growth meanwhile. Must come before P-42. Fix SEC-92's reference coverage first, and use the lighter ledger written by the existing mutations (§4). |
| P-31 (retention) | Retention engine and a policy-to-code test                                                          | Trust & safety             | M         | 3.43  | Notifications, presence, contact messages, reports and photo TTLs can start any time. Trim `domainEvents` only once P-43's memberFeed exists, or once nothing reads events older than the feed window. |
| P-14 (import)    | Spreadsheet import wizard                                                                           | Core collector loop        | L         | 3.35  | **Trigger:** P-23 seeding is done. Before that, almost every row becomes a "New" definition for one admin to review.                                                                                   |
| P-03 (Stage 2)   | Real CSAM matching through an EU relay                                                              | Fix & harden               | M         | 3.35  | Only if you choose it (§6). Otherwise Stage 1's plain statement stands.                                                                                                                                |
| P-26 (rest)      | Circle invite links with admin approval; "new in your circle" digest                                | Community & growth         | M         | 3.33  | Invite links follow P-22's hardening. The digest follows P-18, so wishlisted puzzles can rank first.                                                                                                   |
| P-22 (PR4-5)     | Private inviter panel; a `ref` code stored as one source column                                     | Community & growth         | S–M       | 3.32  | Not a cohort dashboard: at 13 members every cell would read "<3".                                                                                                                                      |
| P-32 (rest)      | Container-query migration, PageHead v2, a touch variant, the ConfirmAction ladder                   | Experience & accessibility | L         | 3.28  | Incremental, verified with P-44. ResponsiveDialog alone touches 58 dialog files.                                                                                                                       |
| P-41 (waves 2-3) | i18n namespaces, lazy Clerk Dutch locale, per-page docs, per-route budgets in CI, real-user metrics | Platform & delivery        | L         | 3.28  | After P-34 and P-38 settle: the namespace split touches every `useTranslations` call.                                                                                                                  |
| P-16 (rest)      | Owner-initiated "Lend to…", gentle reminders, extensions                                            | Sharing & exchange         | L         | 3.25  | **Trigger:** loans are in real use after Next's slice. Build the `return_pending` state machine only if disputes about returns appear.                                                                 |
| P-33 (rest)      | Labelled tabs, URL-held list state, Back that restores filters and scroll                           | Experience & accessibility | L         | 2.87  | Tab labels reverse a deliberate design decision (§6). The shared `useListSearchState` hook comes first.                                                                                                |
| P-37 (rest)      | One interruption per session; help and guides findable                                              | Experience & accessibility | M         | 2.83  | A simple rule, not the full PromptCoordinator.                                                                                                                                                         |
| P-40 (rest)      | Cookieless error intake, SSR wide events, a few alerts, uptime check, `QueryState`                  | Platform & delivery        | M         | 2.78  | The capacity panel stays parked.                                                                                                                                                                       |
| P-35 (rest)      | Focus restoration, accessible StarRating, keyboard reordering, accessibility statement              | Experience & accessibility | L         | 2.75  | Background work behind P-32 and P-44. Publish the statement only when it can honestly list the known gaps.                                                                                             |
| P-29 (rest)      | Anonymous public notice form, appeals table, Art. 18 path                                           | Trust & safety             | M–L       | 2.73  | After counsel scopes a micro platform's duties (§6).                                                                                                                                                   |
| P-08 (rest)      | Library search, sort, paging and bulk actions                                                       | Core collector loop        | L         | 2.68  | **Trigger:** import (P-14) brings libraries of 100+ copies.                                                                                                                                            |
| P-18 (rest)      | Wishlist with availability view and match alerts                                                    | Sharing & exchange         | L         | 2.67  | **Trigger:** enough offered copies in circles to match against. Alerts need P-04's throttles and P-31's List-Unsubscribe.                                                                              |
| P-25             | Shareable swap lists for Facebook, Reddit and WhatsApp groups                                       | Community & growth         | M         | 2.65  | After P-05's SEC-37 fix. Start with a plain page and "Copy as post text".                                                                                                                              |
| P-24 (rest)      | Locale URLs (`/nl/…`), hreflang, Dutch prerendering, slug URLs, structured data                     | Community & growth         | L         | 2.63  | Before P-23's brand hubs and P-28's guides. URL changes are cheapest while only 9 catalogue pages are indexed.                                                                                         |
| P-42             | Image renditions and CDN-cacheable public box art                                                   | Platform & delivery        | M         | 2.60  | After P-01 Phase B. **Trigger:** the catalogue passes about 100 entries, or mobile image bytes show up in real-user metrics.                                                                           |
| P-36             | Settings hub                                                                                        | Experience & accessibility | M         | 2.53  | When settings outgrow the profile page. The text-scale system stays parked.                                                                                                                            |
| P-20 (Phase A)   | A working dispute path                                                                              | Sharing & exchange         | M         | 2.47  | **Trigger:** the first real dispute, or exchanges between strangers. Phase C stays parked.                                                                                                             |
| P-28             | Dutch puzzle guides and a partner kit                                                               | Community & growth         | M + owner | 2.47  | Start with 2-3 guides once invites and catalogue coverage convert. The cost is your writing and outreach time.                                                                                         |
| P-44 (rest)      | Journey specs, Dutch and dark-mode axe, a few masked snapshots                                      | Platform & delivery        | L         | 2.47  | After the Next starter has run stably for two weeks. No 10k-member scale fixture.                                                                                                                      |
| P-07 (rest)      | Browse listings read model, circle, brand and type filters, new layouts                             | Core collector loop        | L         | 2.42  | **Trigger:** open listings approach about 300, or Browse p95 slows.                                                                                                                                    |
| P-11 (rest)      | Records strip and a private "Year in Puzzles" recap                                                 | Core collector loop        | M         | 2.37  | Decide by 1 December whether a 2026 recap is worth December capacity; the judges lean no. Group challenges stay parked.                                                                                |
| P-30 (rest)      | Account restrictions and moderation queue ergonomics                                                | Trust & safety             | L         | 2.17  | **Trigger:** abuse that a Clerk ban plus a written runbook can't handle. Write the runbook now (about an hour).                                                                                        |

**Effort: about 150 owner-days if everything listed were built, more than six months at full focus.** The judges' shared advice: expect to build perhaps half, chosen by the triggers.

### 3.5 Where each High and Medium security finding is fixed

By the end of Next, every High and Medium finding is closed except three deliberately deferred parts:

- the real fix for SEC-03, which is your decision;
- the storage garbage-collection half of SEC-20 (P-01 Phase B);
- the memberFeed half of SEC-30 (parked with P-43 Phase C; the per-actor caps and non-live feed in Next mitigate it).

| Finding                                                   | Severity | Fixed by                                                                                     | When                       |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| SEC-01 box art deletable through storage ids              | High     | P-01 Phase A                                                                                 | Now                        |
| SEC-02 stale settlement moves a non-party's copy          | High     | P-02 core                                                                                    | Now                        |
| SEC-03 CSAM hash check inert                              | Medium   | P-03 Stage 1a (honest state and wording); real matching in Stage 2                           | Now; Stage 2 your decision |
| SEC-04 quarantined bytes served to admins                 | Medium   | P-03 Stage 1a                                                                                | Now                        |
| SEC-05 barcode hijack via approved definition             | Medium   | P-23 Phase A                                                                                 | Now                        |
| SEC-06 wrong uploader on CSAM escalations                 | Medium   | P-01 Phase A (delete `addCopyImage`)                                                         | Now                        |
| SEC-07 slug takes over a username                         | Medium   | P-05 core                                                                                    | Now                        |
| SEC-08 verified email revealed after one reply            | Medium   | P-05 core                                                                                    | Now                        |
| SEC-09 exchange-party access survives ownership changes   | Medium   | P-02 core (item 8)                                                                           | Now                        |
| SEC-10 household invite reveals the account name          | Medium   | P-05 core                                                                                    | Now                        |
| SEC-11 private fields leak via raw `toMemberView`         | Medium   | P-05 core                                                                                    | Now                        |
| SEC-12 reviews de-anonymise reviewers                     | Medium   | P-05 core                                                                                    | Now                        |
| SEC-13 private members listed via follower lists          | Medium   | P-05 core                                                                                    | Now                        |
| SEC-14 unbounded display name in email From               | Medium   | P-04 wave 1                                                                                  | Now                        |
| SEC-15 DNS rebinding past the SSRF guard                  | Medium   | P-04 wave 2                                                                                  | Next                       |
| SEC-16 push subscriptions accept any endpoint             | Medium   | P-04 wave 2                                                                                  | Next                       |
| SEC-17 PNG bomb guard bypass                              | Medium   | P-03 Stage 1b                                                                                | Next                       |
| SEC-18 decode past memory limit; re-attachable crash blob | Medium   | P-01 Phase A (no re-attach), P-04 wave 1 (photo buckets), P-03 Stage 1b (pixel cap)          | Now + Next                 |
| SEC-19 unthrottled photo paths                            | Medium   | P-04 wave 1                                                                                  | Now                        |
| SEC-20 unlimited upload URLs, no GC                       | Medium   | P-04 wave 1 (upload bucket); P-01 Phase B (GC)                                               | Now; GC Later              |
| SEC-21 Firecrawl drain                                    | Medium   | P-04 wave 1                                                                                  | Now                        |
| SEC-22 anonymous contact and doc-feedback floods          | Medium   | P-04 wave 1 (budget, literal locale); P-43 slice (paged inbox)                               | Now + Next                 |
| SEC-23 follow loops flood notifications                   | Medium   | P-04 wave 2                                                                                  | Next                       |
| SEC-24 propose/cancel floods an inbox                     | Medium   | P-04 wave 2 (per-pair caps, cooldown); P-43 slice (inbox paging)                             | Next                       |
| SEC-25 one email per message                              | Medium   | P-04 wave 2                                                                                  | Next                       |
| SEC-26 catalogue submission floods                        | Medium   | P-04 wave 1 (caps, daily cap); P-23 Phase A (batched notification); P-43 slice (paged queue) | Now + Next                 |
| SEC-27 profile fields bypass caps                         | Medium   | P-04 wave 1                                                                                  | Now                        |
| SEC-28 uncapped comments and reviews, no report path      | Medium   | P-04 wave 1 (caps, limits); P-29 minimum (report path); P-31 (author delete)                 | Now + Next                 |
| SEC-29 Browse frozen by the oldest 500                    | Medium   | P-07 slice (`isOpen` index, paging)                                                          | Next                       |
| SEC-30 one account wipes the activity feed                | Medium   | P-04 wave 2 (per-actor caps); P-43 slice (non-live feed)                                     | Next; memberFeed parked    |

### 3.6 Where the UX blockers and majors are fixed

| When  | Findings                                                                                                                                                                            | Through                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Now   | **All three blockers** (UX-01, 02, 03); majors UX-04, 05 (sidebar persistence), 07, 08, 09, 10 (in part), 12, 13, 15, 16, 18, 19, 24, 25 (names), 29, 33, 50                        | The hotfix slices and P-06                                                                    |
| Next  | UX-05 (tablet tier), 06 (Messages), 11, 14 (meta and 404s), 20, 21, 23, 26, 27, 30, 31, 32, 34, 35, 36, 37, 38, 39 (below the cut line), 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 52 | P-09, P-10, P-15, P-17, P-32 wave 1, P-34, P-38, P-07 slice, P-16 slice, the small-slice lane |
| Later | UX-06 (tab labels), 14 (locale URLs), 17 (3D shelf crop), 22 (library scale), 28 (Back restores state), 51 (admin detail pane)                                                      | P-33, P-24, P-32, P-08, P-30                                                                  |

---

## 4. Proposal details

Proposals are grouped by theme and listed in ID order. Each opens with a status line: type, effort, priority score, cut votes, the lens proposals it was merged from, and where it sits on the roadmap. The judges' scores are given as value/feasibility/fit/urgency.

### 4.1 Fix and harden

#### P-01 · Storage capability model: claim-once uploads, no raw storage ids in responses, safe garbage collection

Fix-programme · effort M · score **4.47** · cut votes 0 · from TRUST-1, PLATFORM-9, CORE-1 · **Now** (Phase A), **Later** (Phase B)

- **Problem.** SEC-01 is the most severe finding: High, and confirmed in 4 review slices.
  - Three photo-attach paths accept any existing `_storage` id: `addCopyPhoto.ts:41-46`, `addCopyImage.ts:22` and `attachCompletionPhotos.ts:45-51`.
  - Box-art ids reach every member through three read paths: the copy snapshot thumbnail (`convexCatalogSnapshotProvider.ts:42`, `mappers.ts:86`), exchange views (`readViews.ts:159`) and change proposals (`proposalReadModel.ts:62-65,102-103`).
  - Attaching a box-art id and then removing it, or letting the moderation swap run, permanently deletes the catalogue box art. One script can wipe the public catalogue and its SEO pages, and nothing can undo it.
  - Related findings:
    - SEC-06: the wrong uploader is recorded on CSAM escalations, through `library.addImage`, which has no web caller (01 §2.4).
    - SEC-18: a crash blob can be re-attached without limit.
    - SEC-20: upload URLs are unthrottled and nothing sweeps unclaimed blobs.
    - SEC-81: `deleteCopy` leaves blobs behind.
    - SEC-92: `isReferenced` misses `mapFileId`, `thumbFileId` and legacy `completions.photos`, so a naive sweep would delete live data.
    - SEC-38: the previous owner can't delete their own photos after a transfer.
- **Proposal.**
  - _Phase A (1-2 days):_
    - Add `lib/storage/claimFreshUpload.ts`. It applies the rule box art, message photos and circle icons already use: the blob must exist, be fresh within the 15-minute `BOX_ART_CLAIM_WINDOW_MS`, be unreferenced and not be preserved. Call it from `addCopyPhoto` and `attachCompletionPhotos`.
    - Delete `addCopyImage` and the gateway op `library.addImage`.
    - `deleteBlobIfOrphaned` replaces the raw `ctx.storage.delete` in `removeCopyPhoto`, `deleteCompletion` and the pipeline's `deleteUnlessPreserved`.
    - Return URLs instead of ids: `toOwnedCopyView` emits `thumbnailUrl`, the exchange read views map image to a URL, and `enrichProposal` resolves images to URLs.
    - Run a new internal `findDanglingBoxArt` query on prod, and add a "Missing cover" pill with a re-upload action to `/admin/puzzles`.
  - _Phase B (3-4 days):_
    - Fix reference coverage first: a `by_map_file` index, `thumbFileId`, P-42's renditions, and a backfill of legacy `completions.photos`. One `blobReferences.test.ts` covers every reference kind.
    - Add an `uploads` ledger (`storageId`, `uploaderId`, `purpose`, `createdAt`, `claimedAt?`, `claimedRef?`). A claim requires `uploaderId === actor` and no earlier claim.
    - A daily, paged, self-rescheduling GC deletes unclaimed uploads older than 24h, box art that was never attached, and the blobs of deleted copies. It runs log-only for a week, then deletes with a 7-day soft-delete grace period.
    - The uploader may remove their own photo after a transfer (SEC-38).
    - The proposal writes the ledger from a new authenticated, streaming `POST /upload` httpAction behind a `useUpload(purpose)` hook. The builder and strategist judged that heavier than the risk needs; **a ledger written by the existing `generateUploadUrl` mutation is the recommended version.**
- **Devices.** No visible change on any viewport, except the admin "Missing cover" pill.
- **User value.** Catalogue art, JigSwap's public face and SEO, can no longer be vandalised, and nobody can delete another member's photos. Moderation records name the real uploader, and storage stops growing without bound.
- **Dependencies.**
  - Phase A: none.
  - Phase B: P-04's upload bucket, and P-42's renditions registered before GC goes live.
  - P-45's canary checks generically for leaked `_storage` ids.
  - P-06's cover persistence and P-20's evidence photos wait for Phase A.
- **Risks.**
  - A claim window that is too short refuses slow mobile uploads; reuse the 15-minute window and watch refusals in Axiom.
  - A missed reference kind would make GC delete live blobs. Mitigations: fix SEC-92 first, a 24h margin, a log-only week and soft delete.
  - Check that no scripts call `addCopyImage`.
- **Success metrics.**
  - Repro tests for all three attach paths and all three id leaks pass.
  - `findDanglingBoxArt` returns 0, or every hit is restored.
  - 0 `_storage` ids in any public response.
  - 0 unclaimed blobs older than 48h once GC runs.
  - 100% of new copy-photo rows record the actor as uploader.
- **First step.** PR "fix(library): claim-once rule for copy and completion photos", containing:
  - `claimFreshUpload` in both attach paths;
  - deletion of `addCopyImage` and `library.addImage`;
  - convex-test regressions showing a leaked box-art id is refused and the box-art blob survives `removeCopyPhoto` and `deleteCompletion`;
  - the internal `findDanglingBoxArt` query.
- **Scores.** member 4/4/4/5 · builder 5/4/5/5 · strategist 5/4/5/5.
- **Judges' take.** Unanimously the first item: ship Phase A this week. All three say Phase B isn't urgent at 13 members. The builder adds that a backup schedule is the real undo (now G-1).

#### P-02 · Exchange integrity: one copy, one deal

Fix-programme · effort M (the builder: "really L") · score **4.20** · cut votes 0 · from SHARE-1, TRUST-2, CORE-1 · **Now** (items 1-3 and 8, plus the audit and migration from item 10), **Next** (items 4-7 and 9, plus the daily invariant query)

- **Problem.** SEC-02 (High, reproduced): ownership is checked only when an exchange is proposed (`propose-exchange.ts:78,113-135`).
  - `settle()` emits `OwnershipTransferred` with no expected previous owner, and `Copy.transferTo` overwrites `ownerId` without checking (`copy.ts:163-170`).
  - Several accepted exchanges can sit on one copy. A stale one moves the copy, with its photos and solve history, out of the library of an owner who was never a party to it. That owner can't see or cancel the exchange, and can't delete the copy.
  - A household variant exists: a removed housemate's swap still settles.
  - The use case calls reservation "intentionally not done".
  - Related findings:
    - SEC-36 and UX-94: an open loan doesn't reserve the copy, so a lent-out copy can be re-offered, lent again or sold.
    - SEC-09: exchange-party access survives an A→B→C ownership chain.
    - SEC-85: propose checks the block before reachability.
    - Browse ignores `heldBy`.
    - Only the initiator can cancel (`exchange.ts:141`), so after accept nobody can back out.
- **Proposal.**
  1. A settlement guard on `confirmCompletion`. It refuses unless the requested copy is still owned by the recipient (and, for a swap, the offered copy by the initiator or a co-managing housemate). Otherwise the exchange is cancelled with `copy_no_longer_available` and both sides are told.
  2. `OwnershipTransferred` carries `expectedPreviousOwner`, and `Copy.transferTo` throws `OwnershipChanged` on a mismatch and closes any open loan.
  3. Reserve on accept: accept is refused while either copy is in another accepted exchange or on an open loan. Multiple proposals stay allowed.
  4. A sibling resolver. On a transfer, possession change, deletion, offer withdrawal or household change, it declines or cancels the other exchanges on that copy. It reuses `trade_declined`/`trade_cancelled` with a reason parameter and is idempotent.
  5. Loans as reservations (SEC-36): one open loan per copy, and return or recall applies only to the current loan.
  6. The owner is notified when a co-manager offers their copy.
  7. Either party can withdraw after accept, giving a reason.
  8. Exchange-party access counts only exchanges in which the current owner was a party (SEC-09), and `canViewCopy` runs before the block check (SEC-85).
  9. A status chip ("On loan · back ~12 Nov", "Deal agreed"), a disabled request button with an explanation, and Browse leaving out copies held by someone else.
  10. Operations: an `auditSettlements` query run once on prod, a one-off migration that cancels the older of any conflicting accepted exchanges, and a daily invariant query.
- **Devices.** No new layouts. On phones the chip sits in the card's meta line.
- **User value.** A puzzle in your library stays yours. "Accepted" means reserved for you, nobody can request a puzzle that is at someone else's house, and either side can step back before the hand-over.
- **Dependencies.** None. It is the foundation for P-15, P-16, P-18, P-20, P-21 and P-27's second phase.
- **Risks.**
  - Owners who used to accept several requests for one copy will be refused; explain this in What's new and in `lend-swap-trade.md` (EN and NL).
  - Sibling cancellation runs async and must be idempotent.
  - Prod may already hold conflicts, which the migration handles.
  - The 95% domain mutation threshold means every new transition needs spec tests.
- **Success metrics.**
  - The audit finds 0 settlements by a non-party, or the historical count is known and acted on.
  - The daily check finds 0 copies with more than one accepted exchange or open loan.
  - Both SEC-02 repros and the A→B→C chain pass as regression tests.
  - Browse lists 0 lent-out copies.
- **First step.** PR "fix(exchange): refuse settlement when ownership changed", containing:
  - `expectedPreviousOwner`;
  - the `transferTo` refusal;
  - the `confirmCompletion` guard;
  - both SEC-02 repros (sockpuppet sale and removed housemate) in `exchangeSettlementGuard.test.ts`;
  - the `auditSettlements` query.
- **Scores.** member 5/3/5/4 · builder 5/3/5/4 · strategist 5/3/5/4.
- **Judges' take.** Full agreement on value: "the worst trust breach a swap app can have". All three want items 1-3 (the strategist adds 8) first and the rest after. The member would drop item 6 and the daily invariant query to ship faster.

#### P-03 · Make the CSAM control real, or say plainly that it is off; make the image pipeline crash-proof

Fix-programme · effort L · score **3.35** · cut votes 0 · from TRUST-3 · **Now** (Stage 1a), **Next** (Stage 1b), **Later** (Stage 2, if you choose it)

- **Problem.** SEC-03: the CSAM hash check can't catch anything today.
  - The browser re-encodes every photo before upload (`prepare-photo.ts:108-110`), so exact hashes never match.
  - HCS allow-lists caller IPs, Convex has no fixed egress IP, and no proxy is implemented.
  - The default provider `none` stamps `hashCheckedAt` and drops the pending hashes, so nothing can be re-checked later, and `missing_config` counts as "no match".
  - Meanwhile the admin console shows a "Hash matches" tab and the privacy policy describes reporting illegal images: false assurance.
  - Which provider prod actually uses is unknown (01 §10).
  - Related findings:
    - SEC-04: `admin/getReport` can serve quarantined bytes through a permanent URL and copy them into evidence.
    - SEC-55: the hash-pending index blinds the admin indicator.
    - SEC-17: the PNG decompression-bomb guard can be bypassed; a 2 MB file peaks at 4.2 GiB.
    - SEC-18: the 25 MP limit decodes past the 512 MiB action limit, and a crash blob can stall the 4-slot moderation pool.
    - SEC-72: EXIF survives inside WebP animation frames, despite the policy's stripping promise.
    - SEC-76, 77 and 91: smaller pipeline issues.
    - UX-144: hovering lifts the blur on flagged images.
    - UX-141: closing a CSAM escalation needs no confirmation.
- **Proposal.**
  - _Stage 1a (about 1.5 days):_
    - `getReport` returns no URL for quarantined or hash-gated targets; `tombstoneMessage` never overwrites quarantined; `preserveEvidence` skips quarantined rows; `fileReport` accepts only approved, hash-cleared photos.
    - Under `none` or `missing_config`, leave `hashCheckedAt` unset and keep the pending hashes, marked "not checked", for a later backfill.
    - A red "CSAM hash matching: OFF / unreachable" banner with the count of published unchecked photos.
    - Truthful screening wording in the terms and privacy pages (EN, NL, source).
  - _Stage 1b (about 2.5 days):_
    - SEC-55.
    - A shared `<RevealGuard>` for admins: reveal on click, tap or key press, "Hide again", a 44px target, and photos reported as sexual or illegal always start blurred.
    - An AlertDialog on "Close escalation".
    - Pipeline guards with one test fixture per bypass: exactly one IHDR, first; refuse interlaced PNG; check dimensions after decode; a measured pixel cap of about 12 MP; jpeg-js memory caps; re-encode every WebP and refuse animated ones; a fresh WASM instance after large decodes; filenames derived from the mime type.
  - _Stage 2 (about a week, only if chosen):_
    - An EU fixed-egress relay that forwards only to HCS.
    - The browser hashes the original bytes before re-encoding and the server checks both sets. A client "no match" never counts as clearance.
    - A match runbook: preserve, report to Offlimits or the police (DSA Art. 18), don't notify the uploader.
- **User value.** Members, parents included, can trust JigSwap's photo-safety claims because they are true. Admins are never shown matched material, and one hostile file can't stall everyone's photo checks.
- **Dependencies.**
  - The full SEC-18 fix needs P-01's no-re-attach rule and P-04's photo buckets.
  - Stage 2 needs an Offlimits HCS account and your decision on hosting the relay.
  - P-29's `/safety` page quotes the honest wording.
- **Risks.**
  - A lower pixel cap refuses some direct-API originals. The client already caps the long edge at 1,600px.
  - The relay is a new always-on component with its own secret.
  - Public wording about screening has legal weight, so have it reviewed.
- **Success metrics.**
  - The banner matches the real provider state.
  - Tests prove no admin query returns quarantined bytes.
  - Every bomb fixture is refused before decode.
  - WebP with nested EXIF comes out clean.
  - After Stage 2, 100% of published photos are hash-checked.
- **First step.** PR "fix(moderation): never serve quarantined bytes; record unchecked hashes honestly", with the review's two repros, the hash-state change and the banner.
- **Scores.** member 3/3/4/4 · builder 4/3/4/4 · strategist 4/3/5/4.
- **Judges' take.** Unanimous that Stage 1 is mandatory now. All three lean against Stage 2's always-on relay at this scale and prefer "a plain public statement that hash matching is off", unless HCS access is cheap or already in hand. The member scores value lowest (3).

#### P-04 · Abuse-control layer: every write throttled, every free-text field capped, every outbound call safe

Fix-programme · effort L · score **3.25** · cut votes 0 · from TRUST-4, SHARE-3, COMMUNITY-2 · **Now** (wave 1), **Next** (wave 2)

- **Problem.** About 20 Medium findings share one root cause: write paths with no rate limit, free text with no length cap, and outbound calls with no guard. Convex functions can be called directly, so guards in the web app don't help. One free account can:
  - drain Firecrawl credits (SEC-21);
  - stream unlimited blobs into storage (SEC-20);
  - burn classifier spend and starve the moderation pool (SEC-19);
  - flood a victim's notifications, inbox and email (SEC-23, 24, 25);
  - anonymously flood the contact inbox, which is also the DSA and GDPR request channel (SEC-22);
  - break Find people with 950 KB bios (SEC-27);
  - bloat catalogue pages with 1 MB reviews, each notifying every admin (SEC-26, 28);
  - wipe everyone's activity feed (SEC-30);
  - send phishing From names from `no-reply@jigswap.site` (SEC-14);
  - make Convex POST to arbitrary hosts (SEC-16), or DNS-rebind past the URL-import SSRF guard (SEC-15, 50, 51).

  `RATE_LIMITS` already has 17 buckets but none in `library/`, `solving/`, `catalog/`, follow, exchange propose or household invite. Hand-rolled identity lookups skip the deactivated-account check (SEC-53).

- **Proposal.** A small policy layer, then one PR per area, each with the review's repro as its test.
  - Primitives:
    - `BoundedText` value objects: DisplayName 50, stripping control characters and refusing reserved names; Bio 500; Location 80; Comment 1,000; Review 2,000; Title 200; Description 5,000; Tags 20×50.
    - A `boundedString(max)` validator in place of bare `v.string()`.
    - Hourly and daily limit pairs.
    - A sharded `chargeGlobalBudget(name)` for paid providers.
  - Per-member buckets:
    - uploads, URL import and catalogue submission (with a daily cap on new definitions);
    - follow toggles;
    - exchange propose and cancel, with a per-pair cap of 3 open and 10 a week, and a 7-day cooldown after a decline;
    - household invite, comments, reviews, `acquireCopy` (generous: about 500 items a day for importers) and push subscriptions.
  - Anonymous forms: a deployment-wide hourly budget, `locale` as a literal union, and optionally a Turnstile check.
  - Fan-out throttles:
    - DM email per thread and recipient, plus a daily cap;
    - follow-request notifications collapsed per pair;
    - a brand-only From name, "JigSwap", with sanitised subjects;
    - per-actor feed caps;
    - a per-member MapTiler cap.
  - Outbound safety:
    - push endpoints restricted to an allowlist of push services, at most 10 per member, a 10s timeout and pruning;
    - one undici agent with a connect-time IP check and streaming size caps for URL import;
    - `requireMember` on `extractFromUrl`;
    - the small escapes SEC-78, 83 and 87.
  - Identity: hand-rolled `by_clerk_id` lookups switch to `requireMember` (SEC-53).
  - Observability: an alert on refusals and global-budget spend.
  - **Split.**
    - _Wave 1 (Now):_ the paid and anonymous endpoints, the caps on profile, review, comment and submission text, and the From name.
    - _Wave 2 (Next):_ social and exchange buckets with per-pair caps, fan-out throttles, outbound safety and SEC-53.
    - Turnstile and sharded global budgets only if logs show they are needed (strategist).
- **Devices.** One shared "Try again in N minutes" toast, and `maxLength` with a counter on bio, review and comment fields, on every viewport. Turnstile, if adopted, runs invisibly.
- **User value.** Members' inboxes, notifications and feeds can't be turned against them, and email from jigswap.site stays trustworthy. Provider bills get hard ceilings.
- **Dependencies.**
  - The upload bucket is shared with P-01.
  - Read-side fixes belong to P-43.
  - P-45 checks that every public mutation has a limiter or a reviewed exemption.
  - P-31 discloses Turnstile if it is adopted.
- **Risks.**
  - Limits that are too tight hurt importers and fair-goers; ship conservative limits with logging, then tune.
  - Global budget rows conflict, so shard them.
  - Existing over-long data needs grandfathering.
- **Success metrics.**
  - 100% of public mutations call a limiter or carry a reviewed exemption.
  - 0 bare `v.string()` in public args.
  - Every repro from SEC-14 to SEC-30 passes as a regression test.
  - Limit hits for normal members stay near 0.
- **First step.** PR "fix(abuse): throttle the paid and anonymous endpoints", containing:
  - an upload-URL bucket;
  - a URL-import bucket plus `requireMember` on `extractFromUrl`;
  - the contact and doc-feedback budget with a literal `locale`;
  - a repro test for each.
- **Scores.** member 4/3/4/4 · builder 4/3/4/4 · strategist 4/2/4/3.
- **Judges' take.** All three say it must land before strangers arrive, and that cost-bearing endpoints and the From name come first. The strategist rates feasibility 2 ("sprawling") and would defer Turnstile, sharded budgets and per-pair caps.

#### P-05 · Private means private: one privacy projection everywhere, consented contact sharing, reachable privacy controls

Fix-programme · effort L · score **4.03** · cut votes 0 · from TRUST-5, SHARE-3, COMMUNITY-1, COMMUNITY-3, COMMUNITY-5, CORE-4 · **Now** (UX-03 and the backend core), **Next** (Privacy card and the bundled lows)

- **Problem.** The privacy chokepoint, `projectMemberIdentity` with an HMAC `anonRef`, is sound. Data leaks wherever code uses the raw `toMemberView` (13 non-test files) or spreads a raw row.
  - SEC-11: private members' bio, location and language leak through puzzle reviews, comments, follow requests and loan views.
  - SEC-12: received reviews return a raw `exchangeId`, which de-anonymises reviewers.
  - SEC-13 and SEC-41: private members can be enumerated through follower lists.
  - SEC-10: a household invite reveals the account name behind a pseudonym.
  - SEC-08: any one-line reply to a trade request reveals the owner's verified email, which stays visible after a decline. The privacy policy doesn't mention this.
  - SEC-07: a pre-claimed slug takes over a later member's username, including their QR redirect.
  - Lows: SEC-34, 37, 39, 40, 43, 44, 45, 80, 90.
  - In the UI: on phones the only Private switch sits off-screen (UX-03, blocker); it saves instantly inside a Save/Cancel form (UX-117); and your own profile shows no visibility state (UX-120).
- **Proposal.**
  - _Backend (about 5 days):_
    - A `MemberCard` DTO {displayName, handle, avatar, memberId or anonRef, revealed}, built only by `projectMemberIdentity`. It replaces `toMemberView` in reviews (with an approved gate), comments, follow requests, loan views (with a block check) and the household person view. `toMemberView` remains for self reads only, and P-45 enforces that.
    - `listReviewsForMember` returns an explicit DTO without `exchangeId` and `revieweeId`, behind the profile-visibility gate.
    - Follower lists drop the `memberId` argument (you only see your own), and `followersYouKnow` respects hidden graphs.
    - **Consented contact sharing:** remove the reply-triggered reveal. The email is shown only after accept and an explicit "Share my email with {name}" switch on both sides, and is hidden again after a decline or cancel. The composer hints "Replying doesn't share your email", and the policy gets a line about it.
    - One namespace for slugs and usernames, redirecting only when a handle resolves back to the same member. Old URLs keep working.
    - The bundled lows.
  - _UI (about 3 days):_
    - Day 1: the two-class UX-03 fix (in the Now hotfix sweep).
    - An always-visible Privacy card on `/profile`: a "Public · findable / Private" segmented control with status text, instant save with a toast and Undo, removed from the Edit form, and a header badge linking to it.
    - "See what others see" through a `viewAs` argument that can only downgrade the viewer.
- **Devices.** The Privacy card is full-width with a 44px control on phones, above the form on tablets and in the right column on desktop.
- **User value.** "Private" means private everywhere, not just on the profile page. Answering a trade request no longer leaks your email, and newcomers on phones can reach the privacy switch.
- **Dependencies.**
  - P-45 provides the lint rule and the canary fuzz that prove the fix.
  - P-22's invite landing depends on the handle rule.
  - P-19 and P-25 build on the projected DTOs.
- **Risks.**
  - DTO changes ripple into web components, but gateway typing catches them.
  - Some members may rely on the revealed email to arrange hand-offs, so ship the share switch in the same change.
  - The wording must change in EN, NL, source and the docs together.
- **Success metrics.**
  - The repros for SEC-07, 08 and 10 to 13 pass as regression tests.
  - `toMemberView` appears only in allowlisted files.
  - The canary fuzz finds 0 private fields for a stranger or a blocked viewer.
  - 0 new reveals for the reason "owner replied".
  - The Private switch is reachable at 390px with a 30-character slug.
- **First step.** Two PRs on day 1:
  - the UX-03 fix;
  - "fix(privacy): identity-only shapes for reviews and follower lists".
- **Scores.** member 5/3/5/5 · builder 5/3/5/4 · strategist 5/3/5/4.
- **Judges' take.** Unanimous: this is the brand promise, and it is broken in practice. UX-03 and SEC-08 go first. All three call `viewAs` and the long tail of lows a nice extra that can slip.

### 4.2 Core collector loop

#### P-06 · First ten minutes: quick setup and add-a-copy that keep what members enter and never put a copy on the market by accident

Fix-programme · effort M · score **4.18** · cut votes 0 · from CORE-1, COMMUNITY-1, EXPERIENCE-3, COMMUNITY-2 · **Now**

- **Problem.** Activation means 3 or more copies within 7 days, plus a solve, connection or household link (`onboarding/activationReport.ts`). The first session loses or misapplies what members enter.
  - Quick setup:
    - Continue silently drops picks, ticks and location (UX-16, top-10 #8).
    - Continue walks through steps that are already done (UX-84).
    - The people step requires a username and sends the member to `/profile` with no way back (UX-85).
    - The step counts disagree (UX-83).
  - Adding a copy:
    - The cover photo or colour is never stored, though the preview shows it (UX-18).
    - Single add pre-ticks "For Trade", so new copies land in Browse (UX-19).
    - After adding, members land on the catalogue with a toast that says "collection" (UX-92), and copy mode is titled "Create a Puzzle" (UX-95).
    - "Add Puzzle" leads to three outcomes (UX-24).
    - Contributing a missing puzzle puts nothing on the shelf (UX-29).
    - The chooser doesn't mark puzzles already owned (UX-93).
    - Condition labels change after saving (UX-96), and acquisition date and source can't be edited (UX-97).
    - On phones, submit sits mid-page (UX-100).
  - Sanne's and Ineke's journeys both stall here.
- **Proposal.** A stack of small PRs:
  1. Offers default to off, and "Availability set" leaves the readiness checklist. A post-add chip asks "Offer this for swap?".
  2. Remove the colour swatches. Persist the uploaded photo after acquire once P-01's claim rule lands, and hide the control until then.
  3. Navigate to `/my-puzzles/<copyId>` with "Added to My Puzzles", View and "Add another", and the header "Add your copy" / "Jouw exemplaar toevoegen".
  4. One add model using P-34's labels: "Add to my puzzles" and "Suggest a new puzzle". Contributing ends on the new puzzle with "Also add it to my shelf"; the domain already allows acquiring your own pending definition. Manual entry gets a duplicate check.
  5. The whole chooser card adds, with an "On your shelf" badge.
  6. One status line under the copy title ("On loan to Anna since 3 Mar · Recall", "Private").
  7. Quick setup: Continue commits pending work ("Add 3 and continue"), an inline username field, `nextOpenStep()` for both Skip and Continue, and one consistent step count.
  8. One condition label map including `new_sealed`, and the Edit dialog gains acquisition month and source.
- **Devices.** Desktop keeps the live preview, now showing only saved data. Below `lg` the preview becomes a compact summary row, paired fields go single-column and submit is sticky above the tab bar.
- **User value.** A new member's first ten minutes produce a correct shelf with the privacy they chose, every pick they made and the photos they took.
- **Dependencies.**
  - P-01 Phase A, for cover persistence.
  - P-34, for labels.
  - P-17, which owns the offer toggles.
  - P-41's A1 split, before editing `copies/$id.tsx`.
  - EN and NL keys plus the library docs.
- **Risks.**
  - Offers defaulting to off reduces Browse supply for a while; the post-add chip mitigates this.
  - Committing on Continue must be idempotent on a double tap.
- **Success metrics.**
  - The share of single-add copies created with offers on falls from 100% to an intentional rate.
  - Quick-setup picks are lost 0 times (e2e).
  - Activation rises against the September 2026 cohort.
  - Photos uploaded in the add flow are actually stored.
- **First step.** One small PR:
  - offers off by default, and `QUICK_FLOW_FORM` deleted;
  - "Availability set" dropped from the checklist;
  - landing on the copy with the new toast;
  - copy mode retitled;
  - a test that the default create payload carries no offers.
- **Scores.** member 5/4/5/5 · builder 4/4/5/4 · strategist 4/4/4/4.
- **Judges' take.** The member gives it the highest urgency in the portfolio ("highest return for activation"). All three agree it splits into small PRs. The builder adds: wait for the A1 split before touching the 1,476-line copy page.

#### P-07 · Discovery at real scale: working catalogue filters and search, and a Browse that sees every listing

Feature-improvement · effort L · score **2.42** · cut votes 0 · from PLATFORM-5, COMMUNITY-2, EXPERIENCE-4 · **Now** (UX-01 slice), **Next** (search and `isOpen` slice), **Later** (listings read model)

- **Problem.**
  - The catalogue Filters panel never loads for anyone, because `getAllBrands` throws on puzzles without a brand (UX-01, blocker). It also breaks brand autocomplete in 4 forms.
  - `/puzzles` filters only the pages already loaded, although `gateway.catalog.search` and a search index exist. It shows "No puzzles found" while still paging (UX-26).
  - Browse builds candidates with `.filter(open).take(500)`, with no index and no order (`browseOwnedPuzzles.ts:70-94`). Above 500 open copies it sees only the oldest and reports wrong totals (perf #1, SEC-29), so one member can freeze it.
  - The web asks for 50 rows and never pages (UX-27).
  - There is no circle, brand or exchange-type filter (roadmap #16).
  - Phones show one card per screen (UX-54).
- **Proposal.**
  1. Catalogue:
     - filter `undefined` out of `getAllBrands` and render each filter control with its own error branch;
     - `/puzzles` and `/catalog` query `catalog.search` with a debounced term, extended with brand, piece range, difficulty and category;
     - facets come from the existing skip-scan helpers;
     - the empty state appears only once results are exhausted.
  2. A `listings` read model, maintained by the library adapters on every availability, visibility, ownership, household or circle change.
     - Browse becomes cursor-paginated, newest first, and every row is re-checked with `canViewCopyWithContext` so the model can never widen visibility.
     - New filters: circle, brand and exchange type.
     - A backfill plus a nightly reconcile.
     - Copies on loan or reserved are excluded (P-02).
  - **Adopted split:** the UX-01 fix now; catalogue search plus perf #1's simpler `isOpen` field with a `by_open` index and newest-first paging in Next; the listings read model only when open listings approach the hundreds.
- **Devices.**
  - Desktop: a left filter rail, "Showing 48 of 1,203" and infinite scroll with a Load more fallback.
  - Tablet: a "Filters (3)" side sheet and 3 columns.
  - Phone: a sticky search field, a Filters bottom sheet with Apply and Reset, active-filter chips and 2-column compact cards (P-32).
- **User value.** Members can find every puzzle offered in their community and every puzzle in the catalogue, and the swap loop keeps working past family scale.
- **Dependencies.**
  - P-43 (`clampPageSize`, status indexes).
  - P-02 (excluding held copies).
  - P-33 (URL state).
  - P-32 (compact cards).
  - P-44 (scale fixture, for the read model only).
- **Risks.**
  - The read model must mirror every visibility rule (private copies, blocks, household permission, circle shares, mutual-follow access). The per-row re-check and property tests guard this.
  - Convex search caps results at 1,024.
- **Success metrics.**
  - The Filters panel loads for 100% of visitors.
  - Catalogue search finds any approved puzzle in one round trip.
  - Browse reaches both the newest and the oldest listing with exact totals.
  - At least 4 cards per phone screen, up from 1.
- **First step.** A PR with no schema change: the `getAllBrands` fix, independent filters, a debounced `catalog.search`, and a convex-test with a brandless puzzle.
- **Scores.** member 4/2/4/3 · builder 3/2/3/2 · strategist 3/2/3/2.
- **Judges' take.** All three say to split UX-01 out as a same-day hotfix and switch to the search index. The listings read model is "the riskiest visibility mirror in the portfolio" (member) and premature at 13 members (all three).

#### P-08 · My Puzzles for 300-puzzle collectors: search, sort, bulk actions and collections that work

Feature-improvement · effort L · score **2.68** · cut votes 0 · from CORE-4, PLATFORM-5 · **Next** (small-slice lane), **Later** (the rest)

- **Problem.**
  - My Puzzles has no search, sort or multi-select, and renders the whole library. ⌘K searches the catalogue, not your copies (UX-22, roadmap #17).
  - Offering 50 copies takes 50 separate menus.
  - A filter that matches nothing says "Add your first puzzle".
  - Recall is one tap and fails silently (UX-103), and availability badges look like tags (UX-173).
  - Collections:
    - the "Add puzzles" picker hides every unoffered copy (UX-21);
    - create gives no feedback, and there is no delete in the UI, although `library/deleteCollection.ts` exists (UX-101);
    - remove is a one-tap red icon (UX-102);
    - public collections are reachable only by direct URL (roadmap contradiction #5).
  - `getOwnedPuzzlesByOwner` collects the whole library and rebuilds the visibility context per copy (perf #5).
- **Proposal.**
  - Backend:
    - A paged `listMyLibrary` (scope mine, household or all) with server-side filters (offered, on loan, private, in progress, solved, not solved, collection, piece band, brand), four sorts and the visibility context built once.
    - A denormalised `searchText` with a search index, feeding an "In your library" group in ⌘K.
    - Bulk mutations (at most 100 ids, owner or household-manage gate, P-02's loan rule and P-17's visibility rule applied per copy, rate-limited, reporting skipped ids).
  - Web:
    - inline search, sort and filter chips held in the URL;
    - an honest empty-filter state;
    - Recall behind an AlertDialog with toasts.
  - Collections:
    - the picker includes unavailable copies;
    - create is disabled until named, then toasts;
    - Delete moves into the edit dialog;
    - Remove becomes an Undo toast;
    - public collections show on the member's profile after SEC-37 is fixed.
- **Devices.** Selection mode:
  - desktop: hover checkbox, shift-click ranges and a sticky action bar;
  - tablet: always-visible checkboxes;
  - phone: Select or long-press, then a bottom action sheet above the tab bar.
- **User value.** Collectors with hundreds of puzzles can find, filter and act on many copies at once, and collections become a real way to organise them.
- **Dependencies.**
  - P-17's visibility rule, so a bulk offer never publishes private copies.
  - P-02's loan guard.
  - P-05's SEC-37 fix.
  - P-33 (URL state).
  - P-14 import makes it matter.
- **Risks.**
  - It could become one 2,000-line PR, so ship a stack.
  - `searchText` needs a backfill.
  - Mixed household permissions mean every bulk action must report what it skipped.
- **Success metrics.**
  - Clicks to offer N copies fall from about 3N to about 4.
  - Collections per active member rise from near 0.
  - A 300-copy library query reads 50 or fewer documents per page.
- **First step.** Fix the empty-filter state and the silent Recall, then switch `getOwnedPuzzlesByOwner` to a single context build with a test.
- **Scores.** member 4/3/4/3 · builder 3/3/4/2 · strategist 3/3/3/2.
- **Judges' take.** All three want the cheap collection fixes and Recall confirmation now. The builder and strategist hold bulk selection until import (P-14) brings large libraries.

#### P-09 · A solve log members can trust: recorded times shown, edits that work, in-progress made easy

Fix-programme · effort M · score **3.87** · cut votes 0 · from CORE-3 · **Next**

- **Problem.** Logging a solve is the heartbeat of the loop, and it is broken in several ways.
  - Time and dates:
    - Tracked time never appears in the history; a 3h 20m solve reads "finished in 1 day" (UX-133).
    - The first solve can't record a time, and keeping a solve in progress means clearing a native date input (UX-134).
    - "Today" uses UTC (UX-135).
  - Edits: Edit is offered and then refused on every back-dated or year-precision solve, because the 24h window is anchored on an `endDate` stored as UTC midnight (UX-48).
  - The puzzle picker:
    - can't be used with the keyboard (UX-44, WCAG A);
    - shows one card per phone screen (UX-131);
    - ignores borrowed and household copies, although `solvableCopy.ts` allows them (UX-139).
  - Other problems:
    - a confusing Finish dialog (UX-132);
    - 32px icon actions and no paging in the history (UX-138);
    - mixed vocabulary (UX-58, UX-96);
    - a "required but labelled optional" rating (UX-30);
    - in-progress solves shown to any copy viewer (SEC-35);
    - an unpaged `listMyCompletions` (perf #13).
- **Proposal.**
  - Web:
    - `lib/date-input.ts` (local today, local-midnight parsing) used by all four solving dialogs.
    - The log dialog gets a "Finished / Still solving" toggle and an inline, optional "How long did it take?" in hours and minutes, replacing the post-save modal.
    - The history shows "pieces · 3h 20m" (or "over 3 days"), grouped by year with Show more, and photos open in the lightbox.
    - The picker gets real buttons, an "In progress" section first, and My puzzles, Borrowed and Household sections.
    - Empty states get a primary "Log a solve" and a link to mark past solves.
    - "Log a solve" / "Solve vastleggen" everywhere, and a visible "Your rating *" label.
  - Domain and backend:
    - Anchor the edit window on `createdAt` and exempt notes and precision upgrades.
    - Return `editableUntil`, so the pencil can be disabled with a tooltip.
    - Add `durationSource` (manual or timer).
    - Gate in-progress rows on the owner or `shareInProgress` (SEC-35).
    - Page `listMyCompletions`.
  - **Your decision:** drop the 24h window entirely for personal fields (dates, time, notes). This is recommended, since the log is the member's own diary.
- **Devices.** Below `sm`, history actions move into a 44px ⋯ menu with Finish kept visible, and the picker becomes list rows.
- **User value.** The times members enter are shown, edits succeed, and borrowers and housemates can log what they actually solved.
- **Dependencies.**
  - None hard.
  - P-10, P-11 and P-12 reuse `date-input` and `durationSource`.
  - P-35 provides the accessible StarRating.
- **Risks.**
  - The edit window may have been meant as anti-tamper, so confirm the intent.
  - Paging changes a widely used query.
- **Success metrics.**
  - More finished solves carry a time.
  - Edit-window rejections approach 0.
  - Solves on borrowed or household copies go above 0.
  - Keyboard and axe checks pass on `/completions/new`.
- **First step.** Add `lib/date-input.ts` with unit tests, switch the four dialogs to it, and rebuild the history meta line so the recorded time shows.
- **Scores.** member 5/4/5/4 · builder 4/4/4/3 · strategist 4/4/4/3.
- **Judges' take.** All three agree these are real correctness bugs. The member and strategist back dropping the 24h window ("it's the member's diary, not an anti-cheat ledger"). The builder wants the intent confirmed first.

#### P-10 · Goals that mean what they say: period-scoped progress, editable goals and a yearly challenge

Fix-programme · effort M · score **3.38** · cut votes 0 · from CORE-2, COMMUNITY-9 · **Next** (by mid-December)

- **Problem.**
  - Goal progress counts every dated solve ever logged (`recompute-goal-progress.ts:22-37`). A member with 30 earlier solves who sets "Solve 10 puzzles this year" jumps to 31/10, "Achieved", and gets a GoalAchieved notification (UX-42). The wrong number also feeds the dashboard ring.
  - Goals can't be edited, archived or deleted, and `isActive` is never set to false (UX-43, roadmap #18).
  - The form accepts 0, 2.5 and past dates (UX-140).
  - Insights shows "0 of 0 active" (UX-137).
  - The dialog doesn't fit short phones (UX-60).
  - Editing a completion's date doesn't trigger a recompute.
  - The market shows the value: Goodreads' yearly challenge and IPDb's monthly badge (market §2 #18).
- **Proposal.**
  - Domain:
    - a period {year, month, custom or lifetime}, `edit()`, `archive()` and an outcome;
    - a pure rule `countsTowardGoal`: day-precision solves count inside the period, year-precision solves count only toward a year goal for the same year, unknown precision never counts;
    - a new port method `countCompletedByUserBetween`;
    - recompute on goal creation and edits, and on completion record, delete and edit.
  - Backend:
    - new fields and a `completions.by_user_end` index replacing the unused one;
    - update, archive and delete mutations behind ownership;
    - a cursor-batched migration that recomputes every goal and fires GoalAchieved only on an upward crossing;
    - lazy roll-over of yearly goals.
  - Web:
    - templates ("This year", "This month", "Custom dates", "All time");
    - integer targets of at least 1;
    - a ⋯ menu with Edit, Archive and a confirmed Delete;
    - a collapsible "Past goals" list with neutral badges ("Ended at 37 of 50"), never red or shaming;
    - no new notification type.
- **Devices.** A full-height sheet with a sticky footer on phones (UX-60), 2 columns on tablet and 3 on desktop.
- **User value.** A yearly puzzle challenge members can trust, edit and retire, with achievements that are earned rather than accidental.
- **Dependencies.**
  - P-09's `date-input`.
  - Hand-maintained `_generated/api.d.ts` entries for the new functions (P-45 addresses codegen drift).
  - P-11 reads the outcomes.
- **Risks.**
  - The migration lowers wrongly "achieved" goals; explain this in What's new (EN and NL).
  - Year-precision handling is a product call.
  - New domain logic must clear the 95% mutation threshold.
- **Success metrics.**
  - 0 goals above their in-period count after the migration.
  - At most one GoalAchieved per goal.
  - The renewal rate of yearly goals in January 2027.
- **First step.** A domain-and-adapter PR: count from `goal.createdAt` to `targetDate`, recompute inside `createGoal`, and add a spec test for "30 earlier solves gives 31/10". This removes the wrong numbers before any period UI ships.
- **Scores.** member 4/4/4/4 · builder 3/4/4/3 · strategist 3/4/3/3.
- **Judges' take.** The member insists it lands before 1 January, when members set yearly goals. All three keep roll-over, templates and pace lines minimal.

#### P-11 · Insights that read well, a private "Year in Puzzles" recap, and later opt-in household and circle challenges

Feature-improvement · effort L · score **2.37** · cut votes 0 · from CORE-10, COMMUNITY-9 · **Next** (chart fixes in the small-slice lane), **Later** (records and recap); group challenges **parked**

- **Problem.** Insights got no work in October (roadmap §5).
  - The metric toggle is clipped on phones (UX-45).
  - Monthly bars have no values, axis or text alternative (UX-46, WCAG 1.1.1).
  - The difficulty donut has no legend (UX-47).
  - "Unknown" is English-only and ranks as a top brand (UX-136, 189).
  - New members see nine zeros (UX-137).
  - There are no records and no recap. The spec asks for shared achievements (roadmap #31), and share cards were deferred over privacy.
- **Proposal.**
  - Fixes:
    - wrapping section heads;
    - charts in a `figure` with a summary label and an `sr-only` table;
    - a 1px baseline for zero months;
    - a stacked bar with fixed per-difficulty colours and a legend;
    - translated `__unknown`/`__other` sentinels, with Unknown left out of the brand ranking;
    - an empty state offering "Log a solve" and "Set a goal".
  - A records strip: pieces placed, hours solved, biggest puzzle, fastest per piece band (timed solves only), most-solved brand.
  - A "Year in Puzzles" page from 1 December:
    - solves and pieces, month by month, top brands, the goal outcome, "kept in circulation" (lent, swapped or borrowed instead of bought), and a collage of the member's own approved photos;
    - shared only as a client-rendered PNG, with no public URL and nothing stored server-side;
    - off by default for private profiles;
    - below 3 solves, a soft "Your 2027 starts here" card.
  - Optional group challenges for households and circles: group totals only, no leaderboards and no streaks.
- **Devices.**
  - Recap: vertical sections with large numerals on phones, 2 columns on tablet, a 3-column grid on desktop.
  - Web Share on mobile, download on desktop.
  - Reduced motion respected.
- **User value.** Members can read their own puzzling at a glance and get a warm, private story of their year to share if they choose.
- **Dependencies.**
  - P-10 (correct goals), P-09 (times), P-42 (thumbnails for the collage).
  - Challenges need a new notification type.
- **Risks.**
  - To matter for 2026 the recap must ship by about 10 December.
  - Rendering differs between Safari and Chrome.
  - Collage photos may show home interiors; they are the member's own and rendered on their device only.
- **Success metrics.**
  - 0 serious axe nodes on `/insights`.
  - At least 40% of December-active members open their recap.
  - The January return rate of viewers against non-viewers.
- **First step.** Section-head wrap and chart accessibility (figure, label, `sr-only` table, zero baseline), with component tests.
- **Scores.** member 3/3/3/2 · builder 2/3/4/2 · strategist 3/3/4/2.
- **Judges' take.** All three want the chart fixes now. All three say the recap must not compete with trust fixes for December capacity, and the strategist calls the deadline "self-imposed". The builder would drop group challenges from scope altogether.

#### P-12 · Solving companion: an Up next queue, a live timer with sessions and "set aside", and a table mode for tablets

New feature · effort L · score **1.60** · cut votes **1** (strategist) · from CORE-8, CORE-9, EXPERIENCE-9 · **Parked** (see §5.1)

- **Problem.**
  - Members with a pile of unsolved puzzles can't see it or choose from it, and nothing pushes borrowed puzzles up the pile.
  - Durations are typed in after the fact. The in-progress design left timers, pausing and abandoning out of scope.
  - Giving up means deleting the solve with its notes and photos.
  - Puzzle Tracker, MySpeedPuzzling, IPDb and StoryGraph all ship pickers, timers or a "did not finish" shelf (market §2 #17, #19).
- **Proposal.**
  - A "To solve" status.
  - `listSolveCandidates` over own, borrowed and household copies.
  - An Up next list (at most 20, reorderable) and a "Pick for me" sheet with a stated reason ("Borrowed from Anna 5 weeks ago").
  - Timer sessions on the Completion aggregate: start, pause, resume, adjust and a "Set aside" state that keeps notes and photos, with a forgotten-timer guard.
  - A table mode at `/solving/$completionId`: box art full-bleed with pinch-zoom, a large clock and a Screen Wake Lock.
- **Devices.**
  - Table mode puts the image left and controls right on landscape tablets and desktop, with a bottom bar on portrait and phones.
  - A "solving pill" in the shell.
- **User value.** The unsolved shelf becomes a queue, borrowed puzzles get returned sooner, and multi-evening solves are timed naturally.
- **Dependencies.** P-09, P-08, P-32 and P-41.
- **Risks.**
  - Timer writes re-run subscriptions.
  - Wake Lock costs battery.
  - Random picks can feel arbitrary.
- **Success metrics.**
  - The share of timed solves.
  - Set-aside versus deleted solves.
  - Days from loan start to the borrower's finished solve.
- **First step.** A client-side "To solve" pill on My Puzzles.
- **Scores.** member 3/2/3/1 · builder 2/2/3/1 · strategist 2/2/2/1.
- **Judges' take.** The strategist voted to cut it: this is "MySpeedPuzzling's home turf". The builder would defer the timer and table mode indefinitely. The member sees "Set aside" as a real need. Salvage: fold a "To solve" filter into P-08 and consider "Set aside" alongside P-09.

#### P-13 · Scan to add and "do I already own this?": USB and camera scanning, household-aware duplicate warnings, an offline check at fairs

New feature · effort XL · score **1.85** · cut votes 0 · from CORE-5, PLATFORM-10 · **Next** (Phase 1 in the small-slice lane); Phases 2-3 **parked** (see §5.1)

- **Problem.**
  - Every comparable tracker adds by barcode (market §1, §2 #1). JigSwap stores EAN and UPC with indexes but only recognises typed digits and has no camera (UX-171).
  - Buying duplicates is a top collector pain (market pain #2), and the warning matters more across a household. Today "On your shelf" shows only in the quick picker and only for your own copies (UX-93, UX-108).
  - Fairs and charity shops have poor signal, and the service worker is push-only.
- **Proposal.**
  - Phase 1 (S): in the add picker, a 12- or 13-digit burst followed by Enter adds the barcode match and refocuses, so USB keyboard-wedge scanners work.
  - Phase 2 (M-L):
    - A `/my-puzzles/add/scan` route with native `BarcodeDetector` and a lazily fetched ZXing-WASM fallback for iOS Safari and Firefox.
    - A bulk-scan tray with per-read chips: Found, On your shelf, In your household, On your wishlist, Not in the catalogue yet.
    - A "Register N new puzzles" stepper.
    - A bounded `myOwnershipByDefinition` query feeding soft duplicate warnings everywhere.
  - Phase 3 (M): an opt-in offline snapshot in IndexedDB, a `/fair` shell precached by the service worker, offline search, and queued "add when back online".
- **Devices.**
  - Desktop: a USB field with the tray on the right.
  - Tablet: viewfinder and tray side by side.
  - Phone: a full-screen viewfinder with a bottom tray sheet.
- **User value.** Adding a shelf of 30 boxes takes minutes, and at a fair a collector can check in a second whether their household already owns a puzzle.
- **Dependencies.**
  - P-23 Phase A, before Phase 1.
  - P-23 coverage, for hit rates.
  - P-04 (submission limits), P-06 (offers off), P-41 (keep ZXing out of the entry bundle), P-44.
- **Risks.**
  - With 9 approved puzzles most scans miss.
  - ZXing is 0.5-1 MB.
  - Service-worker bugs can break navigation.
  - iOS may evict IndexedDB.
- **Success metrics.**
  - The share of copies added by scan.
  - Seconds per copy in a scan session.
  - Barcode hit rate.
  - Fewer same-household duplicates.
- **First step.** Keyboard-wedge support in the add picker, with a component test, after P-23's lookup fix.
- **Scores.** member 4/2/4/2 · builder 3/2/3/1 · strategist 3/2/3/2.
- **Judges' take.** All three like Phase 1 and the household-aware warning. All three say camera scanning waits for catalogue coverage. The builder and strategist would drop Phase 3's offline service worker as the riskiest piece a solo developer could take on.

#### P-14 · Bring your collection, take it with you: CSV export, a complete GDPR export, and spreadsheet import

New feature · effort L · score **3.35** · cut votes 0 · from CORE-6, TRUST-8 · **Next** (export, below the cut line), **Later** (import, after seeding)

- **Problem.**
  - The wider community keeps its lists in spreadsheets, Puzzle Tracker, IPDb (CSV), My Puzzle Cabinet (CSV) and MySpeedPuzzling (Excel) (market §1). JigSwap has no import; the quick picker takes 25 at a time (UX-22), and Ineke's first finding is "There is no import".
  - Export is JSON only, buried at the bottom of Insights (UX-190) and capped at 5,000 rows per context.
  - It leaves out messages, photos, profile, follows, blocks, memberships, comments, favourites, loans and preferences (SEC-66, roadmap #5), while the privacy policy promises a download of "your data" (roadmap contradiction #7).
- **Proposal.**
  1. Collector CSV export:
     - a library file with one row per copy and every collector field, plus a solves file;
     - UTF-8 with BOM, an optional semicolon separator for Dutch Excel, and formula-injection escaping;
     - the columns double as the import template.
  2. A complete GDPR export as a background job:
     - a ZIP with JSON per context, the CSVs and the member's own photos;
     - announced in-app and by email, valid for 7 days, at most one a day;
     - a schema-walk test asserts every member-linked table is exported or excluded with a reason.
  3. An import wizard at `/my-puzzles/import`:
     - upload or paste, with EN/NL header auto-detection and known formats (MySpeedPuzzling, Puzzle Tracker, IPDb, JigSwap);
     - matching by EAN first, then title scored by brand and pieces, with each row marked Matched, Choose, New, Already on your shelf or Skip;
     - review, then an idempotent, resumable commit of 25 rows per call with "Undo this import" for 24 hours;
     - new rows become the member's own pending definitions in one batch.
- **Devices.** Import review is a table with per-state tabs on desktop, fewer columns on tablet, and cards grouped by state with a sticky "Import 214" bar on phones.
- **User value.** Moving to JigSwap costs an evening of review instead of weeks of retyping, and members can always leave with all their data.
- **Dependencies.**
  - P-23 (barcode integrity, batch review, seeding).
  - P-04 (a generous acquire bucket).
  - P-06 (imported copies not offered).
  - P-01 (GC for export ZIPs).
  - P-36 (the "Your data" entry).
  - P-31 owns erasure.
- **Risks.**
  - With 9 approved puzzles nearly every row starts as "New", so you need an auto-approval policy (§6).
  - Fuzzy matches need confirmation.
  - ZIP builds approach the action memory limit.
- **Success metrics.**
  - Imports completed versus started.
  - Rows matched automatically.
  - The schema-walk test at 100%.
  - Export works for a 1,000-copy library.
- **First step.** A client-side library CSV export from already-loaded data, with escaping and EN/NL headers, in Insights and ⌘K.
- **Scores.** member 4/3/5/3 · builder 4/3/5/3 · strategist 4/3/5/3.
- **Judges' take.** Identical scores. All three say export first because it keeps a promise the policy already makes, and import only after catalogue seeding, or it floods a one-person admin queue.

### 4.3 Sharing and exchange

#### P-15 · An exchange lifecycle you can read: step tracker, visible two-sided confirmation, guarded final actions, errors that show

Fix-programme · effort M · score **3.73** · cut votes 0 · from SHARE-2, TRUST-2, EXPERIENCE-4 · **Next** (core), **Later** (detail route, retract confirmation, notification kind)

- **Problem.** The core swap and lend loop gives no state and no error feedback (UX top-10 #10).
  - Completion needs both parties to press Mark Complete, but nothing shows who has confirmed. The read views already send both timestamps (`readViews.ts:86-87`), and the web never uses them.
  - The final click moves the copy irreversibly with no confirmation, and the first confirmation emits no event (UX-35).
  - The owner never sees the buyer's offered price (UX-36).
  - Every error is swallowed by `console.error` (`trades.tsx:388-401`), with no pending states, and Decline, Cancel and Return run unconfirmed (UX-37).
  - Phone rows leave about 130px for title and partner, about 75px in Dutch (UX-40).
  - There is one generic empty state and nothing flags rows waiting on you (UX-127).
  - Toggles are unnamed (UX-130, 188), and Enter always sends on phones (UX-113).
  - In Sanne's journey, neither sister knows whose turn it is.
- **Proposal.**
  1. Keep the existing `?exchange=<id>` deep link and desktop inline expansion. Add a full-screen detail view for phones and tablets using the unused `gateway.exchange.byId`.
  2. An `ExchangeStepper`: Requested → Agreed → Handed over → Done, with loans as Agreed → On loan → Returned.
     - Each step shows who acted and when.
     - The current step says "Your turn" or "Waiting for {name}".
     - "You confirmed {time}" offers Undo until the partner confirms (a new `retractConfirmation`).
  3. The settling confirm sits behind an AlertDialog worded per kind ("Café moves to Anna's library. This can't be undone.").
  4. The domain emits `CompletionConfirmed(by)`, which drives an in-app and push nudge (at most one push per exchange per hour) and a thread event line.
  5. Errors:
     - an `exchange-error.ts` mapping, including P-02's CopyReserved and Withdraw;
     - per-kind toasts and pending labels ("Accepting…");
     - AlertDialogs with a one-line consequence for Decline, Cancel, Withdraw and Return.
  6. A terms card with cover thumbnails, an "Offer: €15,00" chip and the loan due date.
  7. Tabs All / Needs you / Incoming / Outgoing / Loans, with "Needs you" sorted to the top and counted in the nav, per-tab empty states, state in the URL, and paged reads.
  - **Next delivers** items 2 (without Undo), 3, 5, 6 and 7, plus the phone rows. The full-screen route, `retractConfirmation` and the new notification kind follow later, as the builder advised.
- **Devices.**
  - Desktop: inline expansion, a horizontal stepper, and chat beside the detail at `xl`.
  - Tablet: container queries, a compact stepper ("Step 3 of 4 · Handed over"), and the detail as a route.
  - Phone: two-line rows (title clamped to two lines, pill in the meta line, the whole row a button), a sticky 44px bottom action bar, and Enter inserting a newline on touch.
- **User value.** Both sides always know the step, whose turn it is and what the final click does, and mistakes show up as messages instead of disappearing.
- **Dependencies.**
  - Ships with P-02's remaining items.
  - P-16 fills the Loans tab, and P-19 the hand-off slot.
  - P-34 owns the vocabulary, P-32 the ConfirmAction and container primitives, and P-40 the global error fallback.
  - The new notification kind touches the enum sync points.
- **Risks.**
  - Undo adds domain transitions that need spec and mutation coverage.
  - Push on every confirmation can feel noisy.
  - Container-query work overlaps P-32.
- **Success metrics.**
  - Median time from accepted to completed.
  - The share completed within 14 days.
  - 0 `console.error`-only failure paths.
  - Click-through on "Needs you".
- **First step.** A web-only PR in `trades.tsx`: `exchange-error.ts` with `toast.error` and pending states, "You confirmed {time} · waiting for {name}" from the existing timestamps, the AlertDialog on the settling confirm, and the offer chip.
- **Scores.** member 5/3/5/4 · builder 4/3/5/3 · strategist 4/3/4/3.
- **Judges' take.** All three agree the cheap parts (toasts, timestamps, AlertDialogs) can ship within days. All three would let Undo and the full detail route follow later.

#### P-16 · Loans that behave like loans: one Loans home, return-by dates, reminders, extensions, ask-back and owner-initiated lending

Feature-improvement · effort L · score **3.25** · cut votes 0 · from SHARE-4, COMMUNITY-10, EXPERIENCE-3 · **Next** (first slice, below the cut line), **Later** (the rest)

- **Problem.** Lending is the family use case, and the marketing site promises "Lend & track", but loans are half-built.
  - The backend accepts `loanReturnDate` (`exchange/propose.ts:42`), but the dialog never sends it, and the docs say "Borrow: no extra details" (roadmap #8, UX-36).
  - An owner can't start a loan; the borrower has to press "Request swap" (UX-38).
  - Loans are scattered across an orphaned `/borrowed` page, a tab and card annotations, and a puzzle still at the borrower's house shows "Completed" (UX-39).
  - Borrowers can't log a solve from the copy page.
  - Recall closes the loan instantly in the data while the puzzle is still physically away, and the borrower isn't even told.
  - There are no reminders. `gateway.library.lentOut` exists with no UI.
  - Libraries make 3-week loans with reminders work better than deposits (market §2 #14, #22).
- **Proposal.**
  - Loan states open → (asked back) → return pending → returned:
    - the borrower taps "I've returned it";
    - the lender taps "Got it back";
    - the loan closes automatically 7 days after the borrower reports the return, with a 14-day reopen window.
  - "Ask for it back" replaces instant Recall.
  - Return-by presets (2 weeks, 3 weeks, 1 month, custom, no fixed date), prefilled from the owner's default loan length (P-17).
  - Extensions approved with one tap.
  - A daily reminder sweep: due soon at 3 days, then overdue at most 3 times, under a new "Loans" preference category with Dutch push, and nothing for open-ended loans.
  - Loan notifications in the subscriber.
  - Owner-initiated "Lend to…" for household members, mutual followers and circle co-members with exchange permission, implemented as an `owner_offer` that the borrower accepts.
  - UI:
    - an Exchanges › Loans tab with "Borrowed by you" and "Lent out" sections and due chips ("Due in 5 days", amber "Overdue 3 days");
    - `/borrowed` redirects there;
    - a "Lent out" filter on My Puzzles;
    - banners on the copy page;
    - "On loan" or "Returned {date}" instead of "Completed".
  - **Next delivers** the first step plus the Loans tab and redirect. The state machine, reminders and owner-initiated offers wait for real loan use.
- **Devices.** Loan sections side by side at `xl` on desktop, stacked on tablet, and a segmented control with 44px actions on phones. Reminder pushes deep-link to the exchange.
- **User value.** Lenders get puzzles back without awkward chasing, borrowers know when a puzzle is due, and owners lend to family in two taps.
- **Dependencies.**
  - P-02 (loans as reservations), P-15, P-34, P-17, P-38 (Dutch push).
  - The enum sync points.
  - P-20 adds return check-ins.
- **Risks.**
  - Reminders between family members can feel naggy.
  - Existing open loans migrate with no due date.
  - Auto-close can be wrong, hence the reopen window.
  - The Loan aggregate needs full spec coverage.
- **Success metrics.**
  - More than 60% of new loans carry a return date.
  - Loans more than 14 days overdue.
  - The share of loans started by owners.
  - An e2e test lists all active loans in one view.
- **First step.** Return-by presets in the borrow path, due dates shown in the Borrowed tab and on lent-out cards, and "On loan" instead of "Completed".
- **Scores.** member 5/2/5/3 · builder 4/2/5/2 · strategist 4/3/5/3.
- **Judges' take.** The member gives it top value: "lending within families is the heart of this product". The builder and strategist want it staged, with the return-pending state machine, auto-close and extension approvals waiting for evidence of use.

#### P-17 · One place to decide who sees and can request a copy: a Sharing card, offers that respect privacy, bulk circle sharing, explained permissions

Fix-programme · effort M · score **3.68** · cut votes 0 · from SHARE-5, CORE-1, COMMUNITY-6, TRUST-5 · **Next**

- **Problem.** Sharing decisions are scattered, and some lose data silently.
  - One-tap offer toggles make a private copy visible and never switch it back (UX-20, Ineke journey).
  - Circle sharing is one silent Select per copy with no search or feedback. Members only see a shared copy while it is offered (`canViewCopy.ts:128-131`), so sharing an unoffered copy looks successful but shows nothing (UX-41).
  - Nothing can be unshared, and the copy page has no circles (roadmap #4).
  - Members never see their own circle permission (UX-125), and who-sees-what isn't explained where the decision is made (UX-126).
  - "Sharing" and "View only" mean different things in households and circles (UX-129).
  - The household tab buries its list on phones (UX-185), and circle rows don't look clickable (UX-186).
  - There is no asking price, although `salePrice` exists (roadmap #9), and no defaults for new copies (roadmap #19).
  - Marco shares the household's puzzles one at a time.
- **Proposal.**
  1. A Sharing card on the copy page:
     - Visibility (Private or Visible), stored as a `visibilityPreference` separate from the effective value. Offering a private copy asks once ("Make visible while offered? It goes back to private when you withdraw.") and withdrawing restores it, with Undo toasts.
     - "Offer for" Swap, Lend and Sell switches, disabled while on loan, with an asking price for Sell and a default loan length for Lend.
     - Circle chips with × to unshare (a new `unshareCopyFromCircle`) and "Share with circles…".
     - Household permission relabelled "Can lend & edit" / "Can see only".
     - A bounded audience summary: "Seen by: your household (3) · circle Buurt (8)".
  2. A searchable multi-select circle share picker that marks shared copies, flags unoffered ones with "Also offer for lending", and toasts the result.
  3. Opt-in sharing defaults for new copies.
  4. Explained permissions: a badge with a tooltip, a view-only footer, the household tab renamed "Permissions" / "Rechten", the guide linked from `/household` and `/circles`, and a chevron on circle rows.
  - **Next delivers** items 1 (without asking price and defaults), 2 and 4.
- **Devices.**
  - Desktop: the card in the right column.
  - Tablet: below the hero.
  - Phone: a summary row ("Visible · Lend · 2 circles") opening a bottom sheet with 44px rows, a full-height picker with sticky search, and the household bulk row only once something is selected.
- **User value.** Owners decide in one place who sees and can ask for each puzzle, without accidentally exposing a private copy, and can put a whole shelf into a circle at once.
- **Dependencies.**
  - P-41's A1 split.
  - P-02's loan guard.
  - Document the real visibility model first; the spec contradicts itself (5 versus 6 levels, roadmap §4).
  - It feeds P-16, P-18, P-21 and P-08.
- **Risks.**
  - The split touches the `visibilityAuthoritative` rollout marker.
  - Private choices already lost can't be recovered.
  - The audience query must be capped.
- **Success metrics.**
  - 0 private-to-visible flips without a confirm.
  - More than 90% of circle-shared copies offered.
  - 20 copies shared with a circle in under a minute.
- **First step.** Rebuild `circle-share-section.tsx` as a searchable multi-select with feedback, and add `unshareCopyFromCircle`.
- **Scores.** member 4/3/5/4 · builder 4/3/5/3 · strategist 4/3/5/3.
- **Judges' take.** All three call UX-20 "a privacy bug in a privacy-first product" and want the preference split and unshare. Audience summaries, defaults and the asking price are secondary.

#### P-18 · One wishlist, with availability alerts from your circles and household

New feature · effort L · score **2.67** · cut votes 0 · from CORE-7, SHARE-6 · **Next** (heart and list, small-slice lane), **Later** (wishlist model and alerts)

- **Problem.** Two half-built concepts compete.
  - Catalogue favourites work on `/puzzles`, but the Browse heart says "Favorites are coming soon" (UX-25, roadmap contradiction #2). `catalog.listMyFavorites` has no UI, and `puzzle_favorited` has no emitter.
  - The wishlist exists only as a domain collection variant with no use case or UI (roadmap #7), yet the deletion docs promise to delete wishlists (contradiction #4).
  - `getRecommendations` is built and unused (roadmap #6), and saved-search alerts are missing (#15).
  - The market scan names wishlist-match alerts inside circles and households as one of JigSwap's strongest openings (Discogs Wantlist, Hoefnagel's queue; market §2 #15). Finished puzzles pile up because owners don't know someone wants them (pain #3).
- **Proposal.**
  - One concept, "Wishlist" / "Verlanglijst", built on the existing `favorites` table and its `by_puzzle` index, with intents (Borrow, Swap, Buy), a maximum price, note, priority and alerts. Favourites migrate; the collection variant is deprecated and the docs corrected.
  - A "Want" toggle on catalogue cards, the detail page, Browse and P-13's scan tray. On public pages it becomes a sign-up prompt.
  - A `/wishlist` page showing availability ("In your household (Marco)", "Offered by 2 members you can see", "Nobody offers it yet").
  - "You might also like" from `getRecommendations`.
  - Items are fulfilled automatically when a copy is acquired.
  - Wishlist visibility: private by default, or household and circles, or public.
  - Alerts (`wishlist_available`) when a copy is offered, shared into a circle, added by a housemate or returned:
    - only for wishers who may see it;
    - at most 1 per definition per 7 days;
    - in-app, plus a daily email digest with List-Unsubscribe.
  - Owners see "N members want this", counted only among members who can see the copy.
- **Devices.** List rows with an availability chip on phones; a grid with filter chips on tablet and desktop.
- **User value.** Members hear when a puzzle they want becomes available among people they trust, families can see each other's lists, and puzzles keep circulating.
- **Dependencies.**
  - P-02, P-17, P-07 (cheap counts), P-04 (throttles), P-31 (List-Unsubscribe).
  - The enum sync points.
- **Risks.**
  - Every count and alert must respect visibility.
  - Renaming favourites changes their meaning.
  - Notification fatigue.
  - Fan-out on popular puzzles.
- **Success metrics.**
  - Members with at least one wishlist item.
  - At least 15% match-to-request conversion.
  - Opt-out rate under 5%.
- **First step.** Wire the Browse heart to `toggleFavorite`, and add a `/wishlist` page listing `catalog.listMyFavorites`.
- **Scores.** member 4/3/5/2 · builder 3/2/4/2 · strategist 3/3/4/2.
- **Judges' take.** All three call it strategically right, but with 13 members there is almost nothing to match against. Unify the list and fix the dead heart now; add alerts once there is supply.

#### P-19 · Exchanges between strangers: trust summary, honest reputation, lending tiers, hand-off planning, scam nudges

Feature-improvement · effort L · score **1.82** · cut votes 0 · from SHARE-3, SHARE-9, TRUST-2 · **Next** (honest new-member line and scam banner, small-slice lane); the rest **parked** (see §5.1)

- **Problem.**
  - New members show "0.0 ☆☆☆☆☆", and the copy says reviews count toward a trust level they don't affect (UX-121).
  - Lenders are asked to score timeliness at hand-over, before the puzzle has come back, and "packaging" assumes it was posted.
  - Hand-off was dropped on purpose (`propose.ts` discards shipping method and date), location is free text (roadmap #14), and `/people` promises "near you" (UX-181).
  - Market: Peerby's insurance-style guarantee didn't build trust; social trust plus a track record fits cheap puzzles better (§2 #14). Swap groups hand off in car parks, hygiene flags matter (§2 #10), and scams ask for off-platform payment (pain #7).
- **Proposal.**
  - A one-line TrustSummary ("★4.8 · 12 exchanges · 5 loans returned on time · member since Oct 2026 · in your circle Buurt"), or "New to JigSwap, no exchanges yet", built only on P-05's projected DTOs.
  - Review timing per kind.
  - Per-copy "Who can borrow" tiers, with an optional pledged-copy collateral and no money.
  - Exchange preferences in the profile: methods, area label, post scope, postage rule, smoke-free and pet-free flags.
  - A pinned hand-off card (meet-up slots with `.ics`, or posted with tracking).
  - A sale-thread scam banner and a client-side warning chip on payment-link patterns.
- **Devices.** The summary is one expandable line on phones and two lines elsewhere.
- **User value.** Members can trade with strangers knowing whether a partner is reliable, and decide who may borrow their puzzles.
- **Dependencies.** P-05, P-02, P-16, P-15, P-04 (MapTiler cap), P-07.
- **Risks.**
  - Tiers could lock out new members.
  - Location privacy.
  - The safety of meeting strangers.
  - Scope creep into payments.
- **Success metrics.**
  - Acceptance rate.
  - Exchanges with a hand-off plan.
  - Reports per 100 exchanges don't rise.
- **First step.** "Exchange preferences" on profiles and the "New to JigSwap" empty state.
- **Scores.** member 3/2/4/2 · builder 2/2/3/1 · strategist 2/2/3/1.
- **Judges' take.** All three: keep the honest new-member line and the scam banner, and defer trust tiers, pledges, slot scheduling and postcode fields "until real exchange volume shows the need" (strategist). "Built for stranger-to-stranger trade that doesn't exist yet."

#### P-20 · Completeness you can trust and a dispute path that works

New feature · effort L · score **2.47** · cut votes 0 · from SHARE-7, TRUST-2, TRUST-10 · **Next** (Phase B, small-slice lane), **Later** (Phase A); Phase C **parked**

- **Problem.**
  - Missing pieces are the main source of distrust in swapping (market pain #1: Obdam, libraries, eBay disputes, manufacturers who won't replace pieces).
  - JigSwap records condition, `missingPiecesCount` and each solve's `allPiecesPresent`, but nothing ties them to a hand-over. `CopyConditionChanged` is never projected (roadmap #13, #35).
  - `raiseDispute.ts`, `gateway.exchange.dispute` and the notification exist, but there is no web caller and no admin queue (roadmap #1, contradiction #9).
  - "Disputed" is a terminal state, so a dispute can never be resolved.
- **Proposal.**
  - Phase A, a working dispute path:
    - "Report a problem with this trade" (not received, not as described, missing pieces, no-show, other), up to 3 photos through P-01's upload path, while accepted or within 14 days;
    - one-tap resolutions: accept as is, undo the exchange, "I'll look for the piece", update condition;
    - `disputed → resolved_by_parties / resolved_by_admin`;
    - escalation after 14 days to an admin Disputes tab with a timeline;
    - a statement of reasons to both parties;
    - outcomes feed reputation as counts.
  - Phase B, read-only: `lastKnownCompleteness` derived from the latest finished solve ("Last solved complete on 3 Oct") on the copy page and in the request dialog.
  - Phase C, check-ins:
    - a ConditionReport with separate box and pieces grades;
    - completeness with its source;
    - missing-piece pins on the box image;
    - optional reports at hand-over and loan return;
    - a condition history card.
- **Devices.** Phase C uses a dialog with click-to-pin on desktop, a sheet with touch pins on tablet, and a full-screen 3-step flow on phones.
- **User value.** You know a puzzle is complete before you take it, and when pieces go missing both sides have a fair way to sort it out.
- **Dependencies.** P-01, P-02, P-15, P-16, P-29, P-30, and admin capacity.
- **Risks.**
  - Friction at hand-over.
  - A single admin can't absorb many disputes.
  - Reverting ownership is sensitive.
- **Success metrics.**
  - More than 80% of issues resolved without an admin.
  - The share of offered copies with known completeness.
- **First step.** Phase B's derived completeness line, then the member-side dispute dialog wired to the existing gateway op.
- **Scores.** member 4/2/5/2 · builder 3/2/4/2 · strategist 3/2/3/2.
- **Judges' take.** All three pull Phase B forward ("nearly free and very persuasive"). Phase A is needed eventually. All three defer Phase C's pins and two-sided check-ins until real disputes appear.

#### P-21 · Circles as puzzle libraries: availability status, a holds queue, library mode and a desk view

New feature · effort L · score **1.48** · cut votes **3** (all judges) · from SHARE-8, COMMUNITY-10 · **Parked** (see §5.1)

- **Problem.**
  - A circle is just a list of shared copies (`circle-page.tsx:292-340`), with no status, queue or rules.
  - Members can request a copy that is on loan, and several proposals pile up on one copy in no order.
  - Libraries, care homes and clubs lend puzzles with 3-week loans, holds and honour systems (market §1, §2 #20, #22).
- **Proposal.**
  - A status grid (Available / On loan · back ~12 Nov / Reserved / 3 waiting).
  - A `copyHolds` queue with a 48-hour claim window.
  - Opt-in library mode: default loan period, loan caps, honour mode, auto-approval and house rules.
  - Pass-it-on hand-offs.
  - A tablet-first desk view at `/circles/$id/desk`.
  - Printable A6 QR labels.
  - No money, deposits or fines.
- **Devices.** Four columns with a filter rail on desktop, 3 on tablet and 2 compact columns on phones. The desk view is tablet-first.
- **User value.** A circle becomes a real puzzle library, and a club volunteer can run a shelf from one tablet.
- **Dependencies.** P-02, P-16, P-17, P-20, P-18, P-26 and P-28.
- **Risks.**
  - Over-engineering for a family circle of three.
  - Hold squatting.
  - Institutions need a data processing agreement.
- **Success metrics.** 1-2 pilot clubs by Q2 2027, and a hold-claim rate of at least 70%.
- **First step.** On-loan and reserved status in the circle shared-copies view.
- **Scores.** member 2/2/3/1 · builder 2/1/3/1 · strategist 2/2/3/1.
- **Judges' take.** Unanimous cut. It serves institutions nobody has recruited and builds on lending that isn't working yet. The useful status chip already lives in P-02 and P-17. Revisit only if a named club or care home commits to a pilot.

### 4.4 Community and growth

#### P-22 · Acquisition loop: invite links that convert, and first-party attribution

Fix-programme · effort L · score **3.32** · cut votes 0 · from COMMUNITY-1, COMMUNITY-4 · **Now** (first step), **Next** (rest of PR1 and PR2-3, below the cut line), **Later** (PR4 and a minimal PR5)

- **Problem.** Production has 13 members (UX-164), and invites are the one channel that works for a family and circle product. The plumbing exists: invite links with counters, Web Share, WhatsApp, QR, and email and household invites. The loop leaks at every step:
  - (a) The invite profile emits only a title, and `/` has no description or og tags (live curl, 2026-10-29), so WhatsApp previews are bare.
  - (b) The signed-out calls to action render as plain text (UX-13, top-10 #5).
  - (c) Sign-up is a bare Clerk card with no logo, no way back and no language switch (UX-73).
  - (d) The QR dialog copies a different URL from the one it shows (UX-184), and "Show my QR" appears three times (UX-123).
  - (e) Network tokens never expire and force a mutual follow past a private owner's approval (SEC-42). Household invites never expire (SEC-31), a spent email budget still says "sent" (SEC-33), and anyone can inflate the landing counter (SEC-82).
  - (f) No screen reads the counters, there is no `ref`/utm handling, and the activation report is CLI-only.
- **Proposal.**
  - PR1:
    - `SignUpLink` forwards props and ref;
    - an invite-aware hero ("Sanne invited you to JigSwap", three bullets, "Your shelf stays private until you choose", 44px buttons);
    - og and twitter tags with a static EN or NL image;
    - `noindex` on any `?invite` URL;
    - the name comes from the teaser projection and never reveals the account name.
  - PR2: an AuthShell around sign-up, with wordmark, `<main>`, language switch and a "Joining via Sanne's invite" chip.
  - PR3:
    - network tokens expire after 180 days, and redeeming one for a private owner creates a connection offer instead of a forced follow;
    - household links expire after 14 days;
    - email invites need a 24-hour-old account or a verified email, and show "capacity reached";
    - de-duplicated landing counts;
    - one QR button that copies what it shows.
  - PR4: a private "Your invite link" panel (Opened, Joined, Connected, Rotate), with no badges or rewards; the 2026-07-11 spec rejected referral rewards.
  - PR5: an admin campaigns table and `?ref=` kept in `sessionStorage` and written once as the member's source. No IP, user agent or referrer is stored. An `/admin/growth` cohort page shows counts under 3 as "<3".
  - **Adopted:** PR5 reduced to the source column, as the builder and strategist advise.
- **Devices.** Hero left and preview right on desktop, stacked on tablet, and a sticky call to action on phones.
- **User value.** A member sends JigSwap to her sister, and the link looks trustworthy in WhatsApp. The sister lands on a working, translated page, signs up and arrives connected.
- **Dependencies.**
  - P-05 (handle rule, projections), P-24 (`seoHead`), P-31 (consent), P-38 (Clerk Dutch strings).
  - P-23, P-25, P-27 and P-28 add `ref` codes.
- **Risks.**
  - WhatsApp caches previews for days.
  - Expiring tokens break printed QR codes, hence a clear expiry message.
  - Small counts can re-identify people.
- **Success metrics.**
  - Landing to sign-up at least 25%.
  - Invitee 7-day activation at least 50%.
  - Share debuggers show title, description and image.
- **First step.** `SignUpLink` with a render test, og and twitter tags on the invite profile, and `noindex` on `?invite`.
- **Scores.** member 4/3/4/4 · builder 4/3/4/3 · strategist 4/3/4/4.
- **Judges' take.** All three say PR1-3 are cheap must-dos. All three say a cohort dashboard is noise at 13 members ("every cell would read '<3'").

#### P-23 · Catalogue coverage for the Dutch niche: integrity first, bulk import of Jan van Haasteren and Wasgij, a demand loop, brand and series hubs

New feature · effort L · score **3.95** · cut votes 0 · from COMMUNITY-2, COMMUNITY-4, CORE-5 · **Now** (Phase A), **Next** (Phase B, by 20 Feb 2027), **Later** (Phases C-D)

- **Problem.**
  - Production has 9 approved catalogue entries (perf B.0). Every activation step depends on the catalogue: quick-setup picks, past solves, adding a copy, Browse and the public SEO pages.
  - MySpeedPuzzling lists 44,447 puzzles (26,697 with an EAN) and IPDb about 30k; neither has a Dutch UI. A single-brand JvH tracker launched in May 2025, Jumbo has 200+ JvH illustrations, and Obdam swaps JvH and Wasgij like-for-like (market §1).
  - Integrity holes must close before inviting more contributions:
    - SEC-05: a submitter can rewrite an approved definition and hijack another puzzle's barcode;
    - SEC-52: pending and rejected rows hold their barcode forever, and lookup can return null;
    - SEC-26: every submission notifies every admin;
    - SEC-34: unapproved definitions leak.
  - Zero-result searches are never recorded, and there is no slug or curated brand entity.
- **Proposal.**
  - Phase A, integrity:
    - approved definitions change only through proposals;
    - an `[ean, status]` index that ignores rejected rows, releases barcodes on reject and prefers the approved row;
    - one batched admin notification and a per-member daily cap.
  - Phase B, an admin bulk import at `/admin/puzzles/import`:
    - paste up to 50 URLs or EANs per batch, each run through the existing URL importer in a workpool with its own budget;
    - drafts with duplicate detection;
    - a dense review table with inline edit and bulk Approve;
    - box art through `moderateBoxArt`.
    - Seed list: JvH (regular, Comic Classics, Junior, Mini), Wasgij (Original, Mystery, Destiny, Christmas, Retro) and top Ravensburger and Jumbo NL titles. Target: about 600 definitions before 20 February 2027.
  - Phase C, a demand loop:
    - "Can't find it? Ask us to add it" creates a capped `catalogRequests` row;
    - zero-result searches are logged (normalised, at most 60 characters, 90-day retention), and terms reach admins only once 3 or more members searched for them;
    - requesters are notified when the puzzle is approved.
  - Phase D, public hubs: `/catalog/brand/$brandSlug` and series pages backed by a curated `catalogBrands` table, with "N copies available to swap" (no identities), structured data, sitemap entries and a private "You have 23 of 41 Comic Classics" checklist.
- **Devices.** The review screen is a dense table on desktop, a card list on tablet and read-only on phones. Hubs use 2, 3 or 4-5 columns by device.
- **User value.** A Dutch JvH or Wasgij collector finds every box they own in seconds, and a visitor searching for a title lands on a JigSwap page showing whether anyone has it to swap.
- **Dependencies.** P-04 (limits), P-43 (status index), P-24 (hubs, which can ship EN-first), the Firecrawl budget. P-13 and P-14 depend on Phase A.
- **Risks.**
  - Copyright and database rights on scraped box art. Facts are low-risk; for images, seek press-kit permission, credit sources, honour takedowns, or fall back to member photos.
  - Retailer terms of service.
  - About 10 hours of owner review for 600 titles.
- **Success metrics.**
  - At least 600 approved definitions by 20 February 2027, covering at least 90% of currently sold JvH and Wasgij.
  - A picker zero-result rate under 15%.
  - 0 EAN collisions.
  - Search Console impressions on JvH and Wasgij queries.
- **First step.** Phase A: SEC-52's index and lookup rule, and SEC-05's status check, with the review's repros as tests.
- **Scores.** member 5/3/5/4 · builder 5/3/5/4 · strategist 5/3/5/4.
- **Judges' take.** Identical scores: "nine approved puzzles is the real bottleneck for every loop", and Dutch JvH and Wasgij coverage is the clearest wedge against MySpeedPuzzling. All three warn about box-art rights and push the brand hubs later.

#### P-24 · A bilingual, indexable public site: locale URLs, hreflang, real 404s, share previews and structured data

Fix-programme · effort L · score **2.63** · cut votes 0 · from COMMUNITY-3, EXPERIENCE-8 · **Next** (`seoHead` and real 404s, small-slice lane), **Later** (the rest)

- **Problem.** Public pages are JigSwap's only organic acquisition surface, and in Dutch they are nearly invisible (UX-14).
  - Only catalogue routes emit a description and og tags, and every docs page is titled "JigSwap".
  - EN and NL share one URL with no hreflang, and `/catalog/nope` returns 200.
  - A live check showed Dutch docs served in English even with a Dutch cookie, because docs are prerendered once in the default locale (`vite.config.ts:28-40`). The 29 NL docs pages can't be indexed.
  - Catalogue pages use raw ids and English-only meta.
  - Other defects:
    - filters are lost on navigation (UX-82);
    - the cover is letterboxed (UX-162);
    - the 404 is off-brand (UX-77);
    - there is no call to action below 861px (UX-81);
    - tiny live counts undercut trust (UX-164).
- **Proposal.**
  1. An optional `{-$locale}` segment on public routes only (`/nl/`, `/nl/catalog/…`, `/nl/docs/…`).
     - Unprefixed URLs are EN and x-default.
     - Dutch visitors get a dismissible "Bekijk deze pagina in het Nederlands" bar, never a redirect.
     - The signed-in app stays cookie-based.
  2. A `seoHead()` helper: localised title and description, canonical, hreflang, og, twitter. Docs read frontmatter, and the page lookup moves into a loader that throws `notFound()`.
  3. Prerender docs and marketing pages in both locales, with a CI check that more than 0 pages were prerendered.
  4. Catalogue detail:
     - `/catalog/<slug>--<id>`, with the bare id redirecting;
     - Product structured data (no rating without real ratings) and breadcrumbs;
     - a paged, cached sitemap with both locales.
  5. Fixes: URL-held filters, a 4:3 cover on phones, a branded 404, a compact CTA below 861px, and live counts hidden below about 50 members.
- **Devices.** A two-column detail page from `md`. Selects sit side by side on phones.
- **User value.** Dutch puzzlers who search for "jan van haasteren puzzel ruilen" find a fast Dutch JigSwap page, and every link pasted into WhatsApp shows a proper preview.
- **Dependencies.** Nothing blocks it. P-22, P-23, P-25, P-27 and P-28 reuse it. P-38 supplies strings and P-41 the EU region.
- **Risks.**
  - URL changes briefly cost rankings; with 9 pages indexed, now is the cheapest moment.
  - Per-locale prerendering doubles prerender time.
  - Optional path params are fairly new in TanStack.
- **Success metrics.**
  - Both locales indexed in Search Console.
  - Lighthouse SEO of at least 95.
  - 0 soft 404s, checked in CI.
- **First step.** `lib/seo-head.ts` on `/` and the docs, the docs lookup in a loader with `notFound()`, and a CI curl for a real 404.
- **Scores.** member 3/3/4/2 · builder 3/3/4/2 · strategist 3/3/4/3.
- **Judges' take.** All three: do `seoHead`, real 404s and meta now; the SEO payoff lags until the catalogue grows. The builder sees optional locale segments as a structural routing change on a young framework feature. The strategist wants Dutch prerendering soon, while URL changes are cheap.

#### P-25 · Shareable swap lists to post in Facebook, Reddit and WhatsApp groups

New feature · effort M · score **2.65** · cut votes 0 · from COMMUNITY-5 · **Later**

- **Problem.**
  - Swapping already happens in groups as unstructured photos and text: Facebook groups (Jersey about 450 members, NZ about 1,800), r/Puzzlexchange (about 5k), r/Jigsawpuzzles (126k) and Dutch WhatsApp family groups (market §1).
  - A member can't point a group at "here's what I have to swap": profile listings require sign-in, and public collections are unreachable (roadmap contradiction #5).
  - JigSwap already holds what groups distrust least: the last solve's completeness.
- **Proposal.**
  - A `shareLists` table: owner, a 128-bit token rather than the handle, scope (all offered copies or one collection), a free-text pickup area of at most 40 characters, expiry, revoked and views.
  - Create, rotate and revoke, rate-limited.
  - An anonymous `getShareList` with its own projection: open, non-private copies re-checked at read time; title, brand, pieces, thumbnail, condition and availability; a completeness hint; the owner via `projectMemberIdentity`.
  - A public page `/s/$token`, `noindex` by default, with "Ask {name} about this", which signs the visitor up and only ever creates a connection offer.
  - "Copy as post text" in NL or EN for groups that strip previews.
  - An og collage image is optional.
- **Devices.** The grid has 2, 3 or 4-5 columns by device. Phones get a sticky "Join JigSwap to ask" bar. The owner settings use preview-left, settings-right on desktop, and a full-screen sheet with Preview and Settings tabs on phones.
- **User value.** A collector posts one link in her swap group. People see real covers and an honest completeness note, and the swap is tracked on JigSwap.
- **Dependencies.** P-05 (SEC-37, projections), P-24, P-22, P-34, P-20 Phase B.
- **Risks.**
  - Part of an inventory becomes public; mitigated by opt-in, revocable tokens, `noindex` and tests.
  - Scraping.
  - Harassment through public asks.
- **Success metrics.**
  - At least 20% of members with 5+ open copies create a list.
  - List view to sign-up at least 5%.
  - 0 privacy incidents.
- **First step.** A backend-only PR with the table, create, revoke and anonymous read, and tests proving private, blocked, revoked and expired cases return nothing.
- **Scores.** member 3/3/4/2 · builder 3/3/3/1 · strategist 3/3/4/2.
- **Judges' take.** All three like "Copy as post text" as the cheapest, highest-value piece and want it after P-05. The builder and strategist call the og collage optional.

#### P-26 · Circles that grow: invite links with admin approval, an About page with house rules, a "new in your circle" digest

Feature-improvement · effort M · score **3.33** · cut votes 0 · from COMMUNITY-6 · **Next** (About, rules and SEC-86, small-slice lane), **Later** (invite links, digest)

- **Problem.** Circles are JigSwap's privacy-first answer to Facebook groups and clubs, but they can't grow beyond mutual followers.
  - The invite picker lists only mutual followers, and its empty state offers no next step (UX-128). Circles have no link mechanism, although households do.
  - A circle has a name only: no description, rename or rules (roadmap #20).
  - Nobody is told about new puzzles in their circles (roadmap #21).
  - Security: SEC-45 (a third party's invite seats a member with someone they blocked) and SEC-86 (any Admin can remove other Admins).
  - Marco's journey stalls here.
- **Proposal.**
  1. Circle invite links:
     - an expiry (14 days by default), a use cap, and a preset permission;
     - built on the existing `inviteLinks` table with a circle context, following the household precedent;
     - visitors see a teaser, then request to join after sign-up;
     - an admin approves, and joining is never automatic;
     - a join is refused when the newcomer has a block with any current member.
  2. `updateCircleDetails`: rename, a description of up to 500 characters, house rules of up to 1,000 ("complete puzzles only, pieces bagged, back within 4 weeks") and an optional meeting place.
  3. Only the owner can remove or demote Admins.
  4. A weekly digest ("5 new puzzles in Puzzelclub Leusden"), mutable per circle, with email opt-in.
- **Devices.** A left rail with About, rules and members on desktop; a single column with a collapsible About on tablet; Puzzles, Chat, About and Members tabs on phones.
- **User value.** An organiser brings everyone in with one link while keeping control through approval, and members hear when something new is on the shelf.
- **Dependencies.** P-22 (hardening patterns), P-17, P-18 (digest ranking), P-04 (throttles).
- **Risks.**
  - Forwarded links; mitigated by approval, expiry and caps.
  - The embedded membership array caps growth at 50.
  - Digest noise.
- **Success metrics.**
  - The share of circles with 3 or more members doubles in 2 months.
  - At least 30% of new circle members arrive by link.
- **First step.** `updateCircleDetails` with capped value objects, an About section, and owner-only Admin removal, with tests.
- **Scores.** member 4/4/5/3 · builder 3/3/5/2 · strategist 3/4/5/2.
- **Judges' take.** All three rate fit at 5 ("private circles are the differentiator"). The member wants links soon, because you can't invite a friend who isn't already a mutual follower. The builder and strategist put the digest after the wishlist (P-18).

#### P-27 · Ruilbeurs mode: swap-fair and meet-up pages with pre-listing, rule checks and a door QR

New feature · effort L · score **2.03** · cut votes **1** (builder) · from COMMUNITY-7, SHARE-10 · **Parked** until an organiser commits (see §5.1)

- **Problem.**
  - In the Netherlands puzzles change hands in person. Obdam runs twice a year: €3 entry, complete 950/1000-piece puzzles only, pieces bagged, at most 10 per person, JvH and Wasgij like-for-like, next edition on 20 February 2027 (market §1).
  - These events run on paper and honour, and one missing piece ruins trust.
  - Nobody serves swap-fair organisers; MySpeedPuzzling's organiser tools target speed competitions.
  - JigSwap's model fits: it has no shipping by design, and already has custody history, completeness fields and two-sided confirmation.
- **Proposal.**
  - MVP:
    - events with a rules value object (complete only, bagged, piece range, maximum per person, like-for-like brands);
    - attendees and listings;
    - admin-created at first;
    - a public, indexable `/events/$slug` with aggregate counts only;
    - "I'm going" plus a capped pick of your copies, with rules checked at pick time ("completeness unverified" when unproven);
    - an opt-in province for "Events in your province";
    - a door QR, an organiser kit and an "event" report target.
  - Phase 2, only after a real pilot: a "What did you swap?" recorder that creates completed trades.
- **Devices.** Details left and listings right on desktop; a single column with a sticky call to action on tablet, the likely organiser device; a hero, rule chips, a sticky "I'm going" bar and a cached 2-column grid on phones.
- **User value.** Before a fair, puzzlers see what everyone is bringing, and organisers enforce "complete only" with real data.
- **Dependencies.** P-24, P-22, P-23 (coverage), P-20 Phase B, P-02 and P-15 for Phase 2, and a partner organiser.
- **Risks.**
  - Cold start, so get organiser consent before publishing any real fair.
  - Fake fairs.
  - Keep tickets and payments out, which also sidesteps DAC7.
- **Success metrics.** In a pilot, at least 30 attendees pre-list at least 150 puzzles, and the organiser asks to use it again.
- **First step.** A short design spec, the domain aggregate, an admin-only `createEvent` and an anonymous event page, enough for one real fair with the organiser's agreement.
- **Scores.** member 3/2/4/2 · builder 2/2/4/1 (cut) · strategist 2/2/4/2.
- **Judges' take.** All three call it "a culturally perfect fit" with high cold-start risk. The builder voted to cut it: pilot one fair with a circle, a P-25 swap list and an invite QR instead. All three say to talk to the Obdam organiser before writing code.

#### P-28 · An NL-first puzzle guides hub and a partner kit for fairs, libraries and clubs

New feature · effort M · score **2.47** · cut votes 0 · from COMMUNITY-8 · **Later** (start small)

- **Problem.**
  - The 29 EN and 29 NL docs pages are all product manuals. There is nothing on what Dutch puzzlers actually search for: second-hand completeness, where to swap, swap evenings, collecting JvH, lost pieces.
  - The accounts guide names buttons that don't exist (UX-163), docs navigation is cramped on phones (UX-78), legal pages have no contents list below 900px (UX-80), and the trust story is anonymous (UX-164).
  - Partners who put a QR in front of their audience are the cheapest acquisition a one-developer product has (market §2 #24, §1).
- **Proposal.**
  1. A guides collection in the docs Vite plugin, at `/guides/$slug` and `/nl/gidsen/$slug`, with article structured data and a per-guide `ref` code.
  2. Eight launch guides, Dutch first:
     - complete or not;
     - puzzels ruilen in Nederland, with a fair calendar;
     - organising a swap afternoon;
     - lending to family;
     - collecting JvH;
     - Wasgij explained;
     - a lost piece;
     - why your shelf is private until you choose.
  3. A partner kit at `/organisers`: an explainer, A4 and A6 PDFs with a `ref` QR, and an NL outreach email.
  4. An outreach process note covering group etiquette and disclosure of the founder role.
  5. The docs fixes (UX-163, UX-78).
- **Devices.** A sticky table of contents on desktop, and a collapsible "Contents" on tablet and phone.
- **User value.** Practical, honest Dutch answers to real problems, and a ready-made kit for organisers that introduces JigSwap.
- **Dependencies.** P-24 (it can start EN-only), P-22, P-23, P-27, P-41.
- **Risks.**
  - Content upkeep.
  - AI-drafted facts such as manufacturer policies and fair dates need a human fact-check.
  - Promotional content annoys groups.
  - Naming the family is a personal choice.
- **Success metrics.**
  - Organic guide sessions grow month on month.
  - Guide to sign-up conversion of at least 2%.
  - 3 partner organisations by February 2027.
- **First step.** The guides collection and route, plus the first guide, "Is deze tweedehands puzzel compleet?".
- **Scores.** member 2/3/3/1 · builder 2/3/4/1 · strategist 3/4/5/2.
- **Judges' take.** A real split. The strategist sees it as the most realistic acquisition for a one-developer product (fit 5). The member and builder warn it will drain owner time and want 2-3 guides only once invites and the catalogue convert.

### 4.5 Trust and safety

#### P-29 · DSA notice-and-action v2: anyone can report public content, every restriction gets a statement of reasons, appeals are tracked, contact points are published

Feature-improvement · effort L · score **2.73** · cut votes 0 · from TRUST-9 · **Next** (minimum duties), **Later** (anonymous notice form, appeals)

- **Problem.** The DSA core is well built: Art. 16(2) notice fields, statements of reasons, and MyReports. The gaps matter now that JigSwap is opening up.
  1. Only signed-in members who can see a target can report, and only some kinds: no puzzle reviews, comments, circles, collections or catalogue entries (SEC-28, roadmap #3). `copy` exists in the schema with no UI entry. Anonymous visitors can't report, although Art. 16 requires a mechanism open to anyone.
  2. "Content removed" doesn't work on user, copy or exchange targets.
  3. Automatically rejected copy, completion and box-art photos get no statement (only message photos do), and catalogue rejections give no reason (UX-49).
  4. Redress means "reply via the contact page", an inbox that can be flooded anonymously (SEC-22, UX-149).
  5. No points of contact are published (Art. 11/12), although marketing claims "complete transparency".
- **Proposal.**
  1. Report anything:
     - new target kinds (puzzle definition, puzzle review, comment, profile, circle, collection) plus the existing copy;
     - a "Report" item in the relevant ⋯ menus;
     - a public notice form at `/report` (Turnstile, a budget and per-target dedupe), stored with no reporter id;
     - a receipt (Art. 16(4)) and the decision (Art. 16(5)) emailed with a single-use status link.
  2. Every restriction gets a statement:
     - "content removed" works for every kind;
     - new decisions "visibility restricted" and "account restricted";
     - one template per decision and ground, and templates no longer overwrite typed text (UX-153);
     - automated photo rejections send the same statement as message photos, with "Ask for a review";
     - catalogue rejection uses a reason dialog with presets.
  3. Appeals as data: a 6-month window and an admin Appeals tab. With a single admin, the page says plainly that the same person decides.
  4. A `/safety` page (EN and NL) covering how moderation works (with P-03's honest status), how to report, points of contact for authorities and members with a dedicated mailbox, the Art. 18 path, and voluntary half-yearly numbers. A footer link points to it.
  5. "Threat to life or safety" reports are urgent and push to the admin.
  6. A DAC7 watch per seller (alert at 25 sales or €1,500).
  - **Next delivers** item 4, automated-rejection statements, the catalogue reason dialog, and review and comment report kinds.
- **Devices.** ReportDialog is a bottom sheet on mobile and a Dialog from `md`. The legal layout gets a `<details>` contents list below 900px (UX-80).
- **User value.** Visitors and members can flag anything harmful and get a receipt and an outcome. Members whose content is restricted always learn why and can ask a person to look again.
- **Dependencies.**
  - P-04 (Turnstile, budget), P-43 (paged contact inbox), P-30 (Appeals tab), P-03 (honest wording).
  - The enum sync points.
- **Risks.**
  - Mass false reports.
  - Counsel should confirm the scope for a micro platform.
  - Emailing non-members is new processing to disclose.
  - Self-review by a single admin must be stated.
- **Success metrics.**
  - Every public content type has a report entry, checked by test.
  - Receipts go out within 1 minute.
  - 100% of restrictions emit a statement.
  - 0 appeals arrive through the contact inbox.
- **First step.** PR "feat(reports): report puzzle reviews and comments", end to end with tests. This closes roadmap #3.
- **Scores.** member 3/2/4/3 · builder 3/3/4/3 · strategist 3/3/4/3.
- **Judges' take.** All three call published contact points and statements for automated decisions cheap baseline duties. The member would skip the DAC7 KPI until sales exist. The builder and strategist want counsel to scope micro-platform duties before the heavier pieces.

#### P-30 · Moderator workbench and account restrictions: the suspension the Terms promise, and a console that is safe on any device

Fix-programme · effort L · score **2.17** · cut votes 0 · from TRUST-10 · **Now** (Photo appeals tab), **Later** (the rest)

- **Problem.**
  - The Terms say accounts may be suspended, but there is no tool. Bans are done by hand in the Clerk dashboard (roadmap #26, contradiction #8).
  - Members' photo review requests have no screen, although the backend exists and the docs promise a review (UX-50, contradiction #1).
  - The console is sound underneath but error-prone for its one operator:
    - rejection is one click with no reason (UX-49);
    - the detail pane goes out of view below 1024px (UX-51);
    - the weakest confirmations guard the most destructive actions (UX-141);
    - the selection can silently switch, so Save approves a different item (UX-142);
    - lists spin forever on error (UX-143);
    - there is no URL state (UX-145) and no pending counts (UX-146);
    - the users table is unusable on phones (UX-147);
    - triage is slow by keyboard (UX-152);
    - the audit trail shows only 30 actions (UX-193);
    - some actions aren't audited (SEC-56), and labels keep PII after deletion (SEC-57).
- **Proposal.**
  1. A `memberRestrictions` table (posting paused, trading paused, suspended), enforced through one `requireMemberCan(ctx, capability)` helper with capabilities declared in P-45's manifest.
     - Suspended members keep read, export, appeal and deletion rights.
     - Clerk `banUser` with a daily reconcile.
     - Open exchanges are cancelled neutrally.
     - The member sees a full-screen notice with the statement.
  2. Queue ergonomics:
     - URL state for deep links;
     - a pinned selection;
     - a Sheet detail below `lg`;
     - J/K/A keys on desktop;
     - `<AdminQueryError onRetry>`;
     - AlertDialogs and Undo toasts;
     - capped pending counts;
     - user rows on phones.
  3. Tabs: Photo appeals first, then Appeals (P-29) and Disputes (P-20).
  4. Audit every admin action, store target ids instead of labels, and add a paged activity log.
  5. Later: a moderator role.
- **Devices.** Queue, detail and context panes from 1280px; list plus a detail Sheet at 820px; on phones a full-height Sheet with a sticky 44px action bar for one-handed decisions.
- **User value.** The owner can stop a scammer or harasser in minutes, as the Terms promise, and work the queues safely from a phone.
- **Dependencies.** P-45, P-29, P-04, P-32, P-40. The Photo appeals tab has no dependencies.
- **Risks.**
  - Enforcing restrictions across about 149 mutations is error-prone; do it only through the manifest-driven helper.
  - Clerk and Convex can drift.
  - Restrictions must never block export or deletion.
  - The admin findings were verified only in code and DOM replicas, so smoke-test with a real admin account.
- **Success metrics.**
  - A confirmed scammer is restricted within 1 hour.
  - 0 photo appeals wait longer than 7 days.
  - Every admin action writes an audit row.
- **First step.** PR "feat(admin): photo appeals tab", with a count, Restore or "Keep removed" behind an AlertDialog, and an admin notification per request.
- **Scores.** member 3/2/4/2 · builder 3/2/3/2 · strategist 2/3/3/2.
- **Judges' take.** All three: ship the Photo appeals tab now. At 13 members a Clerk ban plus a short runbook covers suspension; the restriction layer and keyboard workbench are premature.

#### P-31 · GDPR lifecycle: erasure and retention that match the privacy policy, and analytics consent you can withdraw

Fix-programme · effort L · score **3.43** · cut votes 0 · from TRUST-8, PLATFORM-9, COMMUNITY-4, EXPERIENCE-7 · **Now** (consent slice), **Next** (erasure and processors, below the cut line), **Later** (retention engine)

- **Problem.** The privacy policy, which the review calls unusually honest, promises things the code doesn't yet do.
  - Erasure gaps (02 §8):
    - audit labels keep names and emails (SEC-57);
    - other members' notifications keep the actor's name (SEC-68);
    - private notes stay on completions of copies now owned by others (SEC-69);
    - DM threads between two deleted members are kept, and authors can't delete their own comments or reviews (SEC-70);
    - the legacy messages table isn't purged (SEC-93);
    - posting to a deleted partner recreates rows (SEC-79);
    - a late Clerk webhook can resurrect a deleted member's data (SEC-32).
  - Retention:
    - `domainEvents` is never trimmed, and every deletion pages through the whole log (SEC-71, perf #7);
    - notifications and presence rows have no retention;
    - contact messages are kept forever (SEC-22);
    - undecided reports never expire (SEC-89);
    - the stated photo TTLs aren't implemented (SEC-67).
  - Consent and processors:
    - consent can't be withdrawn, which conflicts with GDPR Art. 7(3) (UX-75);
    - the banner doesn't explain its purpose and has 28px buttons (UX-74);
    - PostHog identifies by email, captures invite tokens, autocaptures DM link clicks and is never erased (SEC-47, 59);
    - AhaSend and Firecrawl aren't named, and DM previews go out by email and push with no opt-out (SEC-64);
    - push keeps working after sign-out (SEC-54);
    - there is no List-Unsubscribe (SEC-84);
    - AhaSend errors log response bodies (SEC-75).
- **Proposal.**
  - A, erasure completeness:
    - new purge phases;
    - target-id-only audit records, shared with P-30;
    - PostHog person deletion;
    - author delete for comments and reviews;
    - a webhook that inserts only on `user.created`, drops stale events and keeps a tombstone;
    - a `domainEventSubjects` lookup so deletion purges by index.
  - B, a retention engine of paged daily crons that log counts:
    - processed `domainEvents` after 30 days (after P-43's memberFeed);
    - read notifications after 180 days and unread after 365;
    - expired presence and rate-limit rows;
    - handled contact messages after 12 months;
    - undecided reports closed after 6 months;
    - the stated photo TTLs, or corrected policy text.
  - C, consent and processors:
    - `resetAnalyticsConsent()`, with "Cookie settings" in the footer, on `/privacy` and in the account menu;
    - a rewritten banner with 44px buttons;
    - PostHog by opaque id, with query parameters stripped, no capture on messaging and `reset()` on sign-out;
    - sign-out unsubscribes this device's push;
    - "Include message text in email/push", off by default for email;
    - List-Unsubscribe and log redaction;
    - every processor and retention period named in the policy (EN, NL, source).
  - D: a `privacyClaims.test.ts` that pairs each policy claim with the code that implements it.
- **Devices.** The consent banner and Cookie settings work identically on every viewport, with 44px buttons and unique accessible names.
- **User value.** Members know exactly what happens to their data when they leave, the retention promises are true, and they can change their analytics choice at any time: a concrete reason to trust a small EU-hosted project.
- **Dependencies.**
  - P-43's memberFeed, before trimming old events.
  - P-30 (audit labels), P-36 (Settings entry), P-41 (fonts).
  - P-14 owns portability.
  - A PostHog personal API key.
- **Risks.**
  - Confirm nothing replays old events before deleting them.
  - Policy text and code must change together.
  - Another secret to manage.
  - Scrubs must not break other members' threads.
- **Success metrics.**
  - Every "kept, not disclosed" item in 02 §8 is deleted, anonymised or disclosed.
  - Deletion completes in 50 or fewer mutations.
  - Consent can be withdrawn in 2 clicks or fewer.
  - A PostHog spot check finds 0 tokens or emails.
- **First step.** PR "fix(privacy): let members withdraw analytics consent", with PostHog identification by opaque id, stripped query strings, `reset()` on sign-out, and no capture on messaging.
- **Scores.** member 4/3/5/4 · builder 4/3/5/3 · strategist 4/3/5/3.
- **Judges' take.** All three put part C first as cheap and legally overdue. The erasure gaps matter but are not urgent. All three insist the retention engine waits for P-43's memberFeed, or deleting old events breaks the feed.

### 4.6 Experience and accessibility

#### P-32 · Responsive shell and adaptive primitives: a real tablet tier, wrapping page heads, touch sizing, scrolling dialogs, compact cards and a confirmation ladder

Fix-programme · effort L · score **3.28** · cut votes 0 · from EXPERIENCE-1, EXPERIENCE-4 · **Now** (slice), **Next** (wave 1), **Later** (the rest)

- **Problem.** At 820px the app renders the full desktop chrome. The 256px sidebar takes 31% of the width and leaves a content card of about 550px (UX-05), and almost every tablet defect follows from that:
  - the message thread shrinks to about 210px and the composer to 34px, with Report and Block pushed off the card (UX-02, blocker);
  - profile actions cover the member's name (UX-32);
  - the dashboard drops to the phone layout and the 3D shelf crops (UX-17);
  - catalogue cards read "View Det…" (UX-109).

  The root causes are viewport breakpoints inside a column that shrinks with the sidebar, and a `sidebar_state` cookie that is written but never read.

  The shared primitives assume a desktop width and a mouse:
  - page heads don't wrap, so actions are clipped on tablets and pushed off the left edge on phones (UX-04, top-10 #3);
  - your own name runs under Edit Profile on phones (UX-31);
  - a broken `@container` makes 20 of 21 notification switches unclickable on desktop (UX-33), and the phone preferences table loses its headers (UX-34);
  - dialogs don't scroll and have a 16px close button (UX-60);
  - toasts cover the tab bar (UX-61);
  - touch targets are 16-32px (UX-70), and 14px inputs likely zoom on iPadOS (UX-71);
  - phones show one card per screen (UX-54).

  Confirmation strength is inverted relative to risk (UX-35, 102, 118, 141). Tablet scores 2.5 for the shell and 2 for messaging.

- **Proposal.**
  1. Shell tiers:
     - phones below 768px are unchanged;
     - from 768 to 1279px, desktop chrome with the existing 48px icon rail by default, and expanding opens an overlay sheet;
     - from 1280px, today's docked sidebar.
     - The cookie is read during SSR, so nothing flashes.
  2. Container queries on the content area:
     - messages split only at 54rem or more;
     - the profile hero switches at `@2xl`;
     - dashboard grids;
     - the catalogue toolbar and cards;
     - notification preferences.
  3. Primitives:
     - PageHead v2 with wrapping actions, folding into ⋯ beyond two;
     - a `touch` variant (coarse pointer or a "larger targets" setting) used by Button, Switch, Checkbox, menus, selects and tabs, with 16px inputs on touch;
     - ResponsiveDialog: a Dialog from `sm` and a bottom Sheet below it, with a scrolling body, a sticky footer that always has Cancel, and a 44px close on touch;
     - a compact two-column card density for phones;
     - semantic badges (UX-173);
     - a ConfirmAction ladder: Undo toasts for reversible actions, AlertDialogs for final ones, and a named dialog for ownership transfer;
     - a toast offset above the tab bar.
  4. Guardrails: a design-lint test, and a dev-only `/dev/ui` gallery for P-44.
  - **Split:**
    - _Now:_ the cookie read, messages at `lg`, wrapping page heads, the preferences wrapper.
    - _Next (wave 1):_ the compact tier, profile hero, phone preference headers, and ResponsiveDialog for the six form dialogs.
    - _Later:_ everything else, migrated gradually.
- **Devices.** This proposal is about devices. Verify at 768, 820, 1024 and 1180, in portrait and landscape, with the sidebar expanded and collapsed, in EN and NL.
- **User value.** Marco can answer messages on his iPad, buttons are tappable, dialogs work on short phones, and risky actions get friction in proportion to the risk.
- **Dependencies.**
  - None to start.
  - P-35 owns colour tokens, and P-36 builds on the `touch` variant.
  - P-15, P-30, P-07 and P-08 consume the primitives.
  - P-44 makes verification cheap.
  - One real-iPad check for UX-71.
- **Risks.**
  - The container-query migration could sprawl.
  - The rail default may surprise laptop users at 1024-1279px.
  - Changing DialogContent in place would touch 58 files, so add ResponsiveDialog as a new primitive.
- **Success metrics.**
  - At 820×1180 the composer is at least 300px wide.
  - 0 clipped page-head actions across 37 routes in EN and NL.
  - A collapsed sidebar survives reload.
  - Tablet re-review scores of at least 3.5.
- **First step.** One PR: the cookie read, messages from `lg` with `BackToInboxLink` below it, `flex-wrap` on the page heads, and screenshots at 390, 820 and 1024 in EN and NL.
- **Scores.** member 5/3/5/4 · builder 4/3/4/3 · strategist 4/2/3/3.
- **Judges' take.** The member scores value at 5, because older members use iPads heavily. All three ship the cookie and wrap first. The strategist warns the full primitive set is "a long migration" (feasibility 2) and should be incremental.

#### P-33 · Wayfinding v2: labelled tabs, reachable Messages, Back that goes back, lists that remember

Feature-improvement · effort L · score **2.87** · cut votes 0 · from EXPERIENCE-2 · **Next** (Messages icon slice, small-slice lane), **Later** (the rest)

- **Problem.**
  - On phones (UX-06):
    - the four tabs are icon-only;
    - Library and Community open launcher pages of tall cards;
    - Messages has no tab, quick-sheet row or top-bar icon, and its unread count is subscribed only by the desktop sidebar (Sanne reaches it through Community → scroll → the fifth card);
    - the back chevron goes up to a hub rather than back (UX-59).
  - Quick actions open lists (UX-58), and ⌘K drops every destination as soon as you type (UX-55).
  - Search, filters, view mode and tabs live in `useState` on six list pages, so Back resets them and nothing can be shared as a link (UX-28, 82, 145; Ineke's journey).
  - Desktop group labels don't look clickable (UX-159).
- **Proposal.**
  1. Visible 11px tab labels (Home, Library, +, Exchanges, Community) that fit 78px in Dutch. This reverses the 2026-06-15 icon-only decision; if you prefer icons, P-36 can offer a "Show tab labels" option.
  2. A Messages icon with an unread count in the phone top bar, a dot on Community, a quick-sheet row, and tap instrumentation so a Messages tab can later be decided on data.
  3. Tabs reopen the last-visited section, with a chip row generated from `NAV_GROUPS`, and launcher pages become compact overviews.
  4. Back uses history when the previous entry is in-app, and the chevron is hidden on tab roots.
  5. Shortcuts that act ("Log a solve" opens `/completions/new`), and a palette that always shows Go To with keywords (swap, trade, lend, ruil).
  6. A shared `useListSearchState` hook for six lists, with fixed-height skeletons so scroll restoration has somewhere to land.
  7. One URL per copy for owners.
- **Devices.** Mostly phones. Desktop group labels become 12px rows, and a fourth top-bar icon must fit Dutch titles at 360px.
- **User value.** Sanne reaches an unread message in one tap, Ineke presses Back and is where she was, and members can paste a filtered catalogue link into a circle chat.
- **Dependencies.** P-34 (labels), P-36, P-08, P-44.
- **Risks.**
  - It reverses a deliberate design decision, so show before and after screenshots.
  - Per-tab memory can feel stale.
  - URL schemas must keep `?exchange=` working.
- **Success metrics.**
  - Taps from the dashboard to an unread thread fall from 3+ to 1.
  - Back restores state (e2e).
  - 0 palette "No results" for navigation terms.
- **First step.** A Messages icon with count in the top bar, `sr-only` counts (UX-09) and fixed quick-action destinations (UX-58), with no IA change.
- **Scores.** member 4/3/5/3 · builder 4/3/4/2 · strategist 3/3/3/2.
- **Judges' take.** All three want the Messages icon now, as a small fix for a real gap in a swap app. The builder and strategist say tab labels are your call. All three see the shared list-state hook as the reusable win.

#### P-34 · One vocabulary, one place per concept: glossary-driven labels, Browse versus catalogue, canonical routes

Fix-programme · effort M · score **3.67** · cut votes 0 · from EXPERIENCE-3, SHARE-2 · **Next**

- **Problem.** The journey reviewer found one recurring cause across all three personas: the vocabulary is never settled (UX-53).
  - The exchange area has five names (Exchanges, Swaps, Trades, In Motion, trading), and the trade flag has four or five labels.
  - A borrower's request reads "Lend · …", and borrowing toasts "Trade request sent".
  - Dutch mixes Uitwisselingen, Ruilen, Te Ruil and Voor ruil.
  - "Browse puzzles" means the catalogue on the public site and other members' copies in the app (UX-23).
  - A lend-only copy says "Request swap" (UX-38), and the detail page keeps "Add to Library" when you already own the puzzle (UX-108).
  - The same copy has two URLs (UX-98), and `/people` promises "near you" (UX-181).
- **Proposal.**
  1. `docs/glossary.md` in EN and NL, with columns for use, avoid and the short form:
     - Exchanges / Uitwisselingen as the umbrella;
     - Swap / Ruilen;
     - Lend and Borrow / Uitlenen and Lenen;
     - Sell and Buy;
     - Puzzle versus Copy;
     - "All puzzles" versus "Available from members";
     - one Add vocabulary.
     - Lead with "swap", the word groups use, and keep "trade" as a palette keyword only.
     - A `glossary.test.ts` bans terms per locale.
  2. A copy-only PR applying it: CTAs derived from availability ("Ask to borrow", "Request swap", "Ask to buy"), "View your copy" when owned, direction-aware loan labels, and an honest `/people` subtitle.
  3. `/browse` becomes "Available from members" and `/puzzles` "All puzzles", with one shared toolbar.
  4. `/exchanges` as the canonical route, with a permanent `/trades` redirect that keeps `?exchange=`, updated email links, and owners always on `/my-puzzles/<id>`.
- **Devices.** It applies on every viewport, with short tab forms on phones.
- **User value.** One word per idea. A borrower's button says "Ask to borrow", and old email links keep working.
- **Dependencies.**
  - Before P-38.
  - P-33 uses the short labels; P-06, P-15 and P-16 apply them.
  - 29+29 docs pages and the tours change in the same stack.
- **Risks.**
  - Renames break muscle memory.
  - Old `/trades` links must redirect forever.
  - A few hundred keys change, so get a Dutch proofread and keep logic changes separate.
- **Success metrics.**
  - The glossary test passes with only proper-noun exceptions.
  - 0 rendered "Trade(s)".
  - 0 lend-only copies saying "Request swap".
- **First step.** The glossary and a report-only test, then a copy-only PR for the exchange vocabulary in `en.json` and `nl.json`.
- **Scores.** member 4/4/5/3 · builder 4/4/4/3 · strategist 4/4/4/3.
- **Judges' take.** All three call it "the one root cause across all three persona journeys" and cheap. The member wants all renames announced in one go and "ruilen" first. The builder and strategist would make the route rename optional churn for later.

#### P-35 · Accessibility to WCAG 2.2 AA: contrast tokens, landmarks and names, focus and keyboard, a public accessibility statement

Fix-programme · effort L · score **2.75** · cut votes 0 · from EXPERIENCE-5, EXPERIENCE-4 · **Now** (tokens and labelling), **Next** (`FilePickButton`, small-slice lane), **Later** (the rest)

- **Problem.** Four root causes produce about 88% of 3,138 axe nodes.
  - Contrast (1,549 nodes):
    - the marketing muted token alone fails on 1,324 nodes (UX-12, top-10 #4);
    - muted text on tinted surfaces, white on brand green (2.37:1), and violet text in dark mode (3.42:1) at 44 call sites (UX-10);
    - faded rows (UX-119), white-on-amber badges (UX-150), and the dark primary button at 3.80:1 (roadmap #27).
  - Structure and names:
    - no skip link, and the sidebar isn't a nav landmark (UX-08; 1,332 region nodes);
    - counts are visual only (UX-09);
    - unnamed controls (UX-15, 25, 107), a wrong heading outline (UX-66), English screen-reader strings (UX-64), and no `<main>` on auth pages and the 404 (UX-73, 77).
  - Focus and keyboard:
    - focus drops to `<body>` (UX-67, 68);
    - all three photo pickers are unreachable by keyboard (UX-11, WCAG A);
    - picker cards can't be operated (UX-44);
    - 20px stars with no arrow keys (UX-30);
    - charts without text (UX-46, 47);
    - focus rings at about 1.8:1 (UX-72).
  - Dark mode had only a contrast check, and Dutch had no axe run. The EAA exempts microenterprises, but WCAG AA is the sensible target (market §4).
- **Proposal.**
  1. Tokens, signed off by you on a swatch sheet: `--mk-text-muted #5f596d`, `--muted-foreground oklch(0.51 0.035 282)`, `--success-strong`, `text-primary-text` in dark mode, the dark primary button raised to 4.5:1, a fixed badge palette, and a lint rule.
  2. A skip link, `#main-content`, a labelled sidebar `<nav>`, `<main>` on auth pages and the 404, labelled navs, and fixed headings.
  3. Count-aware names, names on all controls, every `sr-only` string through `t()`, and a RouteAnnouncer for real path changes.
  4. Focus restored on dialog close, a `FilePickButton` for all three pickers, StarRating as a roving radiogroup (32px, 44px on touch), picker cards as buttons, keyboard category reordering, and 2px full-alpha focus rings.
  5. Charts use P-11's pattern.
  6. A public `/accessibility` statement in EN and NL, a 15-minute VoiceOver and NVDA run per release, and axe in light, dark and NL through P-44.
- **Devices.** Touch sizes come from P-32's variant. The rest applies to every viewport.
- **User value.** Keyboard and screen-reader users, and older members who zoom, can add photos, rate a puzzle, request a copy and hear how many messages are waiting.
- **Dependencies.** P-32, P-44, P-11, P-22 (AuthShell), P-31 (banner).
- **Risks.**
  - Token shifts change the brand look slightly.
  - The RouteAnnouncer can fight scroll restoration.
  - A public statement is a commitment.
- **Success metrics.**
  - Contrast nodes fall from 1,549 to under 50.
  - 0 button-name and region nodes on light variants.
  - Content reached in 2 Tab presses or fewer.
  - All pickers work by keyboard.
- **First step.** Two small PRs: the token fixes with before and after axe counts, and the labelling pass (skip link, `<nav>`, `bellWithCount`, names).
- **Scores.** member 4/3/5/3 · builder 3/3/4/2 · strategist 3/3/3/2.
- **Judges' take.** All three: the token and label fixes clear most of the failures in hours, so ship them now, and the rest is steady background work. All three: publish the statement only when it can honestly list the gaps.

#### P-36 · A Settings hub with Display & comfort controls: text size, larger targets, motion, theme and language on every device

New feature · effort M · score **2.53** · cut votes 0 · from EXPERIENCE-6 · **Next** (theme and language radios, small-slice lane), **Later** (hub); text scale **parked**

- **Problem.**
  - Phone members can't change theme or language anywhere in the signed-in app (UX-56), and desktop menus don't show the current choice, with a US flag that renders as "US" on Windows (UX-57).
  - There is no way to enlarge text; about 100 fixed-pixel text sizes sit in 56 files (UX-119, 178). Targets are 16-32px for mouse users (UX-70). The 3D shelf can't be switched off (UX-89).
  - Settings are scattered: privacy in Edit Profile (UX-03, 117), consent nowhere (UX-75), export at the bottom of Insights (UX-190).
  - Puzzle Tracker offers font sizing, and the market scan recommends designing accessibly for everyone rather than a separate senior mode (market §2 #23).
- **Proposal.**
  1. An app-owned `/settings` route with sections: Display & language, Notifications, Privacy & safety, Solving, Cookies & analytics, Your data and Account (which opens Clerk). It is reachable from the avatar menu, the quick sheet and the palette.
  2. Display & comfort:
     - theme and language radios with checked state;
     - text size (Default, 112.5%, 125%) through a `--text-scale` token;
     - larger touch targets, automatic on coarse pointers;
     - reduced motion;
     - a flat 3D shelf;
     - optional tab labels.
  3. Settings persist in a cookie read during SSR, so nothing flashes, and are mirrored to Clerk metadata.
- **Devices.** Two columns with section navigation on desktop and compact tablets. On phones, a section list opening detail views with 56px rows.
- **User value.** A member who finds small text hard can make the whole app comfortable in one place, and phone users can switch to Dutch or dark mode without leaving the app.
- **Dependencies.** P-32 (`touch` variant), P-05, P-14, P-31, P-41, P-44 (125% Dutch text checks).
- **Risks.**
  - 125% Dutch text will expose overflow.
  - Fixed-height components break.
  - Clerk metadata must never hold security flags.
- **Success metrics.**
  - 5-10% of members choose larger text or targets.
  - 0 overflow regressions at 125% in NL.
  - No `text-[10px]` left.
- **First step.** Appearance and language radio sections with checked state and `lang` attributes, on the existing Preferences page and in the top-bar menus.
- **Scores.** member 4/3/5/2 · builder 2/3/3/1 · strategist 2/3/3/2.
- **Judges' take.** The clearest split in the portfolio. The member values it at 4 ("a text-size setting suits this audience better than a senior mode"). The builder and strategist value it at 2: the text-scale system duplicates browser zoom and P-32. All three agree the phone theme and language switch is a real, small gap.

#### P-37 · Prompt orchestration: one interruption at a time, findable help, a readable What's new

Feature-improvement · effort M · score **2.83** · cut votes 0 · from EXPERIENCE-7 · **Now** (install tip and toast offset), **Next** (What's new collapse, small-slice lane), **Later** (a simple coordinator)

- **Problem.** About 11 surfaces open on their own, and a non-reactive module set coordinates only two of them.
  - The install tip covers about 27% of the phone screen, including the newest chat messages and the `/welcome` Continue footer, its ✕ means "never" (UX-07, top-10 #7), and it ignores the standalone safe area (UX-62).
  - The update toast never expires, covers the tab bar and has 24px buttons (UX-61).
  - The welcome dialog mounts only on `/dashboard`, so deep-link sign-ups never see it (UX-86).
  - What's new renders 42 expanded entries, about 35,000px on a phone (UX-90), and its bodies ship on every dashboard page (perf A5).
  - Guides are hard to find (UX-91, 167).
- **Proposal.**
  1. A PromptCoordinator: at most one interruption at a time and one unsolicited modal per session; nothing on immersive routes, `/welcome` or dirty forms; ✕ snoozes, and "Don't show again" is explicit; consent-gated tracking.
  2. The install tip collapses to a 56px row.
  3. The update prompt is top-centre on phones, with 44px buttons, collapsing after 60 seconds.
  4. What's new: entries in `<details>`, the latest two months plus "Show older", and dynamically imported bodies.
  5. A Help entry in the avatar menu, quick sheet and palette, with one primary guide button.
- **Devices.** Modals centred on desktop and tablet with banners bottom-right. On phones, collapsed rows above the tab bar, only on routes that aren't content-heavy.
- **User value.** New members see one helpful thing at a time, chats and the quick-setup footer are never covered, and release notes are readable on a phone.
- **Dependencies.** P-31, P-33, P-06, P-41.
- **Risks.**
  - Over-suppression can cut install conversion; measure it.
  - The store must not cause shell-wide re-renders.
  - Existing logic tests need migrating.
- **Success metrics.**
  - The install tip never renders on threads or `/welcome` (e2e).
  - At most 1 unsolicited modal per session.
  - What's new on a phone under 5,000px.
- **First step.** The tip returns null on immersive routes and `/welcome`, ✕ becomes snooze, the Toaster gets a mobile offset, and a test checks thread height.
- **Scores.** member 3/3/4/3 · builder 3/3/3/2 · strategist 3/3/3/3.
- **Judges' take.** All three: the install-tip and toast fixes are small and urgent. The full coordinator is "heavier than 11 surfaces need" (strategist); start with "one interruption per session".

#### P-38 · Dutch-first language quality: sentence case, locale-correct formatting, no hard-coded English, Dutch push

Fix-programme · effort M · score **3.72** · cut votes 0 · from EXPERIENCE-8 · **Now** (formatting slice), **Next** (after P-34)

- **Problem.** Dutch is JigSwap's clearest edge (MySpeedPuzzling has no Dutch UI; the JvH niche; Dutch swap fairs), yet the Dutch experience reads as translated.
  - About 216 NL values use English Title Case ("Puzzel Toevoegen", "Te Ruilen", "Pagina Niet Gevonden"), and "stukken" (15) and "stukjes" (32) are mixed (UX-65).
  - 17 argument-less `toLocaleString` calls format with the server or browser locale. Production serves "3,000" to Dutch visitors and a hydration mismatch on `/catalog/<id>` (UX-63).
  - Hard-coded English reaches Dutch users and screen readers (UX-64, 76, 112, 136).
  - The Clerk Dutch strings are garbled (UX-73).
  - Push is English-only by design (roadmap #25).
  - Some layouts break only in Dutch (UX-52, 104, 169).
  - "..." is used instead of "…" (UX-180).
- **Proposal.**
  1. A sentence-case pass applying P-34's glossary, "stukjes" with an ICU plural, and "…". You review by namespace from a generated before/after table.
  2. Guardrails:
     - `nl-style.test.ts` flags capitalised non-initial words, with an allowlist for JigSwap, Ravensburger, Jan van Haasteren and Wasgij;
     - it bans "stukken", "Te Ruil(en)" and "...";
     - an oxlint rule bans argument-less `toLocale*String()`.
  3. `useFormatter()` at all 17 call sites, plus an SSR test for Dutch rendering against an English client.
  4. Hard-coded English moved into keys, and the Clerk Dutch overrides fixed.
  5. Push localised by the member's `preferredLanguage`.
  6. Dutch-only layouts fixed, and verified at 360 and 820px.
- **Devices.** The Dutch-only layout fixes are mostly phone (UX-52, 104, 169).
- **User value.** Dutch members get an app that reads as written in Dutch, with correct numbers and Dutch push: the advantage the largest competitor can't match.
- **Dependencies.**
  - P-34 first, so the casing pass happens once.
  - P-44 for layout checks, P-24 for locale URLs.
  - P-16 needs Dutch push.
- **Risks.**
  - About 220 string edits risk meaning drift, so you proofread as a native speaker.
  - The test needs a curated allowlist.
  - Push needs the locale at send time.
- **Success metrics.**
  - Title Case candidates fall from 223 to under 10.
  - 0 argument-less `toLocale` calls.
  - No hydration errors.
  - Push arrives in Dutch.
- **First step.** `useFormatter` at `catalog/$id.tsx:158`, the oxlint rule, and `nl-style.test.ts` in report-only mode.
- **Scores.** member 4/4/5/3 · builder 4/4/5/2 · strategist 4/4/5/3.
- **Judges' take.** All three: cheap copy work with high fit, done after P-34. You are the native reviewer. The builder rates urgency lowest (2).

### 4.7 Platform and delivery

#### P-39 · CI-gated release train and web edge hardening

Platform · effort L · score **3.20** · cut votes 0 · from PLATFORM-1, TRUST-6 · **Now** (ruleset, CI-gated deploy, SEC-60), **Next** (the rest), **Later** (enforce CSP)

- **Problem.** Release safety rates 2/5, the weakest area in the current-state review (01 risks #1-3).
  - Web prod deploys through Vercel's Git integration on every push to `main`, without waiting for CI; Convex prod does wait. A red `main` can reach members, and for CI's runtime (median 217s) plus the Convex deploy, new web code runs against the old backend.
  - `main` requires no checks or reviews.
  - 227 of 228 recent commits are agent co-authored, and PRs have a median of 554 lines and merge in a median 44 minutes, with 76 over 1,000 lines.
  - With prerender `failOnError: false`, a build that silently loses `/docs` still goes green.
  - CI runs Node 22 while `.nvmrc` pins 26.3.0.
  - Supply chain:
    - the prod `workflow_run` doesn't check the trigger (SEC-60);
    - mutable action tags and an `npx`-fetched CLI in secret-bearing jobs (SEC-61);
    - 52 audit advisories with stale overrides (SEC-63).
  - Edge:
    - only HSTS is sent (SEC-58);
    - signed-in SSR and the server function returning the Convex JWT are served `public`, with no CSRF middleware and no `authorizedParties` (SEC-62, perf B6);
    - the PostHog rewrite likely forwards Clerk cookies (SEC-74);
    - `isAdmin` accepts a flat role claim (SEC-73).
- **Proposal.**
  1. One ordered release path triggered by green CI on a push to this repository:
     - the existing stale-commit guard;
     - the Convex deploy, stamping the sha;
     - `vercel build --prod` and `deploy --prebuilt`, with the CLI as a lockfile dependency;
     - smoke checks on `/`, `/catalog`, a fixture detail page, `/docs` (asserting it is prerendered), `/sitemap.xml`, `/version.json` and a read-only Convex query;
     - automatic `vercel rollback` and a notification on failure.
     - Set `deploymentEnabled.main=false`.
  2. A compatibility rule: the backend deploys first and stays compatible with the previous web build (expand, migrate, contract).
  3. GitHub settings:
     - a ruleset requiring the CI jobs and a PR, with a logged owner bypass;
     - prod keys in a protected Environment;
     - owner approval for risky paths (`schema.ts`, `http.ts`, `isAdmin.ts`, workflows).
  4. Supply chain:
     - SHA-pinned actions with Dependabot;
     - `contents: read`;
     - the SEC-60 condition;
     - a non-blocking audit job and bumped overrides;
     - Node from `.nvmrc`;
     - fail a prod build that prerendered 0 docs pages.
  5. A PR template with a security checklist, and a soft warning over 1,000 lines.
  6. Headers: `nosniff`, Referrer-Policy, Permissions-Policy, frame-ancestors `'none'`, and HSTS with subdomains.
  7. CSP report-only first, with a nonce, then enforced after 2 weeks.
  8. `private, no-store` on signed-in responses, CSRF middleware and `authorizedParties`.
  9. A cookie-stripping PostHog proxy.
  10. A versioned Clerk JWT template, with the flat role fallback dropped.
- **Devices.** None directly.
- **User value.** Members never get a half-deployed or failing build, and a bad deploy rolls back in minutes. The owner keeps the fast agent cadence with a safety net.
- **Dependencies.**
  - A Vercel token and ids as secrets.
  - P-40 receives CSP reports.
  - P-45's manifest feeds a PR report.
  - P-41 owns the region and fonts, and P-44 the preview seeding.
- **Risks.**
  - `vercel build` in CI must reproduce the dashboard environment, so run one preview through it first.
  - Rollback restores web only, hence the compatibility rule.
  - An early CSP can break Clerk, PostHog, MapTiler or the physics WASM.
  - Required checks add about 4 minutes to hotfixes.
- **Success metrics.**
  - 100% of prod web deploys map to a green CI run.
  - Web and backend skew of 2 minutes or less.
  - A rollback drill passes.
  - securityheaders.com grade A.
  - 0 direct pushes to `main`.
- **First step.** A web-production job after the Convex prod deploy, `deploymentEnabled.main=false`, and the SEC-60 condition. The ruleset is a separate settings change.
- **Scores.** member 3/3/3/3 · builder 4/3/4/4 · strategist 4/4/4/4.
- **Judges' take.** The builder and strategist call required checks and CI-gated deploys "the highest-leverage process fixes" for this merge pattern. The member scores it lower because members never see it, but agrees. All three: keep CSP report-only for a good while.

#### P-40 · See failures and costs before members do: cookieless error capture, a global error policy, alerting, a capacity panel

Platform · effort L · score **2.78** · cut votes 0 · from PLATFORM-2, PLATFORM-9 · **Now** (global error toast), **Later** (the rest); capacity panel **parked**

- **Problem.** Most production errors are invisible.
  - Client exceptions reach PostHog only after cookie consent.
  - The ErrorBoundary only calls `console.error`, and there is no `onRecoverableError`, so the hydration mismatch (UX-63) and the uncaught presence rejection (UX-156) reach nobody.
  - SSR errors live only in Vercel logs, Convex functions log only to the deployment, and there is no alerting or uptime check.
  - In the UI:
    - about 150 mutations run with no global error handler, and there are 59 `console.error` sites, so exchange, return, circle share and collection actions fail silently (UX-37, 101-103);
    - admin lists spin forever on error (UX-143);
    - the catalogue says "No puzzles found" while still paging (UX-26).
  - Costs are invisible too: presence heartbeats are probably the largest source of function calls, the moderation pool has no queue-depth signal (perf #15), and the MapTiler budget rows are a hotspot.
- **Proposal.**
  1. A cookieless `POST /api/telemetry`:
     - route template only, never the URL;
     - a scrubber, a per-IP bucket and a body cap;
     - forwarded to an Axiom EU dataset;
     - disclosed as strictly necessary logging.
  2. React 19 root error hooks and window listeners, deduplicated per session.
  3. A global error policy in `router.tsx`:
     - `MutationCache` and `QueryCache` `onError` report and toast unless a flow opts out;
     - `describeConvexError()`;
     - a no-console lint rule.
  4. A shared `<QueryState>` (skeleton, error with Retry, empty).
  5. One wide event per SSR request.
  6. A decision between Convex Pro log streaming and sampled forwarding.
  7. Fix noisy errors at source: presence reuses its session on rate limit, slower heartbeats, one tab heartbeats for all.
  8. Queue depth logged and the MapTiler budget sharded.
  9. A few Axiom monitors, an uptime check and a weekly digest.
  10. An `/admin/platform` capacity panel fed by a daily snapshot.
- **Devices.** `QueryState` is an inline card on every viewport. The capacity panel would be two columns on desktop and stacked key numbers on phones.
- **User value.** When something breaks, the owner knows within minutes and knows which build caused it. Members get a message and a retry instead of a dead button.
- **Dependencies.** P-39 (`GIT_COMMIT`, CSP reports), P-43 (counters), P-41 (RUM), and a legal sanity check on the basis for logging.
- **Risks.**
  - Error payloads can carry PII.
  - Global toasts can double up with inline errors.
  - Axiom volume.
  - An open endpoint.
- **Success metrics.**
  - At least 95% of client errors captured regardless of consent.
  - A deploy-introduced error alerts within 15 minutes.
  - `console.error` in components falls from 59 to 0.
- **First step.** `MutationCache` and `QueryCache` `onError` with `reportError()` and a localized toast, `describeConvexError()` with tests, and EN and NL strings.
- **Scores.** member 3/3/3/3 · builder 4/3/4/3 · strategist 3/3/3/3.
- **Judges' take.** All three: the global toast is the member-facing win, and cookieless intake is sound. The capacity panel, alert suite and presence re-engineering are "overbuilt for 13 members".

#### P-41 · Frontend weight programme: EU SSR, a smaller entry bundle, gated 3D, split i18n, self-hosted fonts and per-route budgets

Fix-programme · effort L · score **3.28** · cut votes 0 · from PLATFORM-3, COMMUNITY-3 · **Now** (A1, B1), **Next** (3D gating and fonts, small-slice lane), **Later** (waves 2-3)

- **Problem.** Every page downloads a 395.5 KB gz entry, which in production includes the cropper and both Clerk locales.
  - Signed-out `/` weighs 405.6 KB gz of JS plus a 76 KB HTML document, 204 KB raw of which is the inlined i18n catalogue.
  - `/dashboard` weighs 512.2 KB gz.
  - Profiles add 1,060 KB gz of physics and three.js with no interaction.
  - SSR runs in Washington (`iad1`) against Convex in eu-west-1. TTFB on `/` is 437-685ms, and member data is rendered in the US, contrary to the policy (SEC-88).
  - 3D scenes render at 60fps while idle on phones (UX-89).
  - Google Fonts block rendering and leak IPs before consent (SEC-65).
  - What's new bodies and the docs corpus ship where they aren't needed.
  - Nothing stops regressions: CI only reports total gzip.
- **Proposal.**
  - Wave 1:
    - A1: move `CopyInstanceScreen` out of the route file, measured at −121 KB gz on every page;
    - B1: `"regions": ["dub1"]`;
    - A2: physics on first interaction;
    - A3: three.js on idle, and skipped on small, data-saving or low-memory devices;
    - D2: render on demand, with DPR capped at 1.5 on touch.
  - Wave 2:
    - i18n namespaces loaded per route;
    - a lazy Dutch Clerk locale;
    - What's new and docs split per page;
    - self-hosted fonts (SEC-65);
    - SVG logos and chunking.
  - Wave 3: SSR loaders for the dashboard, and cached marketing pages.
  - Guardrails: a per-route weight script against a budget file that fails at more than 5% over unless overridden, a test that route modules export only `Route`, and a sampled web-vitals beacon.
- **Devices.** Phones gain most: no three.js or physics by default. Tablets keep the 3D shelf rendered on demand. Desktop looks the same but paints sooner.
- **User value.** Pages open noticeably faster, most of all on phones and from shared links. Phones use less battery and data, and Dutch members' pages are rendered in the EU, as the policy promises.
- **Dependencies.** P-40 (RUM intake), P-34 and P-38 (copy churn before the i18n split), P-45 (conformance), P-36.
- **Risks.**
  - `dub1` slows SSR slightly for non-EU visitors.
  - The i18n split can flash missing keys.
  - Gating 3D changes the brand moment, so the CSS plank must look good.
- **Success metrics.**
  - `/` at or under 270 KB gz.
  - Profiles download 0 KB of physics before interaction.
  - `/` TTFB p75 at or under 250ms.
  - Mobile LCP p75 at or under 2.5s.
- **First step.** Move `CopyInstanceScreen`, add the region, and add the route-export test.
- **Scores.** member 4/3/4/3 · builder 4/4/4/3 · strategist 4/4/4/3.
- **Judges' take.** All three: wave 1 is "nearly free and measured" (about 30 lines for a 31% smaller entry, plus one line for the EU region). The builder wants the i18n split to wait until P-34 and P-38 settle.

#### P-42 · Image renditions and CDN-cacheable public box art

Feature-improvement · effort M · score **2.60** · cut votes 0 · from PLATFORM-6, COMMUNITY-3 · **Later** (after P-01 Phase B)

- **Problem.** Images are the largest byte cost, and nothing makes them smaller.
  - Photos are re-encoded at full size as JPEG q90, or PNG when any pixel is transparent. `thumbFileId` is "not produced yet" (`schema.ts:1014`).
  - On `/catalog`, 9 card images total 3.4 MB, including a 1.77 MB PNG shown about 250px wide.
  - Convex serves storage URLs as private, so the CDN never caches them and every view is billed as file bandwidth.
  - Every image is lazy, including the LCP image, with no `srcset`, and box art has no blurhash.
- **Proposal.**
  1. After moderation passes, encode WebP renditions at 320, 640 and 1280px from the already-decoded bitmap, recorded in `imageRenditions`, with a blurhash for box art. Register them in `isReferenced` and delete them with their source, so P-01's GC stays correct. Backfill.
  2. A Convex HTTP action, `GET /img/box/:puzzleId/:version/:w`, serves only approved public box art (never an arbitrary storage id, so SEC-01 doesn't widen) with immutable caching behind a Vercel rewrite. Private photos keep signed URLs but return `srcSet` and `sizes`.
  3. `srcSet`, `sizes` and `priority` in the image component, high fetch priority for the first row and the detail cover, and blurhash placeholders.
- **Devices.** Phones load 320w (640w at 2× DPR), tablets 640w, desktop detail 1280w, and zoom and lightbox fetch the original.
- **User value.** About 8 times fewer image bytes, covers that appear instantly behind a blur, and bandwidth that stops scaling with every view.
- **Dependencies.** P-01 (reference rules and GC), P-03 (decode guards), P-39 (headers), P-41.
- **Risks.**
  - Extra memory and time in the 4-slot moderation pool.
  - Roughly three times as many blobs.
  - Versioned URLs handle invalidation.
- **Success metrics.**
  - `/catalog` first-load image bytes at or under 0.5 MB.
  - A CDN hit ratio of at least 90%.
  - 100% of approved art with renditions.
- **First step.** One 480px rendition for box art, a `thumbUrl` on the public catalogue cards, and tests for the pass and reject paths.
- **Scores.** member 3/3/3/2 · builder 3/3/3/2 · strategist 3/3/3/2.
- **Judges' take.** Identical: sound and well thought through (approved-only serving keeps the capability model intact), but low urgency at 9 puzzles. It must wait for P-01's reference rules.

#### P-43 · Bounded-reads programme: every public Convex query scale-safe, with read models, a lint ratchet and a scale smoke test

Fix-programme · effort L · score **1.92** · cut votes 0 · from PLATFORM-4, TRUST-4, COMMUNITY-2 · **Next** (Phase A slice plus the status index and inbox paging); Phases B (rest) and C **parked** (see §5.1)

- **Problem.** Several public reads grow with the whole platform. Past Convex's per-function limits they throw rather than slow down, and as reactive queries they multiply bandwidth with every write.
  - Landing stats collect three whole tables, and the home page loader waits on them (perf #2).
  - The activity feed reads up to 4×500 platform-wide events per viewer, about 600k-750k reads per event with 300 members online (perf #3), and one account can wipe it (SEC-30).
  - Definition aggregates read every review, copy and owner per row, with an unclamped page size (perf #4, SEC-49).
  - Inbox reads are unbounded, and the maintained `by_member_activity` index is never queried (perf #6, SEC-24, UX-116).
  - `puzzles` has no status index (perf #8).
  - Notification counts and mark-all-read read everything (perf #11).
  - Admin queues and the contact inbox collect everything (SEC-22, 26).
  - About 18 indexes are unused.
  - `convex-test` enforces none of these limits.
- **Proposal.**
  - Phase A, quick wins with no schema change:
    - a shared `clampPageSize()`;
    - paged admin, contact and doc-feedback lists;
    - the visibility context built once;
    - bounded profile and dashboard shelves;
    - a notification count capped at 99+ and batched mark-all-read;
    - `getExchangeStats` deleted;
    - a non-live pulse feed.
  - Phase B, indexes: `puzzles` status indexes for the queue, sitemap and facets; an attachment index; unused indexes dropped.
  - Phase C, read models, each with a backfill and a nightly reconcile: `platformStats` counters, `definitionStats`, a fan-out `memberFeed`, a paged inbox with an `unreadTotal` row and Archive, and an hour-bucketed landing seed.
  - Guardrails: a `bounded-reads` lint rule with a falling baseline, and a scale smoke test on a 10k-member fixture.
  - **Next delivers** Phase A, the `by_status` index and inbox paging through the existing index. The builder recommends the stats counters and inbox paging early. Phase C waits for measurements.
- **Devices.** The inbox shows 30 threads with Load more and an Archived chip. The badge caps at 99+. The pulse shows "Updated 2 min ago · Refresh".
- **User value.** The home page, inbox and profiles keep working as JigSwap grows, and one hostile account can't freeze shared views.
- **Dependencies.** P-44 (scale fixture), P-07 (Browse), P-31 (retention after memberFeed), P-04, P-40.
- **Risks.**
  - Read models drift.
  - Feed fan-out costs writes.
  - A global counter row conflicts.
  - A non-live feed changes the dashboard feel.
- **Success metrics.**
  - 0 read-limit errors on the fixture.
  - Landing stats read 10 documents or fewer.
  - 0 unannotated `.collect()` calls.
- **First step.** `clampPageSize()` in three places, a single context build in two queries, the notification count capped at 100, and tests.
- **Scores.** member 2/2/3/2 · builder 3/3/3/2 · strategist 2/2/2/2.
- **Judges' take.** All three: Phase A is cheap hygiene worth doing now. memberFeed, definitionStats and the 10k/100k/1M fixture "solve problems three orders of magnitude away" (strategist).

#### P-44 · Browser regression harness: deterministic persona fixtures, viewport × locale × theme checks in CI

Platform · effort L · score **2.47** · cut votes 0 · from PLATFORM-7, EXPERIENCE-10 · **Next** (starter, below the cut line), **Later** (the rest)

- **Problem.**
  - The web app (75k lines, 157 test files) has no coverage measurement, the gateway has 0 tests, and no browser test runs in CI.
  - All three blockers and about 250 UX findings were found only by a one-off capture run for this review. Left overflow is invisible to `scrollWidth`. Breakages cluster where nothing is tested: 768-1000px with the sidebar, 360-390px phones, Dutch and dark mode.
  - Previews are seeded from a full dev export, and preview URLs are posted publicly (SEC-94).
  - Backend tests run with `dangerouslyIgnoreUnhandledErrors` (01 risk #9), and the email Stryker config never runs.
- **Proposal.**
  1. Deterministic seed mutations that refuse to run on prod, with a test of that guard.
     - Three persona worlds: Sanne, a newcomer on a phone; Marco, with a household and a circle; Ineke, with 300 copies.
     - EN and NL content, about 60 approved puzzles, and exchanges and loans in every state.
     - An optional scale profile.
     - The preview workflow runs the seed instead of the dev export, which closes SEC-94.
  2. Clerk testing tokens for three users.
  3. A Playwright project:
     - a matrix of 360, 390, 820, 1024 and 1440 in EN, NL, light and dark;
     - per-route assertions: no console errors, no left or right overflow in action rows, minimum widths for key controls, 16px touch inputs, 24px targets, and axe within a falling baseline;
     - about 20 masked snapshots;
     - journey specs for UX-01, 02, 03, 16, 28 and 35.
  4. CI: public routes on every PR, the full suite on preview-labelled PRs and nightly, non-blocking until stable.
  5. Web and gateway coverage, a gateway contract test, a narrower unhandled-error filter, and email mutation testing.
- **Devices.** This proposal is about devices.
- **User value.** Layout, accessibility and error-free behaviour on phones and tablets stop regressing with each agent PR, and previews no longer risk exposing member data.
- **Dependencies.** P-39, Clerk test users, P-32 (`/dev/ui`), P-41 (fonts). Every Experience proposal uses it.
- **Risks.**
  - Flaky visual tests slow a solo developer, so prefer geometric assertions.
  - The seed must never run on prod.
  - CI minutes.
- **Success metrics.**
  - Previews contain 0 dev rows.
  - A seeded left-overflow regression fails the PR.
  - Serious and critical axe nodes fall from 1,687 to under 100.
  - The PR subset runs in under 10 minutes.
- **First step.** `apps/web/e2e/public.spec.ts`: 15 public routes at 390, 820 and 1440 in EN and NL, with console, overflow and axe-baseline assertions, as a non-blocking job. It immediately flags the known hydration error.
- **Scores.** member 3/2/3/2 · builder 4/2/3/2 · strategist 4/2/3/3.
- **Judges' take.** All three: start small with persona seeds (which close SEC-94) and the non-blocking public subset. Skip the scale fixture and the full nightly matrix until stable. The builder and strategist rate value 4, because "verification is the bottleneck".

#### P-45 · Agent guardrails: a public-surface manifest, a security regression ledger, conformance ratchets, codegen drift checks and docs that tell agents the truth

Process · effort L · score **2.88** · cut votes 0 · from TRUST-7, PLATFORM-8 · **Next** (core), **Later** (the rest)

- **Problem.**
  - Convex functions are the security boundary, and there are 304 public ones; the review had to classify them with a throwaway script. Nothing generically checks that a new function is gated, leaks no `_storage` ids or private fields, caps its text or is rate-limited.
  - The same bug classes recur: raw `toMemberView`, `by_clerk_id` lookups that skip deactivation (SEC-53), unbounded `.collect()` and bare `v.string()`.
  - 11 public functions have no UI caller, and the review's repros were deleted after verification.
  - Delivery is agent-driven, and agents follow what the repo tells them, but:
    - the README describes Next.js 15, pnpm 10, Crowdin and port 3000;
    - CONTRIBUTING points to a PR template that doesn't exist;
    - the architecture spec says "not yet adopted".
  - Unenforced rules:
    - `ctx.db` outside adapters in 46% of function files;
    - `_generated` maintained by hand;
    - 412 `as unknown as` casts;
    - 102 compat-shim imports;
    - 17 argument-less `toLocale` calls.
  - Hygiene: 170 worktrees, 134 branches with a gone upstream, 16 MB of unreferenced PNGs.
- **Proposal.**
  1. `accessPolicy.ts` maps every public function to a policy and flags, and `publicSurface.test.ts` fails on missing or stale entries.
  2. Generic gate tests: unauthenticated callers throw, members are refused on admin functions, deactivated members are refused.
  3. A canary privacy fuzz: a private member's fields and blob ids are unique canaries, and every query run as a stranger or a blocked member must return none of them.
  4. A security regression ledger: the review's condensed repros ported as `it.fails`, flipped by each fix PR, with the burn-down published.
  5. `scripts/conformance.mjs` with counts that may only fall, covering `toMemberView`, `by_clerk_id`, bare `v.string()`, raw storage deletes, `ctx.db` outside adapters, casts, compat imports, `toLocale` and route exports.
  6. Shrink the surface: delete `getExchangeStats` and `addCopyImage`, and gate or wire the other unused operations.
  7. A codegen drift check in CI, falling back to a bot PR.
  8. An ADR on the gateway's role.
  9. A compat-shim codemod.
  10. Docs truth: a README and CONTRIBUTING that work from a clean clone, a regenerated `.env.example`, flipped spec status lines and a drift check.
  11. A dry-run branch pruner, LFS for the marketing PNGs, a PR template and leftover cleanup.
  - **Added by the builder (G-3):** make the notification-enum sync points type-enforced before more kinds are added. At least six proposals add notification kinds or report targets.
  - **Next delivers** items 1-4, 10 and G-3. Later: items 5-7 and 11. Parked: items 8-9.
- **Devices.** None.
- **User value.** Fixes stay fixed, every new AI-generated feature gets the same authorization and privacy scrutiny automatically, and a future contributor, or a future you, can follow the docs and succeed.
- **Dependencies.** None to start. It multiplies the value of P-01, P-04, P-05 and P-30. CI wiring follows P-39.
- **Risks.**
  - Argument synthesis is brittle for complex validators.
  - The fuzz adds runtime, so run it as a separate job.
  - Ratchets can be gamed.
  - Local Convex in CI may lag.
  - Branch deletion is irreversible, hence dry-run by default.
- **Success metrics.**
  - 100% of public functions in the manifest.
  - 0 canary leaks.
  - The ledger for the 30 High and Medium findings burns down to 0.
  - The README quickstart works from a clean clone.
- **First step.** A manifest generated once, the surface test (missing or stale entries; unauthenticated refusals), and a conformance script with three rules and a baseline.
- **Scores.** member 3/3/3/2 · builder 4/3/4/3 · strategist 4/3/4/3.
- **Judges' take.** All three keep the canary fuzz, the ledger and docs truth. The builder and strategist would skip or delay the compat codemod, LFS move, ADR polish and `ctx.db` ratchet.

---

## 5. Considered and parked

### 5.1 Parked proposals

The rule was two or more cut votes, or a priority score below 2.0. P-27 sits just above that line (2.03) but has a cut vote, and all three judges set the same precondition: talk to an organiser first. It is parked with that gate. Each parked proposal keeps its cheapest useful slice.

| Proposal                                            | Score | Cut votes      | Why parked                                                                                                                                                         | Slice kept                                                                                                 | Reopen when                                                                                                        |
| --------------------------------------------------- | ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P-21 Circles as puzzle libraries                    | 1.48  | 3              | Unanimous cut. It builds holds, library mode, a desk view and labels for institutions nobody has recruited, on top of lending that isn't working yet.              | The on-loan/reserved status chip, via P-02 and P-17                                                        | A named club, care home or library commits to a pilot, and P-16 shows loans in real use                            |
| P-12 Solving companion (timer, Up next, table mode) | 1.60  | 1 (strategist) | Competes on MySpeedPuzzling's home turf (speed, stopwatch). It adds aggregate complexity and subscription churn for little differentiation with a family audience. | A "To solve" filter in P-08; consider "Set aside" next to P-09                                             | Members ask for timers or set-aside in G-2 conversations                                                           |
| P-19 Exchanges between strangers                    | 1.82  | 0              | Built for stranger-to-stranger trade that doesn't exist yet: trust tiers, pledges, slot scheduling with `.ics` files, postcode fields.                             | The honest "New to JigSwap" line and the sale scam banner (Next lane)                                      | Exchanges outside existing connections become common, or reports per exchange rise                                 |
| P-13 Scan to add, phases 2-3                        | 1.85  | 0              | The XL penalty. With 9 approved puzzles most scans miss, and the offline service worker is the riskiest piece a solo developer could take on.                      | Phase 1 USB scanners (Next lane); the household-aware "On your shelf" badge could ride with P-06's chooser | P-23 seeding reaches about 600 entries and barcode hit rates are tracked. Phase 3 only if fair use is demonstrated |
| P-43 Bounded reads, Phases B (rest) and C           | 1.92  | 0              | The read models (memberFeed, definitionStats, platformStats) and the 10k/100k/1M scale fixture solve problems three orders of magnitude away.                      | Phase A, the `by_status` index and inbox paging (Next)                                                     | Read-limit warnings or slow home loads appear; roughly 1,000 members or 300 open listings                          |
| P-27 Ruilbeurs mode                                 | 2.03  | 1 (builder)    | Cold start and a large new model (events, attendees, listings, rule engine) with no committed organiser.                                                           | A guide page and partner flyer (P-28); a pilot with a circle, a P-25 swap list and an invite QR            | An organiser, for example Obdam's, agrees to pilot                                                                 |

### 5.2 Sub-scopes cut or deferred inside kept proposals

The judges' most frequent advice was to unbundle: keep the cheap, urgent core and defer the speculative build. These parts are cut, deferred or optional; Now and Next don't depend on any of them.

| Proposal | Part cut or deferred                                                                | Raised by                              | Status                                                         |
| -------- | ----------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| P-01     | The streaming `POST /upload` httpAction ledger                                      | builder, strategist                    | Replaced by a ledger written from the existing upload mutation |
| P-02     | Owner notification for co-manager offers (item 6) and the daily invariant query     | member                                 | First to drop if Next runs short                               |
| P-03     | Stage 2: an always-on EU relay to HCS                                               | all three lean against                 | Your decision (§6)                                             |
| P-04     | Turnstile and sharded global budgets                                                | strategist                             | Only if refusal logs show they're needed                       |
| P-05     | "See what others see" (`viewAs`)                                                    | all three                              | Optional extra                                                 |
| P-07     | The `listings` read model and new Browse layouts                                    | all three                              | Later, with a trigger                                          |
| P-10     | Recurring roll-over beyond basics, pace lines                                       | builder, strategist                    | Kept minimal                                                   |
| P-11     | Household and circle challenges                                                     | all three; the builder would drop them | Parked                                                         |
| P-15     | `retractConfirmation`, the full-screen detail route, the new notification kind      | builder                                | Later                                                          |
| P-16     | The `return_pending` state machine, auto-close, reopen windows, extension approvals | builder, strategist                    | Later, with a trigger                                          |
| P-18     | Alert fan-out                                                                       | all three                              | Later, when there is supply                                    |
| P-20     | Phase C: box and pieces grades, missing-piece pins, two-sided check-ins             | all three                              | Parked                                                         |
| P-22     | The `/admin/growth` cohort dashboard                                                | all three                              | Parked; a source column only                                   |
| P-25     | The satori og collage                                                               | builder, strategist                    | Optional                                                       |
| P-29     | The DAC7 seller KPI                                                                 | member                                 | Until sales exist                                              |
| P-30     | The manifest-driven restriction layer and the keyboard workbench                    | all three                              | Later, with a trigger; a Clerk ban and a runbook meanwhile     |
| P-34     | The `/trades` → `/exchanges` route rename                                           | builder, strategist                    | Optional                                                       |
| P-36     | The app-wide text-scale system                                                      | builder, strategist                    | Parked (the member disagrees, §4.6)                            |
| P-37     | The full priority-ranked PromptCoordinator                                          | builder, strategist                    | Replaced by "one interruption per session"                     |
| P-40     | The capacity panel, the full alert suite, presence re-engineering                   | all three                              | Parked; a weekly digest and an uptime check instead            |
| P-44     | The 10k-member scale fixture and the full nightly matrix                            | all three                              | Parked until the starter is stable                             |
| P-45     | The compat-shim codemod, LFS move, gateway ADR and `ctx.db` ratchet                 | builder, strategist                    | Later or parked                                                |

### 5.3 Dropped or moved during consolidation

Sixty lens proposals became 45. These are the 24 consolidation decisions.

| #   | What happened                                                                                                                                                                                                                        | Where it lives now                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1   | SHARE-1 and TRUST-2 Phase A were two near-identical settlement-guard programmes (SEC-02, 09, 36); the duplicate plan was dropped                                                                                                     | P-02                               |
| 2   | TRUST-6 and PLATFORM-1 duplicated release gating, supply chain and security headers                                                                                                                                                  | P-39                               |
| 3   | EXPERIENCE-10 and PLATFORM-7 duplicated the viewport × locale × theme Playwright harness                                                                                                                                             | P-44                               |
| 4   | COMMUNITY-9's goal fixes duplicated CORE-2 (UX-42, 43); its recap and challenges moved on                                                                                                                                            | P-10; recap and challenges to P-11 |
| 5   | CORE-7 and SHARE-6 duplicated the wishlist. SHARE-6's separate `wants` table and system-wishlist collection were dropped, because `favorites` already has the reverse index                                                          | P-18                               |
| 6   | SHARE-8 and COMMUNITY-10 duplicated circle library mode and holds; COMMUNITY-10's "Lend to…" and Loans tab moved                                                                                                                     | P-21; lending parts to P-16        |
| 7   | SHARE-10 and COMMUNITY-7 duplicated the swap fair. SHARE-10 Phase 2 (per-puzzle swap credits, a credit wallet, a check-in kiosk) was dropped as out of character: a quasi-currency, staffed-event operations and heavy offline needs | P-27                               |
| 8   | CORE-8 and EXPERIENCE-9 had overlapping timer models; the `timerSessions` model was kept and table mode became the timer's tablet view                                                                                               | P-12                               |
| 9   | The Exchanges › Loans tab appeared three times (SHARE-4, COMMUNITY-10, EXPERIENCE-3)                                                                                                                                                 | P-16                               |
| 10  | CORE-1 item 8 and COMMUNITY-1 PR3 duplicated the `/welcome` Continue fix (UX-16)                                                                                                                                                     | P-06                               |
| 11  | CORE-1 item 2, TRUST-5's UX-20 UI and COMMUNITY-6 items 3-4 duplicated SHARE-5's Sharing card, visibility preference and bulk circle sharing                                                                                         | P-17                               |
| 12  | SHARE-3's privacy fixes (SEC-08, 11, 12) duplicated TRUST-5; its request throttles (SEC-24) duplicated TRUST-4                                                                                                                       | P-05 and P-04                      |
| 13  | TRUST-4 item 3 (bounded inbox, unread, admin queue and feed reads) duplicated PLATFORM-4                                                                                                                                             | P-43                               |
| 14  | PLATFORM-9's blob registry and storage GC duplicated TRUST-1's ledger and GC; its retention crons duplicated TRUST-8 D                                                                                                               | P-01 (one ledger, one GC) and P-31 |
| 15  | PLATFORM-8 item 4 (resolve 11 unused gateway operations) duplicated TRUST-7 item 6                                                                                                                                                   | P-45                               |
| 16  | COMMUNITY-3's performance items (region pin, inline i18n, prerender caching, thumbnails, fonts, landing counters) duplicated PLATFORM-3, 6 and 4; its privacy guards (SEC-44, 90) moved                                              | P-41, P-42, P-43; guards to P-05   |
| 17  | EXPERIENCE-8 item 6 (crawlable `/nl/` URLs and hreflang) duplicated COMMUNITY-3                                                                                                                                                      | P-24                               |
| 18  | COMMUNITY-4's consent and PostHog items duplicated TRUST-8 E; its search-miss log moved                                                                                                                                              | P-31; search misses to P-23        |
| 19  | EXPERIENCE-4 was split: colour tokens to accessibility, confirmation levels to the shell primitives, and the global error toast duplicated PLATFORM-2                                                                                | P-35, P-32, P-40                   |
| 20  | EXPERIENCE-2's "re-tapping the active tab scrolls to top" was already built (`mobile-tab-bar.tsx:168`); only the second-tap return to the section root remains                                                                       | P-33                               |
| 21  | SHARE-2's new `/trades/$exchangeId` route was largely built already as `/trades?exchange=<id>`; only a phone and tablet full-screen view remains                                                                                     | P-15                               |
| 22  | CORE-5 and COMMUNITY-2 duplicated the SEC-05 and SEC-52 barcode-integrity fixes                                                                                                                                                      | P-23 Phase A (P-13 depends on it)  |
| 23  | PLATFORM-5 and COMMUNITY-2 duplicated the UX-01 `getAllBrands` first step                                                                                                                                                            | P-07                               |
| 24  | SHARE-5 and COMMUNITY-6 duplicated circle description and rename (roadmap #20)                                                                                                                                                       | P-26                               |

---

## 6. Open questions for the owner

These are decisions only you can make. Each says what it changes in the roadmap and gives a suggested default if you'd rather not decide now.

### 6.1 Direction and growth

1. **Public growth or invite-led growth for now?**
   - Several "before opening wider" items sit in Next: P-04 wave 2, P-05's remaining items, P-29's minimum duties and P-45's privacy fuzz.
   - Pushing public channels (Reddit, Facebook groups, SEO, fairs) before those land invites exactly the abuse those items close.
   - _Default:_ stay invite- and circle-led until the Next rows above the cut line are done, then open up around the Obdam fair.
2. **Monetisation stance.**
   - Free forever, donations or a premium tier? It shapes processor budgets and whether JigSwap ever handles money.
   - Because sales exist (`salePrice`), it also decides how close you come to DAC7 platform reporting. Sellers are exempt below 30 sales and €2,000 a year (market §4).
   - _Default:_ free, no payments handled in the app, a donation link at most. Keep sale-type exchanges arranged between members.
3. **Postal swaps or local hand-off only?**
   - Shipping was dropped on purpose (`propose.ts:98`), and the Dutch letterbox limit makes posting a puzzle cost a full parcel (market §2 #11).
   - P-19 would add post scope and postage rules.
   - _Default:_ local first. Record "posted" as a hand-off method only if members ask for it.
4. **Compete on speed-puzzling or not?**
   - Parking P-12 means leaving timers, leaderboards and competitions to MySpeedPuzzling.
   - _Default:_ confirm that you don't compete there; JigSwap's edge is sharing, not speed.
5. **Outreach.**
   - Contacting the 13 members and the Obdam organiser (G-2) is outward-facing, so it needs your go-ahead.
   - It is the cheapest research in this chapter, and it decides P-18 alerts, P-21 and P-27.
   - _Default:_ a short conversation or a 3-question survey in November.
6. **Put the family on the record?**
   - UX-164 and P-28 suggest names and a photo on `/about` and guide bylines, instead of "The family behind JigSwap". This is a personal choice.
   - _Default:_ first names only, once you're comfortable.

### 6.2 Safety, legal and processors

7. **CSAM: real matching, or a plain statement that it is off?**
   - Stage 2 of P-03 needs an Offlimits HCS account, an always-on EU relay and its secret.
   - Also: which moderation provider runs in prod? The code defaults to Hugging Face, the brief names Sightengine, and the review couldn't tell (01 §10).
   - _Default:_ Stage 1 now and a plain public statement. Revisit Stage 2 when photo volume grows or HCS access is easy.
8. **Minimum age.**
   - A family-rooted product with households needs a stated minimum age or a parental-consent stance. The Dutch digital age of consent is 16 (GDPR Art. 8).
   - This also bears on photo and CSAM risk. The strategist raised it as a gap.
   - _Default:_ 16+ for an account, stated in the terms. Younger family members use a parent's account.
9. **Counsel review.**
   - Who reviews the screening wording (P-03), the contact-sharing and policy changes (P-05, P-31) and the DSA scope for a micro platform (P-29)?
   - Processor agreements and a record of processing aren't covered by any proposal.
   - _Default:_ one paid review of the privacy, terms and safety texts before opening wider.
10. **New processors and paid plans.**
    - Adopt Turnstile (a new processor) for the anonymous forms, or rely on budgets?
    - Add a PostHog personal API key so erasure can delete PostHog persons?
    - Move to Convex Pro for log streaming and scheduled backups?
    - _Default:_ no Turnstile until budgets prove insufficient; yes to the PostHog key; decide on Convex Pro together with G-1.
11. **Catalogue sourcing.**
    - For P-23, may box art be imported from retailer pages (copyright and database rights), or only with press-kit permission, falling back to member photos?
    - For P-14, may imported rows with a valid EAN, title and piece count be auto-approved?
    - _Default:_ facts from anywhere, images only with permission or from members; no auto-approval until seeding is done.
12. **A second admin.**
    - You are the only admin and moderator: a bus-factor and self-review problem (P-29 must state it). P-30 item 5 sketches a moderator role.
    - _Default:_ name one trusted family member as a backup admin, with a written runbook.

### 6.3 Product rules

13. **Drop the 24h edit window on solves?** The window refuses edits to back-dated solves (UX-48). The member and strategist would drop it for personal fields (dates, time, notes); the builder wants the intent confirmed. _Default:_ drop it for personal fields and keep reviews out of scope.
14. **Labelled tabs on phones?** P-33 reverses the 2026-06-15 icon-only decision. _Default:_ look at before-and-after screenshots; ship the Messages icon either way.
15. **Vocabulary.** Lead with "swap" / "ruilen" (P-34)? Rename `/trades` to `/exchanges` with a permanent redirect? _Default:_ yes to the glossary; defer the route rename.
16. **Favourites become a Wishlist?** P-18 changes what an existing feature means for current members. _Default:_ yes, announced in What's new, once the Browse heart works.
17. **A 2026 "Year in Puzzles" recap?** Shipping it for this December competes with trust fixes, and few members have 3+ solves. _Default:_ skip 2026 and plan for 2027.
18. **Counter-offers and multi-puzzle swaps?** These are everyday habits in swap groups (roadmap #10, #11), and no proposal covers them; the member judge flagged the gap. _Default:_ ask in G-2 before designing anything.
19. **Lost and extra piece matching?** It is the most distinctive community idea in the market scan (market §2 #7): JigSwap knows who owns the same puzzle, so it can route "found an extra piece" posts to them. It is only a footnote in P-20. _Default:_ a small spike after P-20 Phase B.

### 6.4 Capacity, cost and release

20. **How many focused days a week can you give?** The calendar assumes about 5 (§3.1). Fewer days stretch the calendar but shouldn't change the order.
21. **A monthly cost ceiling.** No proposal sets an owner-facing budget across Convex, the classifier, Firecrawl, AhaSend, MapTiler and Clerk invites, or says who is alerted when it is crossed. _Default:_ a number per provider, set now as a billing alert in each provider's dashboard; fold it into P-40's weekly digest when that ships.
22. **Release bundling.** Accept the rule in §3.1 (item 8) that user-visible renames and rule changes ship as a few announced releases? _Default:_ yes: one "trust" release in November, the goals fix on its own before mid-December, and one "words and Dutch" release together with the exchange changes in January or February.
