# 2. Hexagonal Architecture (Tactical Design)

This document specifies **how** each bounded context is built as a hexagon (ports & adapters), and —
crucially — **how Convex is used as adapters rather than called directly**.

## 2.1 The core decision: a Convex-hosted domain core

The domain + application layer is a **pure-TypeScript package** (`@jigswap/domain`) with **zero**
imports of `convex`, `convex/values`, `@clerk/*`, React, or TanStack. Convex functions in
`@jigswap/backend` **import** the domain and act as adapters.

Why host the core _inside_ Convex rather than in the BFF:

- Convex mutations are **ACID transactions**. A use case that loads an aggregate, enforces invariants,
  and persists must run in one transaction — that is exactly a Convex mutation. Hosting the core in the
  BFF would split each use case across multiple Convex round-trips, each its own transaction, and we'd
  lose atomicity and have to re-implement consistency.
- Convex's **reactivity** depends on reads happening inside Convex query functions. Keeping the
  read-side there preserves live updates for free.

So: **Convex is the legitimate transactional core, and we structure it hexagonally so `ctx.db` never
leaks past a repository adapter, and the UI never imports the generated API.** That is what
"Convex as ports and adapters, rather than directly and immediately" means in practice.

## 2.2 The layers

```
        DRIVING (inbound) adapters                          DRIVEN (outbound) adapters
   ┌──────────────────────────────┐                   ┌─────────────────────────────────┐
   │ • Convex mutation/query/action│                  │ • ConvexCopyRepository (ctx.db)  │
   │   = transport adapter         │                  │ • ConvexEventPublisher (scheduler)│
   │ • Convex httpAction (webhooks)│                  │ • ClerkIdentityAdapter           │
   │ • (BFF server fn → gateway →  │                  │ • ConvexStorageAdapter           │
   │    the Convex mutation)       │                  │ • PostHogTelemetryAdapter        │
   └───────────────┬──────────────┘                   │ • Email/PushChannelAdapter       │
                   │ implements inbound ports          └────────────────┬────────────────┘
                   ▼                                    implements outbound ports ▲
        ┌────────────────────────────────────────────────────────────────┐
        │  APPLICATION LAYER  (per context)                               │
        │  • Use-case interactors (ProposeExchange, RecordCompletion, …)  │
        │  • Inbound ports  = use-case interfaces                         │
        │  • Outbound ports = repository / publisher / clock / policy IFs │
        │  • Orchestration & transaction script ONLY — no entity rules    │
        └────────────────────────────────┬───────────────────────────────┘
                                         ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  DOMAIN LAYER  (per context) — PURE                             │
        │  • Aggregates, Entities, Value Objects                          │
        │  • Invariants & the Exchange state machine                      │
        │  • Domain events, domain services, domain errors                │
        │  • No I/O, no framework, deterministic, unit-testable           │
        └────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** dependencies point **inward**. Domain knows nothing. Application knows Domain and
defines Ports. Adapters know Application/Domain and implement Ports. Convex, Clerk, PostHog, TanStack
are all _outside_ — replaceable.

## 2.3 Ports — the two kinds

**Inbound (driving) ports** = what the application offers. One interface per use case:

```ts
// @jigswap/domain/exchange/application/ports/in/propose-exchange.port.ts
export interface ProposeExchange {
  (cmd: ProposeExchangeCommand): Promise<Result<ExchangeId, ExchangeError>>;
}
```

**Outbound (driven) ports** = what the application needs from the world:

```ts
// @jigswap/domain/exchange/application/ports/out/exchange.repository.ts
export interface ExchangeRepository {
  findById(id: ExchangeId): Promise<Exchange | null>;
  save(exchange: Exchange): Promise<void>;
}

// @jigswap/domain/exchange/application/ports/out/copy-availability.port.ts
// (the seam to Personal Library — Exchange depends on the INTERFACE, not Library's tables)
export interface CopyAvailabilityPort {
  isAvailable(copyId: CopyId): Promise<boolean>;
  reserve(copyId: CopyId, exchangeId: ExchangeId): Promise<void>;
  release(copyId: CopyId): Promise<void>;
}

// @jigswap/domain/shared-kernel/ports/out/domain-event-publisher.ts
export interface DomainEventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

// @jigswap/domain/shared-kernel/ports/out/clock.ts
export interface Clock {
  now(): Date;
}
```

## 2.4 A use case (application layer) — pure orchestration

```ts
// @jigswap/domain/exchange/application/use-cases/propose-exchange.ts
export const makeProposeExchange =
  (deps: {
    exchanges: ExchangeRepository;
    copies: CopyAvailabilityPort;
    visibility: VisibilityPolicyPort;
    events: DomainEventPublisher;
    clock: Clock;
  }): ProposeExchange =>
  async (cmd) => {
    if (
      !(await deps.visibility.canTransact(cmd.recipientId, cmd.requestedCopyId))
    )
      return err(ExchangeError.NotVisibleToRecipient);

    if (!(await deps.copies.isAvailable(cmd.requestedCopyId)))
      return err(ExchangeError.CopyUnavailable);

    // ── all the RULES live in the aggregate, not here ──
    const exchange = Exchange.propose({
      kind: cmd.kind,
      initiator: cmd.initiatorId,
      recipient: cmd.recipientId,
      offeredCopyId: cmd.offeredCopyId,
      requestedCopyId: cmd.requestedCopyId,
      terms: cmd.terms,
      now: deps.clock.now(),
    }); // throws/returns Result on invalid terms (e.g. loan without returnDate)

    await deps.copies.reserve(cmd.requestedCopyId, exchange.id);
    await deps.exchanges.save(exchange);
    await deps.events.publish(exchange.pullEvents()); // ExchangeProposed
    return ok(exchange.id);
  };
