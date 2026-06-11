# 3. The TanStack Start BFF

This document specifies the web tier after re-platforming from **Next.js App Router** to **TanStack
Start**, run as a **Backend-for-Frontend**: it authenticates, authorises, validates, aggregates, and
shapes view DTOs — and contains **no domain logic**.

## 3.1 What "BFF, no domain logic" means here

The rule is mechanical and enforceable:

> A web server function may call the application layer (via the gateway), read the session, validate
> input shape, combine results, and map to a view model. It may **not** decide a business outcome.

Concretely, the BFF **may**:

- verify the Clerk session and resolve the current member;
- validate request shape with a `@jigswap/contracts` zod schema (shape, not business rules);
- call one or more application use cases through the **gateway**;
- aggregate/stitch results from multiple calls into one view DTO for a screen;
- handle SSR, caching headers, redirects, and presentation concerns.

The BFF **may not**:

- enforce an invariant (e.g. "a copy can only be in one active exchange") — that's the domain;
- compute a domain decision (state transitions, pricing rules, goal achievement);
- import `@jigswap/domain` or `@jigswap/backend/convex/_generated/api`.

The lint guardrails from §2.9 make "BFF imports domain" a build failure.

## 3.2 The gateway seam (this is what removes direct Convex coupling)

Today: `useQuery(api.puzzles.createPuzzle, …)` — the UI is welded to Convex.
Proposed: the UI and BFF depend on an **`ApplicationGateway` port**; a Convex adapter implements it.

```ts
// apps/web/src/gateway/application-gateway.ts  (a PORT — an interface)
import type {
  ProposeExchangeInput,
  ExchangeSummaryDTO,
  CopyDetailDTO,
} from "@jigswap/contracts";

export interface ApplicationGateway {
  // commands
  proposeExchange(input: ProposeExchangeInput): Promise<{ exchangeId: string }>;
  acceptExchange(input: { exchangeId: string }): Promise<void>;
  // queries (one-shot, for SSR / server fns)
  myExchanges(): Promise<ExchangeSummaryDTO[]>;
  copyDetail(copyId: string): Promise<CopyDetailDTO>;
}
```

```ts
// apps/web/src/gateway/convex-application-gateway.ts  (the ADAPTER)
import { ConvexHttpClient } from "convex/browser";
import { api } from "@jigswap/backend/convex/_generated/api"; // ← the ONLY place this import is allowed
import type { ApplicationGateway } from "./application-gateway";

export const convexApplicationGateway = (
  client: ConvexHttpClient,
): ApplicationGateway => ({
  proposeExchange: (i) => client.mutation(api.exchange.propose, i),
  acceptExchange: (i) => client.mutation(api.exchange.accept, i),
  myExchanges: () => client.query(api.exchange.myExchanges, {}),
  copyDetail: (id) => client.query(api.exchange.copyDetail, { copyId: id }),
});
```

The generated Convex API is now imported in exactly **one file**. Swapping transports (or splitting
contexts across deployments) is a one-file change. The UI imports `ApplicationGateway`, never Convex.

## 3.3 BFF server functions = inbound adapters

```ts
// apps/web/src/server/exchange.server.ts
import { createServerFn } from "@tanstack/react-start";
import { proposeExchangeInput } from "@jigswap/contracts"; // zod schema (SHAPE validation only)
import { getGateway } from "./gateway-context"; // builds Convex gateway w/ session token
import { requireSession } from "./auth"; // Clerk

export const proposeExchange = createServerFn({ method: "POST" })
  .validator(proposeExchangeInput) // shape validation
  .handler(async ({ data }) => {
    await requireSession(); // authn/z gate (not a domain rule)
    const gateway = await getGateway();
    return gateway.proposeExchange(data); // delegate — NO decision made here
  });
```

This server function is a textbook **driving adapter**: transport in, validate shape, authenticate,
delegate to the application layer, return. Zero business outcomes computed.

### Aggregation is allowed (and is the BFF's real job)

