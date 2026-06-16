# JigSwap Developer Guide

A guide for contributors and developers working on **JigSwap** — a personal puzzle library
and exchange platform. This document covers the architecture, local setup, the end-to-end
request/data flow, project conventions, and concrete "how to" recipes for the most common
extension tasks.

> **Read the specs.** This guide is a map; the source of truth for intent is `spec/`.
> Start with [`spec/architecture/README.md`](../spec/architecture/README.md) and read the
> four numbered documents in order. Product intent lives in [`spec/features/`](../spec/features).
> For contribution mechanics (PR workflow, commit style, code of conduct) see
> [`CONTRIBUTING.md`](../CONTRIBUTING.md).

> **A note on the README.** The root `README.md` predates the current architecture and
> describes a Next.js + Turbopack web app served on port 3000. **That is stale.** The web app
> has been migrated to **TanStack Start** (Vite + Nitro). Verify framework details against the
> code, not the README. This guide reflects the current state.

---

## 1. Architecture overview

JigSwap is a **pnpm + Nx monorepo** organized around a strict **hexagonal (ports-and-adapters),
Domain-Driven Design** core. The architecture is the product of a deliberate refactor away from
an entity-driven, Convex-coupled shape; see
[`spec/architecture/01-bounded-contexts.md`](../spec/architecture/01-bounded-contexts.md) and
[`02-hexagonal-architecture.md`](../spec/architecture/02-hexagonal-architecture.md).

### 1.1 Monorepo layout

```
jigswap/
├── apps/
│   └── web/                    # TanStack Start web app (Vite + Nitro)
├── packages/
│   ├── domain/                 # @jigswap/domain — pure DDD core, zero I/O
│   ├── contracts/              # @jigswap/contracts — shared view DTOs + Zod schemas
│   ├── gateway/                # @jigswap/gateway — the single seam onto the Convex API
│   └── backend/
│       └── convex/             # @jigswap/backend — Convex functions, grouped by context
├── spec/                       # Architecture + feature specifications
├── nx.json                     # Nx workspace config
├── pnpm-workspace.yaml         # pnpm workspace (apps/*, packages/*)
└── package.json                # Root scripts
```

**Nx** orchestrates per-project targets (`dev`, `build`, `lint`, `type-check`, `test`) and
caches results. **pnpm** is the package manager (workspace protocol `workspace:^` links the
internal packages). Run `pnpm graph` to view the dependency graph.

### 1.2 The four tiers and the dependency rule

Data and types flow through four tiers. **Dependencies point inward** — the domain knows
nothing about anything outside it.

```
  apps/web  ──depends on──▶  @jigswap/gateway  ──passes through──▶  @jigswap/backend (Convex)
   (UI)                       (transport seam)                       (composition roots / adapters)
                                                                              │
                                                                  imports & invokes
                                                                              ▼
                                                                     @jigswap/domain
                                                                  (pure aggregates + use cases)

  @jigswap/contracts  ◀── declared as return types by ── Convex handlers
       (shared view DTOs; structurally checked by tsc against handler return types)
```

- **`@jigswap/domain`** — pure TypeScript. **Zero** imports of `convex`, `convex/values`,
  `@clerk/*`, React, or TanStack. Holds aggregates, value objects, domain events, use-case
  interactors, and port _interfaces_. This is where invariants live.
- **`@jigswap/backend` (Convex)** — the legitimate **transactional core**. Convex functions are
  thin **adapters** (composition roots): they authenticate, wire driven adapters from `ctx`, call
  a domain use case, and map the `Result` to a `ConvexError`. `ctx.db` never leaks past a
  repository adapter. Convex is hosted as the core (not the BFF) because Convex mutations are ACID
  transactions and Convex reactivity depends on reads happening inside Convex query functions.
- **`@jigswap/contracts`** — the shared type boundary between all tiers. Plain TS view DTOs plus a
  few Zod schemas, organized by bounded context. Zero runtime deps except `zod`; no Convex imports.
  IDs flow as plain `string` (`DocId`).