```

Note: the use case is a **transaction script** — it sequences ports and the aggregate. It contains
**no entity rules**. The rules (legal transitions, term validity, dual-confirmation) live in `Exchange`.

## 2.5 The aggregate (domain layer) — pure, owns invariants

```ts
// @jigswap/domain/exchange/domain/exchange.ts
export class Exchange {
  private events: DomainEvent[] = [];
  private constructor(private state: ExchangeState) {}

  static propose(p: ProposeProps): Exchange {
    if (p.kind === "lend" && !p.terms.returnDate)
      throw new DomainError("loan needs return date");
    if (p.kind === "trade" && p.terms.price == null)
      throw new DomainError("sale needs price");
    const e = new Exchange({ status: "proposed", ...p, createdAt: p.now });
    e.record(new ExchangeProposed(e.id, p.initiator, p.recipient));
    return e;
  }

  accept(by: MemberId, now: Date) {
    this.assertTransition("accepted"); // state-machine invariant
    this.assertParty(by, "recipient");
    this.state = { ...this.state, status: "accepted", acceptedAt: now };
    this.record(new ExchangeAccepted(this.id));
  }

  confirmCompletion(by: MemberId, now: Date) {
    this.assertTransition("completed");
    this.markConfirmed(by, now);
    if (this.bothConfirmed()) {
      // dual-confirmation invariant
      this.state = { ...this.state, status: "completed", completedAt: now };
      this.record(new ExchangeCompleted(this.id));
      this.record(
        new OwnershipTransferred(this.requestedCopyId, this.recipient),
      ); // → Library reacts
    }
  }
  // assertTransition / assertParty / pullEvents / record …
}
```

This file has **no Convex import**. It is unit-testable in milliseconds with no database — which is the
entire point and is impossible against today's inline-in-mutation logic.

## 2.6 Convex as adapters

### Driven adapter: repository over `ctx.db`

```ts
// @jigswap/backend/convex/exchange/adapters/convex-exchange.repository.ts
import type { MutationCtx } from "../../_generated/server";
import type { ExchangeRepository } from "@jigswap/domain/exchange/application/ports/out/exchange.repository";
import { toDomain, toRow } from "./exchange.mapper";

export const convexExchangeRepository = (
  ctx: MutationCtx,
): ExchangeRepository => ({
  async findById(id) {
    const row = await ctx.db.get(id as Id<"exchanges">);
    return row ? toDomain(row) : null;
  },
  async save(exchange) {
    const row = toRow(exchange);
    const existing = await ctx.db.get(exchange.id as Id<"exchanges">);
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("exchanges", row);
  },
});
```

`ctx.db` appears **only** in adapters. The mapper (`toDomain`/`toRow`) is the ACL between the storage
row shape and the aggregate — schema changes don't ripple into the domain.

### Driven adapter: event publisher via the Convex scheduler (decoupling)

```ts
// @jigswap/backend/convex/_shared/convex-event-publisher.ts
export const convexEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher => ({
  async publish(events) {
    for (const e of events) {
      await ctx.db.insert("domainEvents", serialize(e)); // durable log (optional)
      await ctx.scheduler.runAfter(0, internal.dispatch.handle, {
        event: serialize(e),
      });
    }
  },
});
```

This is how the **inline notification creation goes away**: the exchange mutation publishes
`ExchangeCompleted`; a scheduled dispatcher fans it out to the Notifications, Reputation, and Library
subscribers. Each subscriber is its own Convex internal mutation = inbound adapter for that context.

### Driving adapter: the Convex mutation = composition root + transport

```ts
// @jigswap/backend/convex/exchange/propose.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { makeProposeExchange } from "@jigswap/domain/exchange/application/use-cases/propose-exchange";
import { convexExchangeRepository } from "./adapters/convex-exchange.repository";
import { convexCopyAvailability } from "../library/adapters/convex-copy-availability.adapter";
import { convexVisibilityPolicy } from "../friend-circles/adapters/convex-visibility.adapter";
import { convexEventPublisher } from "../_shared/convex-event-publisher";
import { systemClock } from "../_shared/clock";
import { requireMember } from "../identity/require-member"; // ACL over ctx.auth → MemberId