```ts
// apps/web/src/server/puzzle-page.server.ts  — stitch several calls into ONE screen DTO
export const loadCopyPage = createServerFn({ method: "GET" })
  .validator(z.object({ copyId: z.string() }))
  .handler(async ({ data }) => {
    await requireSession();
    const g = await getGateway();
    const [copy, related, history] = await Promise.all([
      g.copyDetail(data.copyId),
      g.relatedCopies(data.copyId),
      g.custodyHistory(data.copyId),
    ]);
    return { copy, related, history } satisfies CopyPageViewModel; // presentation shaping
  });
```

## 3.4 Reactivity in TanStack Start

Next.js gave us `ConvexProviderWithClerk` + `useQuery`. The TanStack equivalent keeps live updates but
routes them through a gateway-friendly layer:

- Use **`@convex-dev/react-query`** to expose Convex live queries as **TanStack Query** observables.
  This integrates with TanStack Start/Router loaders and keeps the UI off `_generated/api` by wrapping
  query references behind typed gateway helpers.
- Pattern: components call `useExchangeList()` (a hook in `apps/web/src/gateway/hooks/`) that wraps the
  Convex+react-query subscription. Components import the hook, not Convex.
- For SSR/loaders and mutations, use the one-shot `ApplicationGateway` (`ConvexHttpClient`) above.

> The seam is the same idea on both sides: **one** module is allowed to touch Convex symbols; everything
> else depends on `ApplicationGateway` / typed hooks.

## 3.5 Routing & rendering

- **TanStack Router** file-based routes replace the App Router tree. Route groups map cleanly:
  `(public)`, `(auth)`, `(dashboard)`, `admin` → TanStack route folders with layout routes.
- Route **loaders** call the BFF server functions / gateway for SSR data; **actions**/server fns handle
  mutations.
- The `(dashboard)` server-side auth guard (today `auth()` in a layout) becomes a `beforeLoad` guard on
  the dashboard layout route that calls `requireSession()` and redirects.

## 3.6 Auth, i18n, analytics on TanStack Start

| Concern       | Today (Next.js)                                                 | Proposed (TanStack Start)                                                                                                          |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `@clerk/nextjs`, `ConvexProviderWithClerk`, `auth()` in layouts | `@clerk/tanstack-react-start`: `<ClerkProvider>`, `getAuth()` in server fns, Convex token via the gateway's session-aware client   |
| Convex client | `ConvexReactClient` + `convex/react-clerk`                      | `@convex-dev/react-query` for live reads; `ConvexHttpClient` (with Clerk JWT) for server-fn one-shots                              |
| i18n          | `next-intl` (Next-coupled)                                      | `use-intl` (next-intl's framework-agnostic core) or `lingui`/`i18next`; **keep** Crowdin OTA + cookie-based locale, no URL routing |
| Analytics     | `posthog-js`/`posthog-node`, `@vercel/*`                        | unchanged client libs; PostHog reverse-proxy rewrites move from `next.config.ts` to the TanStack/Nitro server config               |
| Hosting       | Next on Vercel                                                  | TanStack Start (Vinxi/Nitro) Vercel preset                                                                                         |

> **Migration risk note:** `next-intl` is the most Next-coupled dependency. Its `use-intl` core
> (messages, formatting, `useTranslations`) is framework-agnostic and is the lowest-friction path;
> locale detection moves to a TanStack server middleware reading the same cookie. Budget a focused
> spike for this.

## 3.7 Where the old "UI logic" goes

| Today, in the Next UI                                        | Lands in                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Client-side puzzle/search filtering on fetched data          | A **read-model query** (Convex query adapter) returning already-filtered DTOs; BFF passes params through             |
| Image-upload orchestration (get URL → POST → pass storageId) | A BFF server fn coordinating a `StoragePort` adapter; the _association_ of an image to a `Copy` is a domain use case |
| Inline role checks / admin gating                            | BFF `beforeLoad` guard + Identity context roles (real check, replacing the `TODO`)                                   |
| Mock data in `messages/page.tsx`                             | Conversation context read model via the gateway                                                                      |

The net effect: the web tier becomes **presentation + orchestration only**, which is exactly what a BFF
is supposed to be.