- **`@jigswap/gateway`** — a three-file package (`index.ts`, `types.ts`, `operations.ts`) that is
  the **single place** in the monorepo allowed to import `@jigswap/backend/.../_generated/api`. The
  `gateway` const maps every UI-callable operation, grouped by context namespace, to its Convex
  `api.*.*` reference, passing it through unchanged so Convex reactivity and arg typing are
  preserved.
- **`apps/web`** — TanStack Start. Orchestrates, authenticates, and renders. **No domain logic.**
  Calls `useQuery`/`useMutation`/`useAction` (from `convex/react`) against `gateway.*` references.
  It depends on `@jigswap/gateway` (and transitively `@jigswap/backend`) but **not** on
  `@jigswap/contracts` directly — it derives view types via
  `FunctionReturnType<typeof gateway.some.operation>`.

> **Why the indirection?** This is Phase 1 of the BFF roadmap
> ([`03-bff-tanstack-start.md`](../spec/architecture/03-bff-tanstack-start.md)). The gateway
> centralizes the import so a future `ApplicationGateway` interface/adapter split can swap
> transports without touching UI call sites.

### 1.3 Bounded contexts

The domain (`packages/domain/src/`) is split into **twelve bounded contexts plus a
shared-kernel**, each in its own folder with the same internal structure:

```
packages/domain/src/{context}/
├── domain/          # aggregates, value objects, domain events, ids, errors  (NO imports from application/)
├── application/
│   ├── use-cases/   # makeXxx(deps) => async (cmd) => Result  factory functions
│   ├── ports/in/    # inbound ports (use-case command interfaces)
│   ├── ports/out/   # outbound ports (repository / publisher / clock / policy interfaces)
│   └── testing/     # in-memory test doubles (repos, recording publishers, fixed clocks)
└── index.ts         # re-exports domain + application
```

**Core transactional contexts** (own aggregates with state machines, emit/consume events):
`catalog`, `library`, `exchange`, `conversation`, `identity`.

**Supporting contexts** (derived aggregates reacting to events, or pure projections):
`reputation`, `social`, `sharing`, `solving`, `notifications`, `insights`. The `insights`
context has **no aggregates and no ports** — it is pure projection functions over plain DTOs.

The **`shared-kernel`** provides the primitives every context depends on:

- `result.ts` — the discriminated-union `Result<T,E>` with `ok`/`err` constructors and
  `isOk`/`isErr` guards. Every fallible operation returns this; errors propagate as values, never
  thrown.
- `identifier.ts` + `branded-ids.ts` — branded `Id<TBrand>` (a `string` at runtime, distinct at
  the type level) and centralized typed constructors (`toMemberId`, `toCopyId`, …). Always use the
  constructors, never bare casts.
- `domain-event.ts`, `domain-event-publisher.ts`, `clock.ts`, `domain-error.ts`.

**Cross-context rule:** no context imports another's domain types. Cross-context data crosses
through explicit **outbound ports** (anti-corruption layers), e.g. Library reads Catalog through
`CatalogSnapshotProvider` (returning a denormalized `CatalogSnapshot` VO), and Exchange reads
Library through `CopyPort` (returning a plain `CopyView`).

### 1.4 Aggregate lifecycle (uniform contract)

Every aggregate implements the same four-part contract — **preserve this when adding methods**:

1. A **static factory** (`submit`/`register`/`propose`/`acquire`/`open`) that validates from its
   own data only and records the first domain event. Returns `Result<Aggregate, Error>`.
2. **Mutating methods** that guard invariants and record further events. Return `Result<void, Error>`.
3. **`pullEvents(): readonly DomainEvent[]`** — drains and clears the event buffer so the use case
   can publish after save without double-emitting.
4. **`static rehydrate(state)` + `toState()`** — map to/from a plain persistable interface with no
   storage knowledge.

Cross-aggregate facts (uniqueness, availability, party identity) are **application-layer concerns**
enforced via outbound ports, never inside an aggregate.

### 1.5 The Convex backend

`packages/backend/convex/` mirrors the domain contexts. The `schema.ts` declares ~27 tables. Key
patterns:

- **Auth** is always server-side: `identity/requireMember.ts` reads `ctx.auth.getUserIdentity()`
  and resolves the `clerkId` to a `users` row. The Convex `_id` **is** the `MemberId`. **Never
  accept a `userId` from client args.**
