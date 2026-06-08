# Appendix: Current-State Inventory

A factual snapshot of what exists today (2026-06-08), used as the baseline for the proposal. No
opinions here — see the numbered documents for analysis and proposals.

## Repository shape

- **pnpm + Nx monorepo** (`nx` 22.2.1, `pnpm` 11.5.2).
- `apps/web` — `@jigswap/web`, **Next.js 16.0.10** App Router, React 19.2.3, TypeScript 5.9.3.
- `packages/backend` — `@jigswap/backend`, **Convex** ^1.31.0 functions. Consumed by the web app as
  `"@jigswap/backend": "workspace:^"`, which re-exports the generated API.

## Convex backend (entity-driven)

Functions are organised **per table**:

| File | Owns |
|------|------|
| `users.ts` | user upsert, profile, stats, search, Clerk-webhook internal mutations |
| `puzzles.ts` | **both** canonical `puzzles` **and** physical `ownedPuzzles` + images + browse |
| `exchanges.ts` | exchange state machine, messages, accept/decline/complete/cancel, inline notifications |
| `collections.ts` | collections + members |
| `adminCategories.ts` | global localized (en/nl) puzzle taxonomy |
| `http.ts` | `POST /clerk-users-webhook` (Svix-verified) |
| `auth.config.ts` | Clerk JWT trust |

### Schema tables

`users`, `puzzles`, `ownedPuzzles`, `ownedPuzzleImages`, `collections`, `collectionMembers`,
`completions`, `categories` (personal), `adminCategories` (global), `goals`, `exchanges`, `messages`,
`reviews`, `favorites`, `notifications`.

Notable facts that drive the proposal:

- `puzzles` (the product/catalogue entry, with `status: pending|approved|rejected`, EAN/UPC, brand,
  `searchableText`) is distinct from `ownedPuzzles` (a physical copy: condition, availability flags,
  acquisition) — but they live in one file.
- `reviews` is **partner feedback attached to an `exchange`** (communication/packaging/condition/
  timeliness). `completions` **also** carries a `rating` + `review` — **puzzle** feedback. Same word,
  two meanings.
- Visibility/availability is fragmented: `ownedPuzzles.availability {forTrade,forSale,forLend}` +
  `collections.visibility {private,public}`. The spec documents a richer 6-level model
  (private / friend-circle / visible / lendable / swappable / tradeable) that is **not** implemented.
- **Notifications are inserted inline** inside exchange/collection mutations (tight coupling).
- **Chain-of-custody / "exchange instances"** is documented as a *core* requirement but there is **no**
  ownership-history table; completing an exchange only flips availability flags.
- `categories` (personal) and `goals` tables exist with **no UI**.

### How the frontend talks to Convex

Direct coupling, no abstraction layer:

```
React component → useQuery / usePaginatedQuery / useMutation (convex/react)
              → api.<module>.<fn> from @jigswap/backend/convex/_generated/api
              → ConvexReactClient (WebSocket) → Convex function → ctx.db
```

No TanStack Query, SWR, or fetch layer. Server state is Convex's reactive subscriptions.

## Web app

- App Router only (no `pages/`). Route groups: `(public)`, `(auth)`, `(dashboard)`, `admin`.
- **No route handlers / API routes.** The only server HTTP handler is the Convex Clerk webhook.
- Server-side auth guard in `(dashboard)/layout.tsx` via `auth()` from `@clerk/nextjs/server`.
- Business logic leaks into the UI: client-side puzzle/search filtering, image-upload orchestration.
- i18n via **next-intl** (en, nl; cookie-based, no URL routing; Crowdin OTA).
- Auth via **Clerk** (`@clerk/nextjs` ^6.36.2) + `ConvexProviderWithClerk`. Roles
  (`admin | moderator`) read from `sessionClaims.metadata.role`; admin route guard is a `TODO`.
- UI: Radix + Tailwind v4 + shadcn-style components, `react-hook-form` + `zod`, `sonner`, PostHog,
  Vercel Analytics/Speed Insights.

## Domain concepts present today

User, Puzzle (catalogue), OwnedPuzzle (copy), OwnedPuzzleImage, Collection, CollectionMember,
Completion, Category (personal), AdminCategory (global), Goal, Exchange (trade/sale/loan state
machine), Message (exchange-scoped), Review (partner, exchange-scoped), Favorite, Notification.

## Documented-but-not-built (from `spec/features/*`, `README.md`, `PERSONAL_LIBRARY_API.md`)

Friend Circles (private groups + permission levels + circle-scoped visibility); chain-of-custody /
ownership history; wishlists; personal categories & goals UI; analytics/insights, trends, exports,
goal tracking; recommendations / collaborative filtering; community profiles, follows, activity feed,
social discovery; condition timeline; multi-channel (email/push) notifications; auctions (mentioned
once). All `spec` acceptance criteria are currently unchecked.
