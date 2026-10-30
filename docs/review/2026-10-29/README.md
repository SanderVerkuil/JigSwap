# JigSwap application review, 29 October 2026

A review of `main` at `6b04171e55` covering:

- the current state of the product and codebase;
- security and privacy;
- UI/UX on desktop (1440px), tablet (820px) and mobile (390px), in light, dark and Dutch;
- performance and scalability;
- 45 proposals for features and improvements, placed on a roadmap.

## Executive summary

**The foundation is strong.** The full CI mirror passes: format check plus 19/19 turbo tasks, with 6,054 tests, 0 failing and 0 skipped. Line coverage is 99% for the domain package and 96% for the backend. Every public Convex function the review read authenticates the caller server-side through Clerk. A few hand-rolled lookups skip `requireMember`'s check for deactivated accounts (SEC-53). The June privacy work is still intact. Dark mode is fully themed and the Dutch translation is complete. The product does far more than a typical side project: catalogue, library, solves, goals, insights, households, circles, lend/swap/trade/sell, DMs and circle chat, notifications on three channels, and admin moderation.

**Two security findings need fixing now. Both were reproduced with `convex-test` and re-checked by hand for this README.**

- **SEC-01: any member can permanently delete catalogue box art.**
  - Copy views expose the box-art `_storage` id as `snapshot.thumbnail`.
  - `addCopyPhoto` accepts any existing storage id.
  - Removing that "photo", or the moderation re-encode on its own, then deletes the original blob.
- **SEC-02: a stale accepted exchange can move a copy out of the library of someone who is not a party to it.** Settlement never re-checks the current owner.

The remaining 93 security findings are mostly missing abuse controls: rate limits, length caps and bounded reads. They also include privacy leaks where code bypasses `projectMemberIdentity`, and a CSAM hash check that is inert today.

**UX is careful on desktop and breaks at the edges.** There are three blockers:

- the catalogue **Filters** panel never loads, because `getAllBrands` returns `undefined`;
- the **message composer** is 34px wide on an 820px tablet;
- the **Edit Profile** form is wider than a phone, which hides the only Private-profile switch available after onboarding.

Most other issues come from a few shared causes:

- the tablet width gets the full desktop chrome;
- page-head and action rows don't wrap;
- some flows silently drop what members entered;
- discovery only works at test-data size;
- the vocabulary is inconsistent (trade, swap and exchange are used interchangeably; Browse and catalogue are confused; there are three "Add Puzzle" buttons).

Four root causes account for about 88% of all axe accessibility nodes.

**The weakest area is the release process, not the code.**

- Web production deploys through Vercel's Git integration without waiting for CI.
- `main` has no required checks or reviews.
- The live site sends no CSP or framing headers.
- The median PR has 554 changed lines and merges in 44 minutes.
- The README still describes Next.js 15.

**Performance has cheap wins.**

- Moving `CopyInstanceScreen` out of its route file was measured to cut every page's entry JS by 31% (395.5 → 274.0 KB gzip).
- SSR runs in Washington (`iad1`) while Convex is in eu-west-1.
- An 819 KB gzip physics bundle loads on every profile view.
- Several Convex reads cover the whole platform. They are fine at today's size but will hit read limits as JigSwap grows.

**What to build.** JigSwap's distinctive position is private, household- and circle-scoped lending and swapping of physical puzzles, with an honest custody history and Dutch-first quality. The main comparable product, MySpeedPuzzling, has no Dutch UI, no households or circles, and no loans. The proposals sequence the work as follows:

1. Fix and harden in the next four weeks.
2. Over the winter, make the everyday loops correct: exchanges, solves and yearly goals, and sharing controls.
3. Seed the catalogue with Jan van Haasteren and Wasgij titles before the Obdam swap fair on 20 February 2027. The live site counts 13 puzzlers and 9 approved catalogue entries, so catalogue coverage is the activation bottleneck.
4. Gate everything else on measured triggers.

## Chapters

| #   | Chapter                                                  | What's in it                                                                                                                                                                                                              | Size                                                    |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 01  | [Current state](01-current-state.md)                     | Feature map, architecture conformance, CI and test health, docs drift, delivery cadence, key risks, health scorecard                                                                                                      | 8 scored areas                                          |
| 02  | [Security review](02-security-review.md)                 | Threat model, 95 findings (2 high, 28 medium, 47 low, 18 info) with evidence, exploit scenarios, fixes and repro tests, plus a hardening backlog and positives                                                            | 137 candidates from 14 passes, merged                   |
| 03  | [UI/UX review](03-ui-ux-review.md)                       | Scorecard by area and viewport, desktop/tablet/mobile reports, cross-cutting themes (navigation and IA, design system, dark mode, accessibility, Dutch, robustness), persona journeys, findings by area, with screenshots | 195 findings: 3 blocker, 49 major, 103 minor, 40 polish |
| 04  | [Performance](04-performance.md)                         | Bundle and chunk analysis, rendering, images and caching, SSR region, Convex query bounds and cost at scale                                                                                                               | Prioritised tables                                      |
| 05  | [Proposals and roadmap](05-proposals.md)                 | 45 proposals (P-01…P-45) scored by three judges, a Now/Next/Later roadmap with effort, the security and UX coverage matrix, parked ideas, and open questions for you                                                      | ~24 / ~60 / ~150 owner-days                             |
| A   | [Market and competitor scan](06-appendix-market-scan.md) | Comparable products and communities, feature patterns, pain points, with sources                                                                                                                                          | —                                                       |
| B   | [Roadmap gap analysis](07-appendix-roadmap-gaps.md)      | What the specs promise vs what is built, and contradictions between docs and code                                                                                                                                         | —                                                       |