- **Composition root pattern:** authenticate → build adapters from `ctx` → call
  `make<UseCase>({…adapters})` → invoke → `if (result.isErr) throw toConvexError(...)`.
- **Dual identity:** every DDD-aggregate table carries an `aggregateId` (UUID, domain identity)
  beside the Convex `_id` (transport identity). Repositories key reads on the `by_aggregate_id`
  index; child tables store the Convex `_id` as FK. Legacy rows predating the migration lack
  `aggregateId` and fall back to the raw `_id`.
- **Domain events** are durably decoupled. `events/makeEventPublisher.ts` (1) runs critical
  synchronous reactions in the same transaction (e.g. marking a transferred copy unavailable,
  recomputing goal progress), then (2) appends each event to the `domainEvents` table and schedules
  `events/dispatch.ts` via `ctx.scheduler.runAfter(0)`. The dispatcher fans events to async
  subscribers (Notifications, Custody, Library transfer, Library loan) and stamps `processedAt`
  only after all succeed — at-least-once delivery with Convex's automatic retry on rollback.

### 1.6 The TanStack Start web app

`apps/web/src/` is a fully SSR React app on TanStack Start (Vite + Nitro), file-based routing via
TanStack Router. See [`03-bff-tanstack-start.md`](../spec/architecture/03-bff-tanstack-start.md).

- **Routing:** files under `apps/web/src/routes/`. Pathless layouts use underscore-prefixed
  directories: `_dashboard` (authenticated console shell), `_public` (marketing chrome). The route
  tree is auto-generated as `routeTree.gen.ts` — **never edit it manually** (the dev server
  regenerates it; it is also a known source of `tsc` noise).
- **Auth:** `__root.tsx` runs `fetchClerkAuth` (a `createServerFn`) on every SSR request and seeds
  a module-level `clientAuthCache` for client navigation. `_dashboard/route.tsx` calls
  `requireAuth` in `beforeLoad` (reads `userId` off context — no server call). `/admin` uses
  `requireAdmin`, which **does** make a server call to read Clerk `sessionClaims.metadata.role`.
- **Data fetching:** all Convex interaction is `useQuery`/`useMutation`/`useAction` from
  `convex/react` against `gateway.*` (imported via the `@/gateway` shim at
  `apps/web/src/gateway/index.ts`). There is **no intermediate HTTP BFF layer on the critical path
  for UI data.** SSR uses the Convex HTTP client pre-authed with the Clerk JWT.
- **i18n:** `use-intl` (not next-intl, despite the README). Messages live in
  `apps/web/locales/source.json` (dev) and `locales/{en,nl}.json` (prod). Locale detection is
  cookie → `Accept-Language` → default `en`. See `apps/web/src/lib/i18n.ts`.
- **Migration compat shims** (`apps/web/src/compat/`): `clerk.tsx` adds `SignedIn`/`SignedOut`;
  `link.tsx` maps `href` → TanStack `to`; `navigation.ts` maps `next/navigation` hooks. **Do not
  use Next.js APIs directly** (`next/image`, `next/font`, `next/headers`, `next/navigation`) — go
  through the shims.
- **Theme:** Tailwind 4 (CSS-based config, no `tailwind.config.js`); custom tokens in
  `globals.css`. Dark mode via `next-themes` `class` strategy.

---

## 2. Local setup & key scripts

### 2.1 Prerequisites

- **Node.js** — version is pinned by `.nvmrc` (run `nvm use`).
- **pnpm** — see `packageManager` in the root `package.json` (Corepack will use the pinned version).
- **Git**.

### 2.2 First-time setup

```bash
git clone https://github.com/SanderVerkuil/jigswap.git
cd jigswap
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then fill in values
```

Required env vars in `apps/web/.env.local`:

```env
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_FRONTEND_API_URL=https://your-clerk-frontend.clerk.accounts.dev
# Optional: Crowdin
CROWDIN_PROJECT_ID=...
CROWDIN_API_TOKEN=...
NEXT_PUBLIC_CROWDIN_DISTRIBUTION_HASH=...
```

