# Phase 4 — "Find People" Directory Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the People page into two URL-addressable tabs — "Your network" (current content + pending-request strip) and a search-first "Find people" tab with a recently-joined seed, QR fallbacks, and a one-time discoverability notice.

**Architecture:** One new Convex query (`listRecentPublicMembers`, gated by the existing `profileVisibilityOf` chokepoint), a 2-character server-side minimum on the existing `searchUsers`, and a web-side restructure of `people.tsx` around the shadcn Tabs component with a validated `?tab` search param. No new domain aggregates; no schema changes.

**Tech Stack:** Convex (query + convex-test/vitest), TanStack Router file routes + validated search params, TanStack Query via `convexQuery`, shadcn Tabs/Badge/Card, use-intl (en + nl).

**Spec:** `docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md` (Phase 4 section).

## Interface contracts (built by earlier phases — reference, do not build)

| Artifact                                | Expected shape                                                                                                                                                                                                     | Built in |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `/members/$handle` route                | exists; `MemberTile` names already link to it                                                                                                                                                                      | Phase 1  |
| `gateway.social.incomingFollowRequests` | query `{}` → array of pending incoming requests                                                                                                                                                                    | Phase 2  |
| `FollowRequestsStrip`                   | `apps/web/src/components/social/follow-requests-strip.tsx`, self-contained                                                                                                                                         | Phase 2  |
| `QrDialog`                              | `apps/web/src/components/social/qr-dialog.tsx`, self-contained trigger-button+dialog; props `{ memberId, displayName, username, avatarUrl }` fed from `gateway.identity.currentUser` (fetches its own invite link) | Phase 3  |

**If any name differs from what Phase 1–3 actually shipped, adapt the import/call sites in Tasks 5–6 to the shipped name — do not rename the shipped artifact.**

**Rate-limiting note (deliberate deviation):** the spec says "rate-limited server-side". Convex queries are read-only (no table writes), so a counting rate limiter cannot live in the `searchUsers` query itself without converting it to a mutation or adding the `@convex-dev/rate-limiter` component. This plan implements the cheap 90%: a server-enforced 2-character minimum (empty/1-char probes return `[]` without touching the search index) plus the existing 50-candidate cap and a 300 ms client debounce. If abuse ever shows up, add `@convex-dev/rate-limiter` as a follow-up.

**Convex codegen note:** `npx convex codegen` needs a deployment. If it fails in this checkout, hand-edit `packages/backend/convex/_generated/api.d.ts` instead (Task 1 Step 4 shows the exact lines).

---

### Task 1: Backend — `listRecentPublicMembers` query

**Files:**

- Create: `packages/backend/convex/listRecentPublicMembers.test.ts`
- Create: `packages/backend/convex/identity/listRecentPublicMembers.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (only if codegen unavailable)
- Modify: `packages/gateway/src/operations.ts` (identity section, around line 183)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/listRecentPublicMembers.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Nine members inserted oldest-first (insert order fixes _creationTime order).
// alice = the viewer; carol is private; dave is inactive; everyone else public.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    await mkUser("clerk_alice", "Alice");
    await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    await ctx.db.insert("profiles", {
      memberId: carol,
      displayName: "Carol",
      visibility: "private",
      updatedAt: now,
    });
    await mkUser("clerk_dave", "Dave", { isActive: false });
    const eve = await mkUser("clerk_eve", "Eve");
    // An explicit PUBLIC profile row must also pass the gate (not only "no row").
    await ctx.db.insert("profiles", {
      memberId: eve,
      displayName: "Eve",
      visibility: "public",
      updatedAt: now,
    });
    await mkUser("clerk_frank", "Frank");
    await mkUser("clerk_grace", "Grace");
    await mkUser("clerk_henry", "Henry");
    await mkUser("clerk_ivy", "Ivy");
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("listRecentPublicMembers", () => {
  test("returns newest public members first, capped at 5", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    // Newest-first: ivy, henry, grace, frank, [dave skipped: inactive],
    // [carol skipped: private], eve fills the 5th slot; bob dropped by the cap.
    expect(result.map((m) => m.name)).toEqual([
      "Ivy",
      "Henry",
      "Grace",
      "Frank",
      "Eve",
    ]);
  });

  test("never surfaces private, inactive, or the viewer themself", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    const names = result.map((m) => m.name);
    expect(names).not.toContain("Carol"); // private profile
    expect(names).not.toContain("Dave"); // inactive
    expect(names).not.toContain("Alice"); // the viewer
  });

  test("emits PII-free MemberView (no email, no clerkId)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
      {},
    );
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m).not.toHaveProperty("email");
      expect(m).not.toHaveProperty("clerkId");
    }
  });

  test("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.identity.listRecentPublicMembers.listRecentPublicMembers, {}),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache -- listRecentPublicMembers.test.ts`
