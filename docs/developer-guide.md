# JigSwap Developer Guide

A guide for contributors working on JigSwap — a personal puzzle library and exchange platform. It covers the architecture, local setup, how data flows end to end, project conventions, and concrete "how to" recipes for the most common changes.

> **Read this alongside the specs.** The canonical design intent lives in [`spec/`](../spec). In particular:
>
> - [`spec/architecture/README.md`](../spec/architecture/README.md) — the four decisions that shape the architecture.
> - [`spec/architecture/01-bounded-contexts.md`](../spec/architecture/01-bounded-contexts.md) — bounded contexts, ubiquitous language, the context map.
> - [`spec/architecture/02-hexagonal-architecture.md`](../spec/architecture/02-hexagonal-architecture.md) — ports/adapters layout, dependency injection, domain events.
> - [`spec/architecture/03-bff-tanstack-start.md`](../spec/architecture/03-bff-tanstack-start.md) — the TanStack Start BFF and the gateway seam.
> - [`spec/architecture/04-migration-roadmap.md`](../spec/architecture/04-migration-roadmap.md) — the strangler-fig migration from Next.js/entity-driven to TanStack Start/DDD.
> - [`spec/features/`](../spec/features) — per-feature intent.
> - [`CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution workflow, commit style, PR process.

> **Heads-up on stale docs.** `README.md` and `CONTRIBUTING.md` still describe the **pre-migration** Next.js setup (App Router, `next-intl`, port 3000, `pnpm convex:dev` from `packages/backend`). The architecture proposal has since been adopted: the web app is now **TanStack Start** (Vite, `use-intl`, file-based routing) and the backend is organised by **bounded context** with a **hexagonal/DDD** domain layer. When the README and the code disagree, trust the code. This guide reflects the current code.

---

## 1. Architecture overview

JigSwap is a **pnpm + Nx monorepo** with a strict layering: a framework-agnostic **DDD domain layer**, a **contracts** package that owns the wire shapes, a **gateway** seam that is the single import point for the Convex API, a **Convex backend** that wires domain logic to persistence via ports/adapters, and a **TanStack Start** web app that consumes everything reactively.

### 1.1 Monorepo layout (pnpm workspaces + Nx)

```
jigswap/
├── apps/
│   └── web/                 # @jigswap/web — TanStack Start (SSR React) app
├── packages/
│   ├── domain/              # @jigswap/domain — pure DDD/hexagonal domain layer
│   ├── contracts/           # @jigswap/contracts — view DTOs + Zod input schemas
│   ├── gateway/             # @jigswap/gateway — the single Convex-API import seam
│   └── backend/             # @jigswap/backend — Convex functions, schema, adapters
├── spec/                    # architecture + feature specifications
├── package.json             # root scripts (Nx run-many targets)
├── nx.json / project.json   # Nx config + per-project targets
└── pnpm-workspace.yaml      # workspace globs + dependency pins/overrides
```

- **pnpm** (pinned via `packageManager` in the root `package.json`) is the package manager. Workspace packages link to each other with `workspace:^` and `linkWorkspacePackages: true`.
- **Nx** orchestrates tasks. Root scripts are `nx run-many` wrappers (`dev`, `build`, `lint`, `type-check`, `test`). Use `pnpm graph` to view the dependency graph and `pnpm affected` to target only changed projects.
- **Dependency pins** live in `pnpm-workspace.yaml` `overrides` (notably `zod`, `eslint-plugin-react-hooks`) — read the comments there before bumping them; several pins exist to keep type-checking and lint green.

### 1.2 The dependency direction (hexagonal / DDD)

The whole point of the layering is that **dependencies point inward toward the domain**, and the domain depends on nothing external:

```
            apps/web  (TanStack Start UI — no domain logic, no Convex import)
                │  imports @/gateway
                ▼
        packages/gateway  (the ONLY importer of convex/_generated/api)
                │
                ▼
       packages/backend/convex  (Convex functions = driving adapters)
                │  composes use cases, injects port implementations (driven adapters)
                ▼
         packages/domain  (pure aggregates, use cases, ports — no I/O)
                ▲
                │  defines wire shapes used by backend handler return types
        packages/contracts  (view DTOs + Zod input schemas, Convex-free)
```

Key invariants enforced at the module/TypeScript level (and by `pnpm arch:check`, a `dependency-cruiser` run over `packages/domain/src`):

- `packages/domain` imports **nothing** from Convex, Clerk, or any I/O framework. All external concerns are interfaces (`ports`).
- Bounded contexts in `packages/domain` **never import each other** — cross-context data flows through an **anti-corruption layer (ACL)** port.
- The web app **never** imports `@jigswap/backend` or `@jigswap/contracts` directly — only `@/gateway`.
- Only `packages/gateway/src/operations.ts` imports `@jigswap/backend/convex/_generated/api`.

### 1.3 The domain layer (`packages/domain`)

Twelve **bounded contexts** plus a `shared-kernel`:

`catalog`, `conversation`, `exchange`, `identity`, `insights`, `library`, `notifications`, `reputation`, `sharing`, `social`, `solving`, and `shared-kernel`.

Each context (except `insights`, see below) follows the same internal structure:

```
packages/domain/src/<context>/
├── domain/                  # aggregates, value objects, events, errors, ids
└── application/
    ├── use-cases/           # makeXxx(deps) factory functions + *.spec.ts tests
    ├── ports/in/            # inbound command/port interfaces
    ├── ports/out/           # outbound repository/service interfaces (the ACL seams)
    └── testing/             # in-memory adapters: FixedClock, repos, RecordingEventPublisher
```

**The aggregate pattern.** Every aggregate has exactly four public surface points:

1. A `static` named constructor (`submit` / `register` / `propose` / `acquire` / `open` / `create`) returning `Result<Aggregate, DomainError>`.
2. `static rehydrate(state)` for loading from persistence.
3. `toState()` for saving back.
4. `pullEvents(): readonly DomainEvent[]` to drain recorded events.

Use cases always do `save(aggregate)` **then** `events.publish(aggregate.pullEvents())`.

**The shared-kernel** (`packages/domain/src/shared-kernel`) provides five building blocks used everywhere: branded `Id<TBrand>` (+ central `branded-ids.ts` constructors like `toCopyId`, `toMemberId`); `Result<T,E>` (`ok`/`err`/`isOk`/`isErr`) instead of exceptions; `DomainEvent` + `DomainEventPublisher`; a `Clock` interface (deterministic tests); and `DomainError`.

**The `insights` outlier.** `insights` has **no aggregates and no application layer** — it is purely a set of total, deterministic projection functions (`computePersonalStats`, `computeCollectionBreakdown`, `computeCompletionTrends`, `recommendPuzzles`, `computeTradeActivity`) over plain DTO inputs. Do not add use-case or port files there.

**Cross-context ACLs.** Library holds a `CatalogSnapshot` value object (denormalised Catalog data) and gets it through the `CatalogSnapshotProvider` outbound port — the only seam where Library touches Catalog. Exchange reads copy availability through `CopyPort` (a read-only `CopyView`), never importing Library's aggregate. Notifications translates upstream events into its own `NOTIFICATION_TYPES` literals so it never imports another context's event class.

### 1.4 Contracts (`packages/contracts`)

A zero-runtime-dependency (except Zod) package owning **every view DTO and input schema that crosses the frontend/backend seam**, organised by bounded context. Most DTOs are plain TypeScript interfaces; a handful (`paginationInput`, `ExchangeStatsView`, `MemberStatsView`, `GlobalStatsView`) are Zod schemas exporting inferred types. New shapes should be **plain interfaces** unless runtime validation is needed.

- Convex-free by design: IDs are plain `string` (`DocId = string`) even though Convex uses branded `Id<T>` at runtime; assignability works both ways.
- **No build step**: `main`/`types` point at `./src/index.ts`, so `tsc` processes it inside each consumer.
- The web app **never imports `@jigswap/contracts`**. Contract types reach the frontend by structural inference: backend handlers annotate their return type as the contract interface, and the web app derives local types with `FunctionReturnType<typeof gateway.foo.bar>`.

### 1.5 Gateway / BFF boundary (`packages/gateway` + `apps/web/src/gateway`)

`packages/gateway/src/operations.ts` is a one-file facade exporting a single `gateway` object that maps every Convex function reference into bounded-context namespaces (`gateway.catalog.*`, `gateway.library.*`, `gateway.exchange.*`, …). It is the **only** file allowed to import `@jigswap/backend/convex/_generated/api`. `packages/gateway/src/types.ts` re-exports Convex `Doc` and `Id` so nothing else touches `_generated/dataModel`.

`apps/web/src/gateway/index.ts` is a thin shim re-exporting `@jigswap/gateway` under the `@/gateway` alias (a migration convenience). All web code imports from `@/gateway`.

> Per [`spec/architecture/03-bff-tanstack-start.md`](../spec/architecture/03-bff-tanstack-start.md) §3.3, the BFF pattern also allows `createServerFn().validator(<zod schema from contracts>)` for SSR server functions — shape validation only, no business rules. Most reads/writes currently go through reactive Convex calls directly.

### 1.6 Convex backend (`packages/backend/convex`)

A hexagonal-architecture monolith on the Convex platform. Each bounded context exposes its public API as thin query/mutation/action files (**driving adapters**) that compose domain use cases from `packages/domain` and inject port implementations from `<context>/adapters/` (**driven adapters**, factory functions closing over the Convex `ctx`).

- **Schema** (`convex/schema.ts`) is the single source of persistence truth (25 tables). Aggregate-managed tables carry an optional `aggregateId` column + a `by_aggregate_id` index.
- **Auth** is Clerk. `convex/auth.config.ts` trusts the Clerk frontend API; every auth-gated function calls `requireMember(ctx)` (`identity/requireMember.ts`), which resolves the Clerk JWT subject → `users` row → typed `MemberId`. The **only** unauthenticated inbound surface is the Clerk webhook at `POST /clerk-users-webhook` (`http.ts`) plus a couple of explicitly public reads (`insights/getGlobalStats`, `contact/submitContactMessage`).
- **Domain events** are the connective tissue. `events/makeEventPublisher.ts` runs a context's critical _same-transaction_ sync handlers, then `recordAndSchedule` appends each event to the durable `domainEvents` table and schedules `events/dispatch.ts` via `ctx.scheduler.runAfter(0)`. `dispatch` fans each event to async subscribers (Notifications, Custody, Library ownership/loan reactions) and is idempotent (stamps `processedAt`).
- **Dual-tier coexistence.** A legacy table-driven layer (`users.ts`, `exchanges.ts`, `adminCategories.ts`) coexists with the DDD layer in the same tables. Rule: if `aggregateId` is set, the domain path owns the row; otherwise the legacy path does. Never assume `aggregateId` is present.
- **Node actions** (files with `'use node';`) run in Convex's Node runtime for `web-push` (VAPID), `jimp` image re-encoding, and the Hugging Face moderation call. They cannot touch `ctx.db`; they use `ctx.runQuery`/`ctx.runMutation`.

### 1.7 Web app (`apps/web`)

TanStack Start (SSR React on Vite), migrated from Next.js. File-based routing under `apps/web/src/routes/`. Three layout groups: the root `__root.tsx` (bootstraps Clerk auth, Convex, i18n); a pathless `_dashboard` layout (auth-gated app shell); and a pathless `_public` layout (marketing). `/admin` is a role-gated path layout.

- **Data**: exclusively Convex reactive client (`useQuery`/`useMutation`/`useAction` from `convex/react`) via `@/gateway`. SSR auth is bootstrapped in the root `beforeLoad` (`fetchClerkAuth` injects a Convex JWT into the SSR HTTP client); `ConvexProviderWithClerk` refreshes tokens on the client.
- **Shell**: `components/dashboard-layout/shell.tsx` is a console-style inset layout. Navigation IA + per-route metadata live in a single file, `components/dashboard-layout/route-meta.ts` (`ROUTE_META` + `NAV_GROUPS`). Leaf routes publish title/breadcrumbs/actions via `usePageHeader`/`usePageHeaderActions` rather than rendering their own `<h1>`.
- **i18n**: `use-intl` with `en`/`nl` JSON catalogs. Locale is detected server-side from the `jigswap-intl` cookie (`apps/web/src/lib/i18n.ts`).
- **Compat shims** (`apps/web/src/compat/clerk.tsx`, `link.tsx`, `navigation.ts`) preserve Next.js API surfaces during the migration. New code should use TanStack Router APIs directly.

---

## 2. Local setup & key scripts

### Prerequisites

- Node.js (see `.nvmrc`; run `nvm use`).
- pnpm — use the version pinned in the root `package.json` `packageManager` field (`corepack enable` will honour it).
- A Clerk account and a Convex account/deployment.

### Setup

```bash
git clone https://github.com/SanderVerkuil/jigswap.git
cd jigswap
pnpm install
```

Create `apps/web/.env.local`. Required keys (note the framework migration kept the `NEXT_PUBLIC_` prefixes that Convex/Clerk read; verify against `apps/web/.env.example` if present):

```env
# Convex
CONVEX_DEPLOYMENT=dev:your-deployment
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_FRONTEND_API_URL=https://your-clerk-frontend.clerk.accounts.dev
```

The Convex deployment must have a JWT template named `convex` (the SSR bootstrap requests this template), and the Clerk webhook (`/clerk-users-webhook`) must be configured to keep `users` rows in sync.

### Running

Run the backend and the web app in two terminals:

```bash
# Terminal 1 — Convex backend (watches packages/backend/convex, regenerates _generated/)
pnpm --filter @jigswap/backend convex:dev

# Terminal 2 — web app (Vite dev server)
pnpm dev
```

The dev server runs on **`http://localhost:3001`** (Vite). The old README still says 3000 — that was the Next.js era.

### Key scripts (root)

| Script                              | What it does                                                             |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                          | Start the web app (`nx dev web`, Vite).                                  |
| `pnpm build` / `pnpm build:web`     | Build all projects / just the web app.                                   |
| `pnpm lint` / `pnpm lint:fix`       | ESLint across projects (`run-many`).                                     |
| `pnpm type-check`                   | `tsc --noEmit` across projects.                                          |
| `pnpm test`                         | Vitest across projects.                                                  |
| `pnpm format` / `pnpm format:check` | Prettier write / check (CI runs `format:check` first).                   |
| `pnpm arch:check`                   | `dependency-cruiser` over `packages/domain/src` — enforces the layering. |
| `pnpm mutation:domain`              | Stryker mutation testing of the domain layer.                            |
| `pnpm graph` / `pnpm affected`      | Nx dependency graph / affected-only tasks.                               |

Backend-specific: `pnpm --filter @jigswap/backend convex:dev` (dev + codegen) and `convex:deploy` (prod).

---

## 3. Request / data flow, end to end

**SSR auth bootstrap.** Browser → TanStack Start server → `__root.tsx` `beforeLoad` calls `fetchClerkAuth` (server fn) → Clerk `auth()` returns `{ userId, token }` (a `convex` JWT template token) → the token is injected into the Convex SSR HTTP client → SSR queries run authenticated → context is dehydrated to the client → `clientAuthCache` is seeded on hydration so subsequent client navigations skip the server fetch.

**Reactive read.** A route calls `useQuery(gateway.<context>.<fn>, args)` → `ConvexProviderWithClerk` keeps a live WebSocket open → Convex re-runs the query whenever underlying tables change → React re-renders. No manual invalidation for data on the same client. Pass `"skip"` as the args to defer a query until preconditions are met.

**Read through the backend.** The Convex handler resolves rows + storage URLs, calls a pure `mappers.ts` row→DTO function (typed against the `@jigswap/contracts` interface, enforced by `tsc`), and returns the DTO. For copy timelines, every surfaced member id is passed through `social/privacy.ts → projectMemberIdentity` (the privacy chokepoint), which reveals identity only for self / public-profile / mutual-follower and otherwise emits an opaque salted `anonRef`. Hidden identities never cross the wire.

**Type propagation.** Backend handler declares `Promise<SomeView | null>` → `gateway` exposes the reference → the web app derives its local type via `FunctionReturnType<typeof gateway.<context>.<fn>>`. Contract types flow to the frontend purely by inference; the web app never imports `@jigswap/contracts`.

**Write (mutation).** A component calls `useMutation(gateway.<context>.<fn>)` and invokes it with args → the Convex mutation runs `requireMember(ctx)`, composes the domain use case (e.g. `makeProposeExchange`) with injected adapters, persists, then publishes domain events. Sync handlers run in the same transaction (e.g. Exchange marks a copy unavailable on settlement); async subscribers run via the scheduled `dispatch` mutation (e.g. Notifications writes a notification; Custody records a chain-of-custody entry; Library transfers ownership / opens a loan). Affected reactive `useQuery` subscriptions re-deliver automatically.

**Worked example — exchange settlement.** Second `confirmCompletion` → `makeConfirmCompletion` detects dual confirmation → emits `OwnershipTransferred` (swap/sale) or `PossessionTransferred` (lend) → sync handler marks the copy unavailable in the same transaction → `recordAndSchedule` persists events + schedules `dispatch` → dispatch runs: (1) `custody/subscriber` records the pre-transfer owner, (2) `library/transferOnSettlement` flips `ownerId`, (3) `library/openLoanOnSettlement` opens a `loans` row for lends, (4) `notifications/subscriber` notifies both parties → Reputation now allows a `PartnerReview`.

---

## 4. Conventions

### Testing

- **Domain unit tests**: `*.spec.ts` colocated in `packages/domain` (typically `application/use-cases/*.spec.ts`). Use the in-memory `testing/` harness for each context — `FixedClock`, `SequentialIdGenerator`, `InMemory*Repository`, `RecordingEventPublisher` — **no mocking framework**. This is the canonical pattern.
- **Backend integration tests**: `*.test.ts` at the `packages/backend/convex/` root.
- **Web tests**: `*.test.ts` (e.g. `humanize-duration.test.ts`, `puzzle-import/draft-to-form-defaults.test.ts`).
- Run with `pnpm test` (Vitest). Mutation-test the domain with `pnpm mutation:domain`.
- `apps/web/src/routeTree.gen.ts` is generated and produces expected `tsc` noise — ignore it.

### Prettier / lint

- **Prettier must be run before committing** — CI runs `format:check` first and fails fast (before type-check). Format changed files: `pnpm format` (or scope it). `prettier-plugin-organize-imports` is active.
- Lint with `pnpm lint` / fix with `pnpm lint:fix`. Keep `nx lint @jigswap/web` at 0 errors; some `pnpm-workspace.yaml` pins exist specifically to keep lint green — don't bump them casually.
- `pnpm arch:check` must pass: it enforces the domain-layer dependency rules (no cross-context imports, no I/O imports).

### Commit & PR style

Follow [Conventional Commits](https://www.conventionalcommits.org/) (`<type>(<scope>): <subject>` — `feat`, `fix`, `docs`, `style`, `refactor`, `chore`). Branch off `main` with a descriptive name (`feat/...`, `fix/...`), run `pnpm lint:fix` + Prettier, open a PR against `main` and fill out the template. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Codegen (Convex)

After adding/renaming a Convex function or table, run `pnpm --filter @jigswap/backend convex:dev` to regenerate `convex/_generated/` (`api.js`, `api.d.ts`, `dataModel.d.ts`, `server.d.ts`). **In a worktree without a live deployment, hand-edit `packages/backend/convex/_generated/api.d.ts`** to declare the new function — the gateway cannot reference a function the generated API type doesn't know about. Never hand-edit `_generated/` in the main repo (it's regenerated). Never hand-edit `dataModel.d.ts` (derived from `schema.ts`).

---

## 5. How-to recipes

### 5.1 Add a feature end to end (read path)

Adding a new read that surfaces in the UI touches four packages, in dependency order:

1. **Contract** — add the view interface in `packages/contracts/src/<context>/views.ts` (plain interface unless runtime validation is needed). Ensure it's re-exported from the context `index.ts`.
2. **Backend mapper** — add a pure row→DTO function in `packages/backend/convex/<context>/mappers.ts`, typed against the contract.
3. **Backend query** — create `packages/backend/convex/<context>/myQuery.ts` exporting a `query`/`mutation` from `../_generated/server`; auth-gate with `await requireMember(ctx)`; annotate the handler return type as `Promise<MyView | null>` so `tsc` enforces the mapper. Resolve all rows/URLs in the handler, then call the mapper (mappers stay pure/async-free).
4. **Codegen** — run `convex:dev` (or hand-edit `_generated/api.d.ts` in a worktree).
5. **Gateway** — add `myOp: api.<context>.myQuery.myQuery` to the right namespace in `packages/gateway/src/operations.ts`.
6. **Web** — call `useQuery(gateway.<context>.myOp, args)` and derive types via `FunctionReturnType<typeof gateway.<context>.myOp>`. Pass `"skip"` until preconditions hold.

For a write, skip the DTO unless the mutation returns a view; in the backend mutation, compose the relevant domain use case with injected adapters and publish events (see §5.4). Web side: `useMutation(gateway.<context>.myMutation)`.

### 5.2 Add a bounded context

Domain side (`packages/domain/src/<context>/`):

1. Create `domain/{aggregate.ts, ids.ts, events.ts, errors.ts, index.ts}` and `application/{use-cases/, ports/{in/,out/}, testing/, index.ts}`.
2. Implement aggregates with the static-factory + `rehydrate` + `toState` + `pullEvents` pattern, returning `Result<...>`.
3. Declare branded IDs in `domain/ids.ts` **and** add constructors to `shared-kernel/branded-ids.ts`.
4. Write outbound port interfaces for any repository/external service; for cross-context data add an ACL port (never import another context's aggregate).
5. Implement in-memory adapters in `testing/` for all outbound ports; write `*.spec.ts` use-case tests.
6. Re-export from the context `index.ts`.

Contracts side: add `packages/contracts/src/<context>/{views.ts,index.ts}` and `export * from "./<context>"` in `packages/contracts/src/index.ts`.

Backend side: create `packages/backend/convex/<context>/` with `adapters/` (repositories, an `inProcessEventPublisher` if it needs sync reactions, a system clock, id generators), one file per use case, an `errors.ts` mapping domain errors to `ConvexError`, and a `subscriber.ts` if it reacts to foreign events (register it in `events/dispatch.ts`). Add any new tables to `schema.ts` with `by_aggregate_id` indexes, then run codegen.

Gateway side: add a new top-level namespace key to the `gateway` object in `packages/gateway/src/operations.ts`.

### 5.3 Add a contract + gateway operation

1. **Contract**: `packages/contracts/src/<context>/views.ts` — interface (or Zod schema + inferred type if validated). Re-export via the context `index.ts`. No build step; consumers pick it up by type reference.
2. **Backend**: mapper in `mappers.ts` + a query/mutation with the contract as its annotated return type.
3. **Codegen** then **gateway**: `myOp: api.<context>.<file>.<fn>` under the correct namespace in `operations.ts`.
4. **Web**: consume via `useQuery`/`useMutation(gateway.<context>.myOp, …)` and `FunctionReturnType`.

> Some legacy operations still point at old modules (e.g. `gateway.library.generateUploadUrl` → `api.puzzles.generateUploadUrl`); these are noted in the gateway source and should migrate to domain modules over time.

### 5.4 Add a Convex function / table (with codegen)

**New function**: create the `.ts` file under `packages/backend/convex/<context>/`, export a named `query`/`mutation`/`action`/`internalQuery`/… from `../_generated/server`. Auth-gate member operations with `await requireMember(ctx)` (never trust a client-supplied user id). For mutations that change domain state, build the publisher via `makeEventPublisher(ctx, "<context>", syncHandlers?)` (or the context's `inProcessEventPublisher`); use `noopEventPublisher` when events are only needed to satisfy a use case's signature without async dispatch. Driven adapters are factory functions called once per invocation (composition root). Then run codegen / hand-edit `_generated/api.d.ts` in a worktree.

**New table / index**: add a `defineTable(...)` (or `.index()` / `.searchIndex()`) in `convex/schema.ts`. For aggregate-managed tables use `aggregateId: v.optional(v.string())` + `.index("by_aggregate_id", ["aggregateId"])`. Run `convex:dev` to push the schema and regenerate `dataModel.d.ts`.

**New domain-event subscriber**: export `handleDomainEvent(ctx, event)` from `<context>/subscriber.ts` and register it in `events/dispatch.ts` before the `processedAt` stamp. Subscribers run inside the dispatch transaction; throwing rolls back all side effects and the scheduler retries cleanly.

**New Node action** (third-party APIs, image work, push): add `'use node';` at the top, export an `internalAction`/`action`, use `ctx.runQuery`/`ctx.runMutation` for DB access, and schedule it from a mutation with `ctx.scheduler.runAfter(0, internal.<path>.<name>, args)`.

### 5.5 Add a web route / component

**Authenticated dashboard page**:

1. Create `apps/web/src/routes/_dashboard/<path>.tsx` exporting `Route = createFileRoute('/_dashboard/<path>')(...)`.
2. Add an entry to `ROUTE_META` in `components/dashboard-layout/route-meta.ts` with `pageKey` (+ optional `group`).
3. Add `shell.pages.<pageKey>.title` (and `.subtitle` if needed) to `apps/web/locales/source.json`.
4. To appear in the sidebar, add a `ShellNavItem` to the relevant `NAV_GROUPS` array in `route-meta.ts`.

The shell renders the page head, breadcrumbs, and nav highlight automatically. Do **not** render your own `<h1>`/title; publish dynamic header content with `usePageHeaderActions(() => <node>, deps)` or `usePageHeader(() => ({ title, crumbs, actions }), deps)` (both clear on unmount).

**Marketing page**: create `apps/web/src/routes/_public/<name>.tsx` via `createFileRoute('/_public/<name>')`; the `_public.tsx` layout supplies the marketing header/footer. Build from primitives in `components/marketing/`.

**Auth in components**: `useUser()` (from `@/compat/clerk`) for the Clerk user; `useQuery(gateway.identity.currentUser, {})` for the Convex `MemberView`. Many mutations expect the domain ULID `aggregateId` (not the Convex `_id`) — guard with `if (!row.aggregateId) return;` since legacy rows may lack it.

### 5.6 Add a new language

i18n uses `use-intl` (not `next-intl`). Catalogs live in `apps/web/locales/` (`source.json` is the dev/source-of-truth that feeds Crowdin; `en.json` / `nl.json` are the production catalogs). The active locale is detected server-side from the `jigswap-intl` cookie (falling back to `Accept-Language`, then `en`) in `apps/web/src/lib/i18n.ts`; the timezone is fixed to `Europe/Amsterdam`.

To add a string: add the key to `apps/web/locales/source.json` under the right namespace, and use it via `useTranslations('namespace')`. In dev, `source.json` is always used regardless of locale.

To add a new language (e.g. `de`):

1. Add the locale code to the supported-locale list in `apps/web/src/lib/i18n.ts` (the detection/matcher logic and catalog loader).
2. Add the production catalog `apps/web/locales/de.json` (Crowdin manages translations from `source.json`).
3. Update the language switcher UI so users can pick it (writes the `jigswap-intl` cookie via the `setLocale` server fn, which clears the intl cache and invalidates the router so the new catalog loads).
4. Confirm Clerk localization: `ClerkProvider` is locale-reactive, so add/verify the matching Clerk localization import if you want Clerk UI translated too.

---

## 6. Quick reference — where things live

| You want to…                        | Go to                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Change a domain rule / invariant    | `packages/domain/src/<context>/domain/` (+ `*.spec.ts`)                |
| Add a use case                      | `packages/domain/src/<context>/application/use-cases/`                 |
| Add/adjust a wire shape             | `packages/contracts/src/<context>/views.ts`                            |
| Add a Convex query/mutation/action  | `packages/backend/convex/<context>/`                                   |
| Change the DB schema                | `packages/backend/convex/schema.ts` (then codegen)                     |
| Expose a backend fn to the UI       | `packages/gateway/src/operations.ts`                                   |
| Add a page                          | `apps/web/src/routes/` (+ `components/dashboard-layout/route-meta.ts`) |
| Add navigation / page-head metadata | `apps/web/src/components/dashboard-layout/route-meta.ts`               |
| Add a translation string            | `apps/web/locales/source.json`                                         |
| Understand intent                   | `spec/architecture/` and `spec/features/`                              |