`auth.config.ts` on the backend registers Clerk as the Convex auth provider via
`NEXT_PUBLIC_CLERK_FRONTEND_API_URL`.

### 2.3 Running

Two processes, two terminals:

```bash
# Terminal 1 — Convex backend (watches packages/backend/convex/, regenerates _generated/)
cd packages/backend && pnpm convex:dev

# Terminal 2 — web app (Vite dev server)
pnpm dev          # = nx dev web  (runs `vite dev` for apps/web)
```

> The dev server runs on **`http://localhost:3001`** in this environment (not 3000 as the README
> states). Browser-based verification with Playwright is not available here (no Chrome), but the
> dev server itself runs fine.

### 2.4 Key scripts

Root (`package.json`), all via Nx:

| Script                              | Purpose                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`                          | `nx dev web` — start the web app                                                       |
| `pnpm build`                        | build all projects                                                                     |
| `pnpm lint` / `pnpm lint:fix`       | ESLint across all projects                                                             |
| `pnpm type-check`                   | `tsc --noEmit` across all projects                                                     |
| `pnpm test`                         | run all project tests (Vitest)                                                         |
| `pnpm format` / `pnpm format:check` | Prettier write / check (CI runs `format:check`)                                        |
| `pnpm graph`                        | open the Nx dependency graph                                                           |
| `pnpm affected`                     | run targets only on affected projects                                                  |
| `pnpm arch:check`                   | dependency-cruiser — enforces the hexagonal dependency rule over `packages/domain/src` |
| `pnpm mutation:domain`              | Stryker mutation testing for the domain package                                        |

Backend (`packages/backend`): `pnpm convex:dev`, `pnpm convex:deploy`, `pnpm type-check`.

Web (`apps/web`): `pnpm dev` (`vite dev`), `pnpm build`, `pnpm start`, `pnpm type-check`,
`pnpm test`.

---

## 3. Request / data flow, end to end

### 3.1 SSR auth + i18n bootstrap

Browser request → Nitro server → `__root.tsx` `beforeLoad` (SSR) runs `fetchClerkAuth`
(`createServerFn`, reads the Clerk session via `clerkMiddleware` registered in `start.ts`) and
`getIntlCached` (reads the `jigswap-intl` cookie / `Accept-Language`, loads JSON messages) → the
root context `{ userId, token, intl }` is dehydrated into the HTML → `ConvexProviderWithClerk` and
`IntlProvider` hydrate from the dehydrated context on the client.

On client-side navigation, `beforeLoad` checks the module-level `clientAuthCache` and returns
immediately on a hit (no server round-trip). `requireAuth` reads `userId` off context;
`requireAdmin` is the only per-navigation server call in the app.

### 3.2 A reactive query (the common path)

```
Component: useQuery(gateway.library.getCopyInstanceView, { copyId })
  └─▶ gateway.library.getCopyInstanceView === api.library.getCopyInstanceView.getCopyInstanceView
        └─▶ Convex runtime invokes the handler in packages/backend/convex/library/getCopyInstanceView.ts
              ├─ requireMember(ctx)                          (auth gate)
              ├─ fetch ownedPuzzles / custody / completions / loans rows
              ├─ projectMemberIdentity(...) per participant  (privacy chokepoint, salted by copyId)
              └─ assemble CopyInstanceView  (typed in packages/contracts/src/library/views.ts)
        ◀── result delivered reactively over the Convex WebSocket
  ◀── UI derives its local type via FunctionReturnType<typeof gateway.library.getCopyInstanceView>
```

`useQuery` is `undefined` while loading and `null` when the record does not exist — **guard both
explicitly** (`undefined` → skeleton, `null` → empty/not-found, data → render).

### 3.3 A mutation (with domain events)

Example — exchange proposal through settlement:

```
useMutation(gateway.exchange.propose)(...)
  → Convex mutation exchange/propose.ts: requireMember → CopyPort availability check
    → makeProposeExchange creates the Exchange aggregate → repository.save() inserts the row
    → inProcessEventPublisher publishes ExchangeProposed → recordAndSchedule appends a
      domainEvents row + schedules dispatch
  → dispatch (async internalMutation): notifications/subscriber translates ExchangeProposed →
    trade_request notification for the recipient → inAppChannel persists to the notifications table
  → any dependent useQuery subscriptions refresh automatically (no manual refetch)