## Do these first

Drawn from all chapters. The full sequencing, with dependencies, is in [05 §3.2](05-proposals.md#32-now-weeks-1-4-2-nov--27-nov-2026).

| #   | Action                                                                                                                     | Source                   | Effort |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| 1   | ~~Confirm that prod backups exist~~ Done: the owner confirmed that backups are handled through Convex.                     | 05 G-1                   | —      |
| 2   | Storage capability model: claim-once uploads, and no raw `_storage` ids in responses                                       | SEC-01, P-01             | S–M    |
| 3   | Re-check ownership at settlement, and reserve copies on accept                                                             | SEC-02, SEC-09, P-02     | M      |
| 4   | Fix the three UX blockers: `getAllBrands` filter, Edit Profile grid, messages split view at `lg` plus sidebar-state cookie | UX-01/02/03              | S      |
| 5   | Gate web prod deploys on CI and add a ruleset on `main`                                                                    | 01 §8.4, P-39            | S–M    |
| 6   | Privacy projection pass: consented email sharing, identity-only member cards, one handle namespace                         | SEC-07…13, P-05          | M      |
| 7   | Abuse controls wave 1: rate limits on paid and anonymous endpoints, length caps                                            | SEC-14, 19, 21, 27, P-04 | M      |
| 8   | CSAM control: never serve quarantined bytes, and say plainly what is and isn't checked                                     | SEC-03/04, P-03          | S      |
| 9   | Move `CopyInstanceScreen` out of the route file (−31% entry JS), and pin SSR to an EU region                               | Perf A1/B1, P-41         | S      |
| 10  | Contrast tokens and a labelling pass (skip link, `<nav>`, accessible names)                                                | UX-08/09/12/15, P-35     | S      |

## How the review was done

Everything ran from a dedicated worktree, `.claude/worktrees/app-review` on branch `docs/app-review-2026-10-29`. Agents that ran tests or builds each got their own isolated worktree, which was removed afterwards. In total, 72 agents ran across four workflows.

- **Security (34 agents).**
  - 11 slice reviewers covered identity, messaging, library, social, catalogue, notifications, sharing, admin/moderation, the web app/CI/supply chain, and privacy, plus one systematic sweep of all 304 public functions.
  - Each slice had an adversarial verifier that tried to refute its findings and, where it could, proved them with a `convex-test` repro in an isolated worktree.
  - A completeness critic added three gap passes: image decoding, storage lifecycle and feed abuse.
  - Live checks were read-only: headers on jigswap.site and `pnpm audit --prod`.
  - No mutation or action was called against any deployment.
- **Current state and performance.** These analysts ran in the same workflow.
  - One analyst ran the CI mirror with `--force`.
  - One built production bundles and measured chunk sizes.
  - One reviewed Convex query cost.
- **UI/UX (25 agents).**
  - 52 routes were captured in 6 variants (desktop-light/dark, tablet-light, mobile-light/dark, mobile-nl), giving 312 captures and 894 viewport tiles.
  - Each capture also recorded axe-core WCAG 2.2 scans, overflow, tap-target, truncation and input-zoom metrics, and console and network errors. First-visit states were captured separately.
  - 12 reviewers each owned one area: marketing, onboarding, library, discovery, messaging, social, sharing, solving, shell/design system, accessibility and i18n, admin (code only), and persona journeys.
  - Reviewers could make read-only browser checks against a local dev server, signed in as the dev test account. Each area had a skeptical verifier.
- **Proposals (13 agents).**
  - A market scan and a gap analysis of specs against the implementation came first.
  - Six lens generators produced 60 proposals, which were consolidated to 45.
  - Three independent judges scored them (member advocate, pragmatic engineer, strategist), and a writer turned the result into the roadmap.

Spot-checks done by hand for this README:

- SEC-01 and SEC-02 were traced through the code.
- UX-01 was traced to `catalog/getAllBrands.ts`, and UX-03 was confirmed on the screenshot.
- Two load-bearing market claims (MySpeedPuzzling marketplace, IPDb) were checked against their sources.
- One inconsistency was corrected: the `pnpm audit` status in 01 now matches SEC-63.

## Caveats

- **Evidence is in [`evidence/`](evidence/).** It holds the screenshot tiles, per-capture metrics, axe results, the reviewers' interaction scripts and screenshots, `summary.md`, `index.json`, and the capture tools (`tools/`). Chapter 03 cites evidence by paths relative to that folder. A curated set of 29 screenshots is also in [`assets/`](assets/). Left out: the first, superseded full-page captures, which missed content inside the inner scroll region.
- **The test account has sparse data and is not an admin.**
  - Many screens were seen in their empty state; dense-data behaviour was reasoned from code and from DOM replicas, which are labelled as replicas.
  - Admin UX was reviewed from code only.
- **Load times come from an unminified dev server.** Bundle sizes come from production builds.
- **Scores are judgement, not data.** That applies to the UX scorecard and the proposal priority scores. Effort estimates assume one developer working with AI agents.
- **No load tests were run.** "Breaks at scale" claims rest on Convex's documented limits and are marked as inferred.
