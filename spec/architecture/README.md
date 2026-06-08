# JigSwap Architecture Proposal

> Status: **Proposal / RFC** — not yet adopted. No production code changes are implied by these documents.
> Author: architecture working session, 2026-06-08.

This folder proposes a refactor of JigSwap from its current **entity-driven, Convex-coupled** shape
toward a **Domain-Driven, hexagonal (ports & adapters)** architecture, with the web tier re-platformed
from Next.js onto **TanStack Start** acting as a true **Backend-for-Frontend (BFF)**.

## Why

Today (see the inventory in [`appendix-current-state.md`](./appendix-current-state.md)):

- The Convex backend is organised **per database table** (`users.ts`, `puzzles.ts`, `exchanges.ts`, …).
  Business capabilities are smeared across these files; there is no explicit domain model. This is
  *entity-driven design*: the database schema **is** the architecture.
- The React UI calls Convex's **generated API directly** (`useQuery(api.puzzles.createPuzzle, …)`),
  so every component is coupled to backend transport shapes and to Convex itself.
- **Business rules live in two uncontrolled places**: inside Convex mutations (the exchange state
  machine, availability toggling, duplicate checks, inline notification creation) and ad-hoc in the
  UI (client-side filtering, upload orchestration). There is no layer that owns invariants.
- Several domain concepts are **conflated or fragmented**: `Puzzle` (the product) vs `OwnedPuzzle`
  (a physical copy) share a file; "review" means two different things; visibility/availability is
  split across three mechanisms.

The goal is **not** to abandon Convex. Convex remains the transactional, reactive core — but it is
used **through ports and adapters** rather than called directly and immediately, and the domain logic
becomes explicit, testable, and independent of any framework.

## The four decisions that shape this proposal

1. **Domain execution host: Convex-hosted core.** The domain + application layer is a pure-TypeScript
   package imported *by* Convex functions. Convex functions become thin **adapters** that hydrate
   aggregates through repository ports (`ctx.db` is hidden behind interfaces), run domain logic, and
   persist. This preserves Convex's ACID transactions and reactivity. See
   [`02-hexagonal-architecture.md`](./02-hexagonal-architecture.md).

2. **DDD strategic design first.** We define **bounded contexts** by business capability, give each its
   own ubiquitous language and aggregates, and draw a context map with explicit relationships and
   anti-corruption layers. See [`01-bounded-contexts.md`](./01-bounded-contexts.md).

3. **TanStack Start as a true BFF.** The web tier orchestrates, authenticates, and shapes view DTOs —
   **no domain logic**. The UI never imports Convex's generated API; it goes through a gateway seam.
   See [`03-bff-tanstack-start.md`](./03-bff-tanstack-start.md).

4. **Strangler-fig migration.** We refactor one vertical slice at a time behind stable seams, never a
   big-bang rewrite. See [`04-migration-roadmap.md`](./04-migration-roadmap.md).

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 0 | [`appendix-current-state.md`](./appendix-current-state.md) | What exists today (inventory) |
| 1 | [`01-bounded-contexts.md`](./01-bounded-contexts.md) | What are the contexts, their language, aggregates, and the context map |
| 2 | [`02-hexagonal-architecture.md`](./02-hexagonal-architecture.md) | How the hexagon is laid out; ports, adapters, folders, DI, events — with Convex as adapters |
| 3 | [`03-bff-tanstack-start.md`](./03-bff-tanstack-start.md) | The TanStack Start BFF and the gateway seam |
| 4 | [`04-migration-roadmap.md`](./04-migration-roadmap.md) | Phased, low-risk path from here to there |

## Non-goals

- This is **strategy + structure**, not an implementation PR. Code shapes are illustrative.
- We do not propose changing the product scope. The feature set is taken from `spec/features/*`.
- We do not propose leaving Convex or changing the database engine.