… recipient accepts, both confirm …
  → confirmCompletion detects dual confirmation → emits ExchangeCompleted + OwnershipTransferred
    → SYNC handler marks the copy unavailable in the same transaction
    → dispatch order: custody subscriber inserts the provenance row (capturing the PRE-transfer
      owner) BEFORE library/transferOnSettlement reassigns the owner; then notifications fire
```

For a `lend` kind, settlement emits `PossessionTransferred`; `library/openLoanOnSettlement.ts`
opens a `Loan` and moves `heldBy` to the borrower (ownership never moves).

### 3.4 Image upload (Convex Storage)

`generateUploadUrl` mutation → one-time signed URL → `POST` the `File` blob to that URL via
`fetch` → read `storageId` from the response → pass `storageId` to the domain mutation
(`createOwned`, `addCopyPhoto`, …). The next read resolves the storage URL.

### 3.5 i18n language switch

`LanguageSwitcher` → `setLocale` POST server fn sets the `jigswap-intl` cookie → `clearIntlCache()`
→ `router.invalidate()` re-runs `__root` `beforeLoad` → `getIntlCached` loads the new messages →
`IntlProvider` re-renders → Clerk re-localizes.

---

## 4. Conventions

### 4.1 Hexagonal discipline (enforced)

- `domain/` imports nothing from `application/` or any adapter. `application/` imports `domain/`
  and defines ports — **no** Convex/Clerk/DB imports. A violation is a defect; `pnpm arch:check`
  (dependency-cruiser) guards it.
- All fallible operations return `Result<T,E>`; never throw across the use-case boundary.
- Use branded ID constructors from `branded-ids.ts`, never bare `as` casts.
- Owner-only field stripping in mappers is **opt-out**: `toOwnedCopyView` etc. omit
  `notes`/`acquisitionPrice`/etc. unless `opts.includeOwnerOnly === true`. Pass that flag only
  after establishing `viewer === owner`. This is a security invariant.
- The privacy chokepoint (`social/privacy.ts` `projectMemberIdentity`) is the only place that
  decides reveal-vs-anonymize, and it runs server-side.

### 4.2 Testing

Per the project's conventions (and team memory):

- **Domain unit tests:** `*.spec.ts` co-located in each bounded context under
  `packages/domain/src/`. Pure, in-memory, using the test doubles in each context's
  `application/testing/` folder. Never hit Convex.
- **Backend integration tests:** `*.test.ts` at the `packages/backend/convex/` root level.
- **Web tests** (if any): `*.test.ts` under `apps/web/src/`.
- Mapper functions are pure and unit-testable — storage URLs are passed in pre-resolved, not
  fetched inside the mapper.
- Mutation testing for the domain: `pnpm mutation:domain` (Stryker).
- `routeTree.gen.ts` produces `tsc` noise; this is a known issue and can be ignored.

Run with `pnpm test` (all) or `nx test <project>` / `nx test web` for one.

### 4.3 Prettier & lint

**CI runs `format:check` first.** Always format changed files before committing
(`pnpm format` or `pnpm lint:fix`). ESLint config lives in the repo; Prettier uses
`prettier-plugin-organize-imports`.

### 4.4 Commit & PR style

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>` —
types `feat`, `fix`, `docs`, `style`, `refactor`, `chore`. Branch with a descriptive name
(`feat/add-puzzle-search`). Run `pnpm lint:fix` and ensure `pnpm format:check` passes before
committing. Full workflow and the Code of Conduct are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## 5. How-to recipes

### 5.1 Add a new feature, end to end

A feature usually touches all four tiers. Work **inside-out** (domain first):

1. **Domain** (`packages/domain/src/{context}/`): add/extend the aggregate method (record an
   event, return `Result<void, Error>`), add the event class to `domain/events.ts` and its union,
   add value objects as needed. Write the `.spec.ts` using in-memory doubles.