Expected: FAIL — `api.identity.listRecentPublicMembers` is undefined (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/backend/convex/identity/listRecentPublicMembers.ts`:

```ts
import type { MemberView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): the "Recently joined" seed for the Find-people tab — up to 5 of
// the newest members, PUBLIC profiles only (the privacy chokepoint gates every candidate), never
// the viewer themself, never inactive accounts. Newest-first via Convex's _creationTime ordering;
// we over-scan a bounded window because private/inactive candidates get dropped by the gate.
const LIMIT = 5;
const SCAN_LIMIT = 50;

export const listRecentPublicMembers = query({
  args: {},
  handler: async (ctx): Promise<MemberView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const candidates = await ctx.db
      .query("users")
      .order("desc")
      .take(SCAN_LIMIT);

    const results: MemberView[] = [];
    for (const u of candidates) {
      if (results.length >= LIMIT) break;
      if (u._id === viewerId) continue;
      if (u.isActive === false) continue;
      if ((await profileVisibilityOf(ctx, u._id)) !== "public") continue;
      results.push(toMemberView(u));
    }
    return results;
  },
});
```

- [ ] **Step 4: Regenerate (or hand-edit) the generated API**

Run: `cd packages/backend && npx convex codegen`

If that fails (no deployment in this checkout), hand-edit
`packages/backend/convex/_generated/api.d.ts` — mirror the existing
`identity/searchUsers` entry exactly:

1. Next to `import type * as identity_searchUsers from "../identity/searchUsers.js";` add:
   ```ts
   import type * as identity_listRecentPublicMembers from "../identity/listRecentPublicMembers.js";
   ```
2. Next to `"identity/searchUsers": typeof identity_searchUsers;` in the module map add:
   ```ts
   "identity/listRecentPublicMembers": typeof identity_listRecentPublicMembers;
   ```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache -- listRecentPublicMembers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Register the query in the gateway**

In `packages/gateway/src/operations.ts`, inside the `identity: {` block (after the
`search: api.identity.searchUsers.searchUsers,` line at ~line 183), add:

```ts
    // "Recently joined" seed for the Find-people tab: up to 5 newest PUBLIC members.
    recentPublicMembers:
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
```

- [ ] **Step 7: Type-check backend and gateway**

Run: `pnpm nx type-check @jigswap/backend --skip-nx-cache && pnpm nx type-check @jigswap/gateway --skip-nx-cache`
Expected: both exit 0.

- [ ] **Step 8: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/identity/listRecentPublicMembers.ts packages/backend/convex/listRecentPublicMembers.test.ts packages/gateway/src/operations.ts
git add packages/backend/convex/identity/listRecentPublicMembers.ts packages/backend/convex/listRecentPublicMembers.test.ts packages/backend/convex/_generated/api.d.ts packages/gateway/src/operations.ts
git commit -m "feat(social): recently-joined public members query for Find people"
```

---

### Task 2: Backend — server-side 2-character minimum on `searchUsers`

**Files:**

- Create: `packages/backend/convex/searchUsers.test.ts`
- Modify: `packages/backend/convex/identity/searchUsers.ts:27-28`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/searchUsers.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    for (const [clerkId, name] of [
      ["clerk_alice", "Alice"],
      ["clerk_bo", "Bo"],
    ] as const) {
      await ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("searchUsers minimum query length", () => {
  test("returns [] for empty and 1-character terms without hitting the index", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    for (const searchTerm of ["", " ", "b", " b "]) {
      const result = await asAlice(t).query(
        api.identity.searchUsers.searchUsers,
        { searchTerm },
      );
      expect(result).toEqual([]);
    }
  });

  test("still searches from 2 characters", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAlice(t).query(
      api.identity.searchUsers.searchUsers,
      { searchTerm: "bo" },
    );
    expect(result.map((m) => m.name)).toContain("Bo");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache -- searchUsers.test.ts`
Expected: FAIL — the 1-character cases return a non-empty array (current guard only rejects length 0).

- [ ] **Step 3: Implement the minimum**

In `packages/backend/convex/identity/searchUsers.ts`, replace:

```ts
const searchTerm = args.searchTerm.trim().toLowerCase();
if (searchTerm.length === 0) return [];
```

with:

```ts
// Server-enforced minimum (mirrors the Find-people UI): sub-2-character probes return
// nothing and never touch the search index — the cheap guard against enumeration scans.
const searchTerm = args.searchTerm.trim().toLowerCase();
if (searchTerm.length < 2) return [];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache -- searchUsers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full backend suite (guard against regressions in globalSearch/other callers)**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache`
Expected: PASS. If a pre-existing test asserted 1-character search behavior, update that assertion to expect `[]` (the new contract) — do not weaken the new guard.

- [ ] **Step 6: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/identity/searchUsers.ts packages/backend/convex/searchUsers.test.ts
git add packages/backend/convex/identity/searchUsers.ts packages/backend/convex/searchUsers.test.ts
git commit -m "feat(identity): enforce 2-character minimum in member search"
```

---

### Task 3: Web — `hideLocation` prop on `MemberTile`

**Files:**

- Modify: `apps/web/src/components/social/member-tile.tsx:34-40, 72-77`

- [ ] **Step 1: Add the prop**

In `apps/web/src/components/social/member-tile.tsx`, change the component signature:

```tsx
export function MemberTile({
  memberId,
  followsYou,
  hideLocation = false,
}: {
  memberId: Id<"users">;
  followsYou: boolean;
  // Discovery surfaces (Find people) omit the location line: stats build trust with
  // strangers, street-level context doesn't. Defaults off so network tiles are unchanged.
  hideLocation?: boolean;
}) {
```

and wrap the location block:

```tsx
{
  !hideLocation && member.location && (
    <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="truncate">{member.location}</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm nx type-check @jigswap/web --skip-nx-cache`
Expected: exit 0 (existing call sites compile unchanged — the prop is optional).

- [ ] **Step 3: Format and commit**

```bash
pnpm prettier --write apps/web/src/components/social/member-tile.tsx
git add apps/web/src/components/social/member-tile.tsx
git commit -m "feat(web): optional hideLocation on MemberTile for discovery surfaces"
```

---

### Task 4: Web — locale strings (en + nl)

**Files:**

- Modify: `apps/web/locales/en.json` (`people` namespace, ~line 1410)
- Modify: `apps/web/locales/nl.json` (`people` namespace)
- Modify: `apps/web/locales/source.json` (mirror the en additions — this file tracks the source strings; match how existing `people` keys appear there)

- [ ] **Step 1: Extend the `people` namespace in `en.json`**

Merge these keys into the existing `"people": { ... }` object (keep the current keys):

```json
"tabs": {
  "network": "Your network",
  "find": "Find people"
},
"find": {
  "searchPlaceholder": "Search by name or @username",
  "minChars": "Type at least 2 characters to search for members.",
  "resultsLabel": "Search results",
  "recentlyJoined": "Recently joined",
  "recentlyJoinedEmptyTitle": "No new members to show yet",
  "recentlyJoinedEmptySub": "Know a fellow puzzler? Show them your QR code.",
  "noResultsTitle": "Can't find them?",
  "noResultsSub": "Ask for their profile link — or scan their QR.",
  "showMyQr": "Show my QR"
},
"discoverableNotice": {
  "body": "Your profile is discoverable — other members can find you by name in Find people.",
  "review": "Review visibility",
  "dismiss": "Dismiss"
}
```

- [ ] **Step 2: Extend the `people` namespace in `nl.json`**

```json
"tabs": {
  "network": "Jouw netwerk",
  "find": "Mensen vinden"
},
"find": {
  "searchPlaceholder": "Zoek op naam of @gebruikersnaam",
  "minChars": "Typ minstens 2 tekens om leden te zoeken.",
  "resultsLabel": "Zoekresultaten",
  "recentlyJoined": "Recent lid geworden",
  "recentlyJoinedEmptyTitle": "Nog geen nieuwe leden om te tonen",
  "recentlyJoinedEmptySub": "Ken je een medepuzzelaar? Laat je QR-code zien.",
  "noResultsTitle": "Kun je ze niet vinden?",
  "noResultsSub": "Vraag om hun profiellink — of scan hun QR-code.",
  "showMyQr": "Toon mijn QR"
},
"discoverableNotice": {
  "body": "Je profiel is vindbaar — andere leden kunnen je op naam vinden via Mensen vinden.",
  "review": "Zichtbaarheid bekijken",
  "dismiss": "Sluiten"
}
```

- [ ] **Step 3: Mirror the en additions in `source.json`** (same keys/values as Step 1, matching the file's existing structure for the `people` namespace).

- [ ] **Step 4: Validate JSON and commit**

Run: `python3 -c "import json; [json.load(open(f)) for f in ['apps/web/locales/en.json','apps/web/locales/nl.json','apps/web/locales/source.json']]" && pnpm prettier --write apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json`
Expected: no exception, files formatted.

```bash
git add apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git commit -m "feat(web): locale strings for Find people tab and discoverability notice"
```

---

### Task 5: Web — Find-people tab content component

**Files:**

- Create: `apps/web/src/components/social/find-people.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/social/find-people.tsx`:

```tsx
"use client";

// The Find-people tab: search-first member discovery. A debounced search box
// (2-character minimum, mirrored server-side in identity/searchUsers) over the
// privacy-gated member search; while idle, a small "Recently joined" seed of
// public profiles. Both empty states route to the QR fallback — the answer to
// "can't find them" is always "ask for their link or QR". Discovery tiles hide
// location (stats build trust with strangers; street-level context doesn't).

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Input } from "@/components/ui/input";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import {
  MemberTile,
  MemberTileSkeleton,
} from "@/components/social/member-tile";
import { QrDialog } from "@/components/social/qr-dialog";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function FindPeople() {
  const t = useTranslations("people.find");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), DEBOUNCE_MS);
  const searching = debounced.length >= MIN_QUERY_LENGTH;

  const { data: results } = useQuery({
    ...convexQuery(gateway.identity.search, { searchTerm: debounced }),
    enabled: searching,
  });
  const { data: recent } = useQuery(
    convexQuery(gateway.identity.recentPublicMembers, {}),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  // Phase 3's self-contained trigger-button + fullscreen dialog; reused at all
  // three "can't find them" surfaces below.
  const qrButton = me ? (
    <QrDialog
      memberId={me._id}
      displayName={me.name}
      username={me.username}
      avatarUrl={me.avatar}
    />
  ) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        {qrButton}
      </div>

      {term.trim().length > 0 && !searching ? (
        <p className="text-muted-foreground text-sm">{t("minChars")}</p>
      ) : searching ? (
        results === undefined ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <MemberTileSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            title={t("noResultsTitle")}
            sub={t("noResultsSub")}
            action={qrButton}
          />
        ) : (
          <div
            className="flex flex-col gap-4"
            role="list"
            aria-label={t("resultsLabel")}
          >
            {results.map((member) => (
              <MemberTile
                key={member._id}
                memberId={member._id as Id<"users">}
                followsYou={false}
                hideLocation
              />
            ))}
          </div>
        )
      ) : (
        <section>
          <SectionHead title={t("recentlyJoined")} icon={UserPlus} />
          {recent === undefined ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <MemberTileSkeleton key={i} />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              title={t("recentlyJoinedEmptyTitle")}
              sub={t("recentlyJoinedEmptySub")}
              action={qrButton}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {recent.map((member) => (
                <MemberTile
                  key={member._id}
                  memberId={member._id as Id<"users">}
                  followsYou={false}
                  hideLocation
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

Notes for the implementer:

- `QrDialog` is Phase 3's self-contained trigger-button+dialog (verified against the Phase 3 plan): props `{ memberId, displayName, username, avatarUrl }`, its own label from Phase 3's `invite` locale namespace. The `people.find.showMyQr` locale key is NOT needed — delete it from Task 4's files during this task. Check the `currentUser` DTO field names (`_id` vs `memberId`, `avatar` vs `avatarUrl`) against `packages/contracts` and what Phase 3 shipped in `people.tsx`, and mirror that exact call.
- `gateway.identity.search` already trims/lowercases server-side; the client passes the debounced raw term.
- Check that `@/components/ui/input` exists (it is the shadcn Input used across forms); if the repo uses a different path, match it.

- [ ] **Step 2: Type-check**

Run: `pnpm nx type-check @jigswap/web --skip-nx-cache`
Expected: exit 0. (Route-tree noise about `routeTree.gen.ts` is a known artifact — only fail on real type errors in the new files.)

- [ ] **Step 3: Format and commit**

```bash
pnpm prettier --write apps/web/src/components/social/find-people.tsx
git add apps/web/src/components/social/find-people.tsx
git commit -m "feat(web): Find people tab content — gated search + recently joined seed"
```

---

### Task 6: Web — People page tabs, `?tab` param, and discoverability notice

**Files:**

- Modify: `apps/web/src/routes/_dashboard/people.tsx` (full-file restructure below)
- Modify: the Phase 3 `InviteRedeemer` fallback-nudge link (in the dashboard layout component Phase 3 added it to — grep for `inviteFallback` or the nudge's locale key): change its `<Link to="/people">` to `<Link to="/people" search={{ tab: "find" }}>` now that the Find tab exists. Phase 3 deliberately left this plain and deferred the upgrade to this task.

- [ ] **Step 1: Restructure the route**

Replace the contents of `apps/web/src/routes/_dashboard/people.tsx` with:

```tsx
import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { ActivityFeed } from "@/components/social/activity-feed";
import { FindPeople } from "@/components/social/find-people";
import { FollowRequestsStrip } from "@/components/social/follow-requests-strip";
import {
  MemberTile,
  MemberTileSkeleton,
} from "@/components/social/member-tile";
import { ProfileEditDialog } from "@/components/social/profile-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

type PeopleTab = "network" | "find";

export const Route = createFileRoute("/_dashboard/people")({
  // URL-addressable tabs: /people?tab=find deep-links straight into discovery
  // (used by notifications and QR empty states). Anything else is the default.
  validateSearch: (search: Record<string, unknown>): { tab: PeopleTab } => ({
    tab: search.tab === "find" ? "find" : "network",
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "people") }],
  }),
  component: PeoplePage,
});

// ---------------------------------------------------------------------------
// One-time discoverability notice
// Info-toned (not a warning): tells members the directory can now surface
// their (public-by-default) profile, with an inline path to the existing
// visibility setting. Dismissal persists in localStorage (same pattern as the
// my-puzzles actions coachmark); lazy-initialised so it never reads `window`
// during SSR render.
// ---------------------------------------------------------------------------
const NOTICE_KEY = "jigswap.notice.discoverable";

function DiscoverabilityNotice() {
  const t = useTranslations("people.discoverableNotice");

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(NOTICE_KEY) === "1";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(NOTICE_KEY, "1");
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-muted/60 text-muted-foreground flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
    >
      <span className="flex-1">
        {t("body")}{" "}
        <Link
          to="/profile"
          className="text-foreground font-medium underline underline-offset-2"
        >
          {t("review")}
        </Link>
      </span>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={handleDismiss}
        className="hover:bg-accent hover:text-foreground focus-visible:ring-ring shrink-0 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Your-network tab body: the pending follow-request strip above the deduped
// follower/following grid, then the activity feed — the pre-tabs page content.
function NetworkTab() {
  const t = useTranslations("people");

  const { data: following } = useQuery(
    convexQuery(gateway.social.following, {}),
  );
  const { data: followers } = useQuery(
    convexQuery(gateway.social.followers, {}),
  );

  const loading = following === undefined || followers === undefined;

  // Dedupe both follow directions into one network; remember who follows you
  // so the tile can carry a "Follows you" badge.
  const followerIds = new Set((followers ?? []).map((edge) => edge.memberId));
  const network = new Map<string, { followsYou: boolean }>();
  for (const edge of following ?? []) {
    network.set(edge.memberId, { followsYou: followerIds.has(edge.memberId) });
  }
  for (const edge of followers ?? []) {
    if (!network.has(edge.memberId)) {
      network.set(edge.memberId, { followsYou: true });
    }
  }
  const members = Array.from(network.entries());

  // The page title ("People") lives in the shell page head; publish the network
  // member count there too so the body carries no duplicate section header.
  const headerMeta = loading
    ? undefined
    : t("memberCount", { count: members.length });
  usePageHeaderActions(
    () =>
      headerMeta ? (
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {headerMeta}
        </span>
      ) : null,
    [headerMeta],
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <FollowRequestsStrip />
        {loading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {Array.from({ length: 3 }).map((_, i) => (
              <MemberTileSkeleton key={i} />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState title={t("emptyTitle")} sub={t("emptySub")} />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {members.map(([memberId, { followsYou }]) => (
              <MemberTile
                key={memberId}
                memberId={memberId as Id<"users">}
                followsYou={followsYou}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead
          title={t("activity")}
          icon={Bell}
          action={<ProfileEditDialog />}
        />
        <ActivityFeed />
      </section>
    </div>
  );
}

function PeoplePage() {
  const t = useTranslations("people");
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Incoming pending follow requests drive the count badge on the network tab.
  const { data: incoming } = useQuery(
    convexQuery(gateway.social.incomingFollowRequests, {}),
  );
  const pendingCount = incoming?.length ?? 0;

  const handleTabChange = (value: string) => {
    void navigate({
      search: { tab: value === "find" ? "find" : undefined },
      replace: true,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <DiscoverabilityNotice />

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="network">
            {t("tabs.network")}
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="find">{t("tabs.find")}</TabsTrigger>
        </TabsList>

        <TabsContent value="network" className="mt-4">
          <NetworkTab />
        </TabsContent>
        <TabsContent value="find" className="mt-4">
          <FindPeople />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Notes for the implementer:

- `FollowRequestsStrip` and `gateway.social.incomingFollowRequests` are Phase 2 artifacts; if the shipped names differ, adapt the imports here. If Phase 2 mounted `FollowRequestsStrip` directly in the old `people.tsx` body, this restructure supersedes that mount (the strip now lives inside `NetworkTab`) — make sure it isn't rendered twice.
- `search: { tab: undefined }` removes the param, so the default tab URL stays clean (`/people`, not `/people?tab=network`).
- The `validateSearch` change regenerates `routeTree.gen.ts` on the next dev-server/build run; commit the regenerated file if it changes.

- [ ] **Step 2: Type-check**

Run: `pnpm nx type-check @jigswap/web --skip-nx-cache`
Expected: exit 0.

- [ ] **Step 3: Manual smoke check (dev server on :3001; browser automation is unavailable in this environment — verify via curl + eyes if a browser is open, otherwise inspect rendered HTML)**

Run: `pnpm nx dev @jigswap/web` (or the repo's dev target) and confirm:

- `/people` shows the notice + two tabs, network tab active, pending badge only when requests exist.
- `/people?tab=find` opens the Find tab directly.
- Typing 1 character shows the min-chars helper; 2+ characters shows results or the "Can't find them?" empty state; clearing the box shows "Recently joined".
- Dismissing the notice and reloading keeps it dismissed.

- [ ] **Step 4: Format and commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/people.tsx
git add apps/web/src/routes/_dashboard/people.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): People page tabs — your network + find people, discoverability notice"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache`
Expected: PASS, including the two new test files.

- [ ] **Step 2: Type-check everything**

Run: `pnpm nx run-many -t type-check --skip-nx-cache`
Expected: all projects exit 0.

- [ ] **Step 3: Format check (mirrors CI's first gate)**

Run: `pnpm prettier --check apps/web/src/routes/_dashboard/people.tsx apps/web/src/components/social/find-people.tsx apps/web/src/components/social/member-tile.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json packages/backend/convex/identity/listRecentPublicMembers.ts packages/backend/convex/identity/searchUsers.ts packages/backend/convex/listRecentPublicMembers.test.ts packages/backend/convex/searchUsers.test.ts packages/gateway/src/operations.ts`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 4: Commit anything the sweep touched; otherwise done**

```bash
git status --short
```

Expected: clean tree (all work committed in Tasks 1–6).

---

## Self-review (completed)

- **Spec coverage:** tabs + `?tab=find` (Task 6), search-first with min-2-chars + helper line (Tasks 2, 5), single-column max-w-2xl results with location omitted (Tasks 3, 5), recently-joined seed of up-to-5 public profiles with cold-start empty state (Tasks 1, 5), empty-result QR fallback + QR beside the search box (Task 5), pending strip above the network grid + tab count badge (Task 6), one-time info-toned discoverability notice with visibility link (Task 6), en+nl+source strings (Task 4), backend tests for privacy/cap/ordering and the search minimum (Tasks 1–2). Rate limiting is downgraded to a server-enforced minimum with rationale (header note).
- **Placeholder scan:** no TBDs; every code step carries complete code; interface-contract adaptations are explicit conditionals, not deferrals.
- **Type consistency:** `listRecentPublicMembers` → gateway `identity.recentPublicMembers` → `FindPeople` usage all match; `hideLocation` prop name consistent between Tasks 3 and 5; `PeopleTab`/`tab` param consistent within Task 6.
