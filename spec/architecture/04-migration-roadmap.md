# 4. Migration Roadmap (Strangler-Fig)

The target architecture is reached **incrementally**, one vertical slice at a time, behind stable
seams. No big-bang rewrite. At every phase the app ships and stays green.

## 4.1 Principles

- **Seams before slices.** Introduce the two indirection seams (UI→gateway, mutation→use case) *first*,
  so later work happens behind them without touching callers.
- **One context at a time, richest-first.** Prove the pattern on Exchange (most invariants, clearest
  payoff), then roll the template across contexts.
- **Characterize before you refactor.** Write black-box tests against current behaviour before moving
  logic, so the refactor is provably behaviour-preserving.
- **Decouple the platform migration from the architecture migration.** The TanStack Start move rides on
  the gateway seam and can proceed largely in parallel once the seam exists.

## 4.2 Phases

### Phase 0 — Foundations & guardrails *(no behaviour change)*

- Create `@jigswap/domain` (pure TS), `@jigswap/contracts` (DTOs + zod), empty per-context folders.
- Add architecture guardrails (§2.9): Nx tags + boundaries, `dependency-cruiser`, ESLint
  `no-restricted-imports` banning `_generated/api` in `apps/web`.
- Introduce the **client gateway seam**: an `ApplicationGateway` whose adapter wraps the *current*
  Convex API 1:1. Migrate UI components to import the gateway/typed hooks instead of `_generated/api`.
  Pure indirection — zero logic change, fully shippable.
- Stand up the domain unit-test harness (Vitest, no Convex).

**Exit:** the UI no longer imports `_generated/api`; guardrails are red on violation; CI green.

### Phase 1 — Exchange vertical slice *(proves the whole pattern)*

- Model the `Exchange` aggregate + state machine + terms rules in `@jigswap/domain/exchange`. Unit-test
  exhaustively (no Convex).
- Define inbound/outbound ports (`ExchangeRepository`, `CopyAvailabilityPort`, `VisibilityPolicyPort`,
  `DomainEventPublisher`, `Clock`).
- Re-implement the Convex exchange mutations as **thin adapters** (composition root → use case), backed
  by `convexExchangeRepository` + mapper over the **existing** `exchanges` table (no schema change yet).
- Introduce `domainEvents` + the scheduler-based **dispatcher**; move the **inline notification
  creation** out of exchange mutations into a Notifications subscriber.
- Characterization tests on the old endpoints first; keep request/response contracts identical.

**Exit:** exchange behaviour identical to today, but logic is Convex-free and unit-tested; notifications
are event-driven; the pattern is documented for reuse.

### Phase 2 — Split Catalog vs Personal Library *(the core entity→DDD fix)*

- Carve `puzzles.ts` into a **Catalog** context (`PuzzleDefinition`, taxonomy, approval, barcodes) and a
  **Personal Library** context (`Copy`, `Collection`, `Wishlist`, condition, acquisition, images).
- Add the **ACL snapshot**: `Copy` references `PuzzleDefinitionId` + caches title/brand/pieces/thumb.
- Implement `CopyAvailabilityPort` for real (replace the Phase-1 stub) — reserve/release on exchange.
- Consolidate visibility/availability into a single `SharingSetting` on `Copy`, resolved through a
  `VisibilityPolicyPort` (default implementation = today's public/private; Friend Circles plugs in
  later without touching callers).
- Schema evolution is **additive + backfill**; keep old columns until cutover, then drop.

**Exit:** product vs copy are distinct contexts; availability is a policy seam; chain-of-custody is now
*possible* because `OwnershipTransferred` (Phase 1) can create new `Copy` records.

### Phase 3 — Solving & Reputation *(resolve the "review" homonym)*

- Move `completions.review/rating` into **Solving** as `PuzzleReview`; move exchange `reviews` into
  **Reputation** as `PartnerReview`. Rename in code + DTOs to kill the homonym.