2. **Application:** define the inbound port in `application/ports/in/`, write the use-case factory
   `makeXxx(deps) => async (cmd) => Result` in `application/use-cases/`, add any new outbound port
   to `application/ports/out/`. Export from the respective `index.ts`.
3. **Contracts** (`packages/contracts/src/{context}/views.ts`): add the view DTO the UI will
   render (plain TS, `DocId` for ids, extend `ConvexSystemFields` for persisted rows, use
   `ProjectedMember` for privacy-gated identities). Export from the context `index.ts`.
4. **Backend** (`packages/backend/convex/{context}/`): write the composition-root function
   (`requireMember` → wire adapters from `ctx` → call the use case → `toConvexError` on err),
   declaring its return type as the contracts interface. Add a mapper if needed. Add the
   `*.test.ts` integration test. Regenerate codegen (§5.4).
5. **Gateway** (`packages/gateway/src/operations.ts`): add the operation to the context namespace:
   `gateway.{context}.{name}: api.{context}.{file}.{exportName}`.
6. **Web** (`apps/web/src/`): build the route/component, call `useQuery`/`useMutation` against
   `gateway.{context}.{name}`, derive the type via `FunctionReturnType`. Add i18n keys. Wire route
   metadata (§5.6).

### 5.2 Add a bounded context

**Domain** — create `packages/domain/src/{context}/` with the standard layout
(`domain/{aggregate,ids,events,errors,value-objects,index.ts}`,
`application/{use-cases,ports/in,ports/out,testing,index.ts}`, and a top-level `index.ts`
re-exporting both). Register cross-context branded IDs in `shared-kernel/branded-ids.ts`. Keep the
domain layer free of imports from other contexts (use outbound ports). Follow the existing
test-double pattern.

**Contracts** — `packages/contracts/src/{context}/views.ts` + `index.ts`, then add
`export * from './{context}'` to `packages/contracts/src/index.ts`.

**Backend** — create `packages/backend/convex/{context}/` with an `adapters/` subfolder
implementing the domain port interfaces, an `inProcessEventPublisher.ts` (via `makeEventPublisher`
with the context name + any sync handlers), and the public query/mutation composition roots. Add
tables to `schema.ts` if needed (§5.4). Register async event handling in `events/dispatch.ts` if
the context subscribes to events.

**Gateway** — add a new namespace block to the `gateway` const in
`packages/gateway/src/operations.ts`.

### 5.3 Add a contract + gateway operation

1. Add or extend the DTO in `packages/contracts/src/{context}/views.ts` and export it from the
   context `index.ts`. No build step — the package points directly at `src/` TypeScript files.
2. (Optional, for future BFF input validation) add a Zod schema following
   `packages/contracts/src/shared/pagination.ts`, per
   [`03-bff-tanstack-start.md` §3.3](../spec/architecture/03-bff-tanstack-start.md).
3. Write the Convex handler with its return type declared as the contracts interface (§5.4).
4. Regenerate codegen (§5.4).
5. Add the gateway entry: `gateway.{context}.{name}: api.{context}.{file}.{exportName}` in
   `packages/gateway/src/operations.ts`.
6. In the UI: `useQuery(gateway.{context}.{name}, args)` / `useMutation(...)`.

> New operations should follow the domain-module pattern
> `api.context.functionFile.exportName`. A few legacy entries
> (`api.puzzles.generateUploadUrl`, `api.users.updateUserProfile`,
> `api.exchanges.sendExchangeMessage`) predate the bounded-context structure — don't copy them.

### 5.4 Add a Convex function / table (codegen workflow)

**Add a function:** create a `.ts` file in the context folder
(e.g. `packages/backend/convex/library/pinCopy.ts`). Use `query()` for user-facing reads,
`mutation()` for writes, `internalMutation()` for background reactions, `httpAction()` for
webhooks. First line of any protected function: `requireMember(ctx)`. Export it as a named export
matching the filename.

**Add a table:** add the `defineTable(...)` to `schema.ts`. Every domain-aggregate table must
include `aggregateId: v.optional(v.string())` and `.index('by_aggregate_id', ['aggregateId'])`.
Add an `adapters/` repository implementing the domain port (`find`/`save`/`remove`, keyed on
`by_aggregate_id`, upsert by checking for an existing row), plus a mapper between the Convex `Doc`
shape and the aggregate state.