export const propose = mutation({
  args: {
    kind: v.string(),
    offeredCopyId: v.optional(v.id("ownedPuzzles")),
    requestedCopyId: v.id("ownedPuzzles"),
    terms: v.any() /* zod-validated in BFF */,
  },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx); // identity ACL
    const proposeExchange = makeProposeExchange({
      // ← wire ports to Convex adapters (DI)
      exchanges: convexExchangeRepository(ctx),
      copies: convexCopyAvailability(ctx),
      visibility: convexVisibilityPolicy(ctx),
      events: convexEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await proposeExchange({ initiatorId: me.id, ...args });
    if (result.isErr) throw new ConvexError(result.error); // map domain error → transport
    return { exchangeId: result.value };
  },
});
```

The Convex function is now **thin**: authenticate → wire adapters → call use case → map result. All
behaviour is in the (testable, Convex-free) domain/application layers. This _is_ "Convex as ports and
adapters."

### Cross-context port wiring (in-process)

`CopyAvailabilityPort` is **Exchange's** port; its adapter is implemented with **Library's** Convex
access (`convexCopyAvailability(ctx)` lives in the library folder and reads/locks `ownedPuzzles`). This
keeps the two contexts decoupled at the type level (Exchange depends on an interface) while still
running in a single Convex transaction. The adapter is the seam — later the implementation could call
another deployment without changing Exchange.

## 2.7 The read side (queries) and reactivity

Reads use the same hexagon but optimised for the reactive read model:

- A Convex **query** is a driving adapter that calls a **read-model port** (`ExchangeReadModel`) whose
  adapter reads `ctx.db` and returns **view DTOs** from `@jigswap/contracts` — never aggregates, never
  raw rows.
- Because the read still executes in a Convex query, **live subscriptions keep working**. The UI
  subscribes through the gateway (next document), not through `_generated/api`.

```ts
// @jigswap/backend/convex/exchange/queries.ts
export const myExchanges = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    return convexExchangeReadModel(ctx).listFor(me.id); // → ExchangeSummaryDTO[] from @jigswap/contracts
  },
});
```

## 2.8 Proposed package & folder layout

```
packages/
  domain/                         @jigswap/domain   — PURE TS, no convex/clerk/react/tanstack
    src/
      shared-kernel/              Id<T>, Result, DomainEvent, DomainError, Clock, Money, ports/out/*
      catalog/        { domain/ , application/{use-cases, ports/in, ports/out} }
      library/        { domain/ , application/… }
      solving/        { … }
      exchange/       { … }
      reputation/     { … }
      sharing/        { … }       (friend circles + VisibilityPolicy)
      conversation/   { … }
      social/         { … }
      identity/       { … }
      notifications/  { … }
      insights/       { … }       (read-model contracts only)
  contracts/                      @jigswap/contracts — DTOs + zod schemas (published language, BFF↔backend)
  backend/                        @jigswap/backend  — Convex = ADAPTERS
    convex/
      _shared/        clock, event publisher, dispatcher, di helpers
      _generated/
      schema.ts
      catalog/        { propose.ts, queries.ts, adapters/ , mapper.ts }
      library/        { …, adapters/convex-copy-availability.adapter.ts }
      exchange/       { propose.ts, accept.ts, complete.ts, queries.ts, adapters/, mapper.ts }
      …               (one folder per context, mirroring domain)
      dispatch.ts     event fan-out to subscribers
      http.ts         webhooks (identity)
apps/
  web/                            @jigswap/web — TanStack Start BFF + UI (no domain logic)
```

**Mirroring** `packages/domain/<context>` ↔ `packages/backend/convex/<context>` makes the hexagon
legible: domain on one side, its Convex adapters on the other.

## 2.9 Enforcing the architecture (so it doesn't rot)

These are guardrails, not suggestions — add them in Phase 0:

- **Nx module boundaries** (`@nx/enforce-module-boundaries`) with tags:
  `type:domain` may depend on `type:domain` only; `type:backend-adapter` may depend on `type:domain` +
  `type:contracts`; `type:web-bff` may depend on `type:contracts` only (never `type:domain`,
  never `_generated`).
- **`dependency-cruiser`** rule: forbid any import of `convex`, `convex/values`, `@clerk/*`, `react`
  from `packages/domain/**`.
- **ESLint `no-restricted-imports`** in `apps/web/**`: ban `@jigswap/backend/convex/_generated/api`
  (the UI must use the gateway).
- **Domain unit tests** run with **no Convex** (Vitest, already in the stack) — fast, the regression net
  that makes the refactor safe.
- **Repository contract tests**: one shared test suite each adapter must satisfy (in-memory fake +
  Convex adapter), guaranteeing ports behave identically.

## 2.10 What this buys us

- Invariants (the exchange state machine, dual confirmation, copy reservation, 24h edit window, goal
  derivation) live in one **testable** place instead of scattered through mutations and the UI.
- Convex becomes **replaceable at the adapter line** and, more importantly, **invisible to the UI**.
- Chain-of-custody, friend-circle visibility, and event-driven notifications — all documented but
  unbuilt — drop out of the model naturally instead of being bolted onto CRUD.