- Model `Goal` in Solving with **derived** progress (subscribe to `CompletionRecorded`).
- Build the `ReputationProfile` projection from `ExchangeCompleted` + `PartnerReview`.
- Ship the previously-UI-less `goals` and personal `categories` features now that they have a home.

**Exit:** two clearly-named review concepts; goals/progress live; reputation aggregates from events.

### Phase 4 — Notifications & Insights as pure subscribers

- Notifications: `NotificationPreference` + channels (in-app now; email/push behind a `ChannelPort`).
  All notifications come from event subscriptions — no producer reaches into Notifications.
- Insights: stand up read-model projections (personal stats, trends) and `exportUserData`; recommendation
  model as a downstream projection. No write aggregates.

**Exit:** cross-cutting generic contexts are event-driven and additive; producers know nothing of them.

### Phase 5 — Re-platform web to TanStack Start *(can start once Phase 0 seam exists)*

- Scaffold the TanStack Start app; port routes group-by-group using the **same gateway** the Next UI
  already uses (the seam means components move without touching domain).
- Swap adapters: Clerk Next → `@clerk/tanstack-react-start`; `convex/react-clerk` →
  `@convex-dev/react-query` + session-aware `ConvexHttpClient`; `next-intl` → `use-intl` core (keep
  Crowdin + cookie locale); move PostHog proxy rewrites to Nitro config.
- Run both apps in parallel; cut routes over incrementally; decommission Next once at parity.

**Exit:** web tier is a true BFF on TanStack Start; no domain logic in server functions; Next.js retired.

### Phase 6 — New features land natively in their contexts

- **Friend Circles** (`Circle`, memberships, permissions) implementing the real `VisibilityPolicyPort`.
- **Chain-of-custody** UI/timeline (data already produced since Phase 2).
- **Community/Social** (profiles, follows, activity feed projection), **recommendations**, condition
  timeline, auctions — each as a context slice using the established template.

## 4.3 Sequencing at a glance

```
Phase 0  Foundations + seams ─────────────┐ (unblocks everything; UI off _generated/api)
Phase 1  Exchange slice ──────────┐        │
Phase 2  Catalog | Library split  │        │
Phase 3  Solving + Reputation     │        ├── Phase 5 TanStack Start BFF (parallel after P0)
Phase 4  Notifications + Insights ┘        │
Phase 6  Friend Circles, custody, social ──┘ (after the contexts they depend on)
```

Dependency truths: P0 precedes all. P1 establishes the template P2–P4 follow. P2 must precede
chain-of-custody UI and Friend-Circle visibility. P5 needs only P0's seam. P6 items each depend on
their owning context being modelled.

## 4.4 Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Refactor changes behaviour subtly | Med | Characterization tests **before** each slice; identical request/response contracts |
| Convex transaction semantics misunderstood inside use cases | Med | Keep each use case = one mutation; repository contract tests; no cross-mutation "transactions" |
| `next-intl` → TanStack i18n friction | Med | Dedicated spike in P5; `use-intl` core keeps message catalogs + Crowdin intact |
| Reactivity regressions on TanStack | Med | `@convex-dev/react-query` proven for live queries; port a read-heavy screen first |
| Architecture erosion over time | High (without guards) | Nx boundaries + dependency-cruiser + ESLint enforced in CI from P0 |
| Scope creep (rewriting while refactoring) | High | Strangler discipline: move logic *as-is* first; redesign features only in their own phase |
| Schema migrations on a live DB | Med | Additive columns + backfill + dual-write window, drop old columns post-cutover |

## 4.5 Definition of done (per slice)

A context slice is "done" when: aggregates + invariants are unit-tested with no Convex; Convex functions
are thin adapters with `ctx.db` confined to repositories; producers emit domain events instead of
reaching into other contexts; the UI touches it only through the gateway/contracts; guardrails pass; and
behaviour matches the pre-refactor characterization tests.