**Codegen workflow:**

- Normally: run `pnpm convex:dev` (or `npx convex codegen`) in `packages/backend` to regenerate
  `_generated/api.js` and `_generated/dataModel.d.ts`. The function is then callable as
  `api.{context}.{file}.{export}`.
- **In a worktree without a deployment** (per team memory): hand-edit
  `packages/backend/convex/_generated/api.d.ts` to add the new function signature. The gateway
  re-exports from `_generated`, so any new Convex function needs a corresponding gateway export
  (§5.3) before the web app can call it.

**Error mapping:** domain errors carry a stable `.code`; the `toConvexError` helper in each
context's `errors.ts` maps them to `ConvexError<{code, message}>`; the UI branches on `code`.

### 5.5 Add a domain event subscriber

Add a `handleDomainEvent(ctx, event)` function in your subscriber file
(e.g. `insights/subscriber.ts`). Import and call it inside the `dispatch` internalMutation in
`events/dispatch.ts`, after existing subscribers. The event is already in `domainEvents` when
`dispatch` runs; `processedAt` is stamped only after all subscribers succeed. **Order matters** for
`OwnershipTransferred` (custody before library transfer). The Notifications subscriber must use a
**no-op event publisher** for its own events to avoid infinite recursion. To start reacting to an
event a context already emits, replace `noopEventPublisher(ctx)` with the real `makeEventPublisher`
and add the event name to the relevant subscriber `switch`.

### 5.6 Add a web route / component

**Dashboard (authenticated) page:**

1. Create `apps/web/src/routes/_dashboard/my-new-page.tsx` with
   `createFileRoute('/_dashboard/my-new-page')({...})`.
2. Add a `ROUTE_META` entry in `apps/web/src/components/dashboard-layout/route-meta.ts`:
   `{ pageKey: 'myNewPage', group: 'library' | 'community' }`. Optionally add a `ShellNavItem`
   to a `NAV_GROUPS` array to surface it in the sidebar.
3. Add `shell.pages.myNewPage.title/.subtitle/.description` keys to `locales/source.json` (and
   `en.json`, `nl.json`). Optionally add `titles.myNewPage` for the browser `<title>`.

The shell `PageHead`, breadcrumbs, sidebar highlight, and command-palette entry all derive from
`ROUTE_META` automatically. **No shell component edits required.** To add a primary action / count
badge / dynamic title, call `usePageHeaderActions(render, deps)` or `usePageHeader(factory, deps)`
from `page-header-slot.tsx` — **do not render a duplicate `<h1>` or action in the page body.**

**Public marketing page:** create `apps/web/src/routes/_public/my-page.tsx`; the `_public` layout
(`MarketingHeader` + `MarketingFooter`) wraps it automatically. Add a `marketing.titles.myPage`
key.

**Authenticated page outside `_dashboard`** (like `/admin`): create a path layout file with its own
`beforeLoad` guard (e.g. `requireAdmin`).

### 5.7 Add a new language

1. Add the locale code to the `locales` array in `apps/web/src/lib/i18n.ts`.
2. Create `apps/web/locales/{code}.json` (translate from `source.json`).
3. Add a Clerk localization import in `apps/web/src/routes/__root.tsx` and handle the new locale in
   the `ClerkProvider` `localization` prop.

Translation strings are managed via Crowdin; `source.json` is the source language (English).

---

## 6. Where to look next

- **Architecture intent:** [`spec/architecture/`](../spec/architecture) — bounded contexts (01),
  hexagonal tactical design (02), the BFF/gateway seam (03), the migration roadmap (04), and the
  current-state appendix.
- **Product features:** [`spec/features/`](../spec/features) — personal-library, puzzle-exchange,
  friend-circles, community, analytics, advanced-features.
- **Contribution mechanics:** [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- **Schema:** `packages/backend/convex/schema.ts` is the single source of truth for tables and
  indexes.

---

_Made with care by the JigSwap contributors. When in doubt, read the spec and follow the existing
pattern in the nearest sibling file._
