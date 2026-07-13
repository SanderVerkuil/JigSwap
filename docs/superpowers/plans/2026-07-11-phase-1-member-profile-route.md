# Phase 1 — Public Member Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A canonical `/members/$handle` page that works for every viewer tier — full profile for public/mutual viewers, a private interstitial for logged-in non-mutuals, and a logged-out teaser — backed by one new unauthenticated Convex query.

**Architecture:** One new unauthenticated query (`getPublicMemberTeaser`) resolves a handle (username-first, users-id fallback) into a strictly limited identity payload, routed through the existing `profileVisibilityOf` chokepoint. A standalone TanStack route (outside both `_public` and `_dashboard` layouts, like the public home page) picks the shell by auth state: marketing shell for anonymous visitors, `DashboardShell` for members. Logged-in tier discrimination reuses the existing privacy-gated `getUserById` (null ⇒ interstitial). Spec: `docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md`, Phase 1.

**Tech Stack:** Convex (queries + convex-test/vitest), TanStack Router/Start (file-based routes, SSR loaders), Clerk auth, TanStack Query via `@convex-dev/react-query`, use-intl (en/nl), Tailwind + existing UI components.

---

**Conventions used throughout:**

- All paths are relative to the repo root `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap`.
- Backend tests live at `packages/backend/convex/*.test.ts` and run with vitest from `packages/backend`.
- Mirror CI by skipping the Nx cache: `--skip-nx-cache`.
- Before every commit: `pnpm prettier --write <changed files>` (CI runs `format:check` first).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

> **Convex codegen note:** creating `packages/backend/convex/social/getPublicMemberTeaser.ts` adds a new module to the generated API. If `pnpm nx dev @jigswap/backend` (convex dev) is running, `convex/_generated/api.d.ts` regenerates automatically. If it is NOT running (e.g. in a worktree), hand-edit `packages/backend/convex/_generated/api.d.ts` as shown in Task 2 Step 4 — the runtime `api.js` is a Proxy and needs no edit.

---

### Task 1: `PublicMemberTeaserView` contract

**Files:**

- Modify: `packages/contracts/src/social/social.ts`

- [ ] **Step 1: Add the DTO**

Append to `packages/contracts/src/social/social.ts`:

```ts
/**
 * The unauthenticated "who is this member" read behind /members/$handle. Deliberately tiny:
 * identity fields only — never bio, shelf, stats, or location. A private member IS named here:
 * reachable by direct link (the spec's Instagram-style interstitial) but not enumerable (search
 * stays visibility-gated) and not indexable (the page renders a robots noindex for private
 * profiles). `avatar` is consent-gated for anonymous callers (users.shareAvatarPublicly);
 * `puzzleCount` is only disclosed for public profiles.
 */
export interface PublicMemberTeaserView {
  memberId: string;
  displayName: string;
  username?: string;
  avatar?: string;
  /** users.createdAt (ms). */
  memberSince: number;
  visibility: "public" | "private";
  /** Owned-copy count; null for private profiles. */
  puzzleCount: number | null;
}
```

- [ ] **Step 2: Verify the export chain**

Run: `grep -rn "social" packages/contracts/src/index.ts packages/contracts/src/social/index.ts`
Expected: `social/index.ts` re-exports `./social` (star export), and `src/index.ts` re-exports the social module — the new interface is exported with no further edits. If `social/index.ts` lists named exports instead, add `PublicMemberTeaserView` to that list.

- [ ] **Step 3: Type-check contracts**

Run: `pnpm nx type-check @jigswap/contracts --skip-nx-cache`
Expected: success. (If the project name differs, find it with `cat packages/contracts/project.json | grep '"name"'` and reuse it everywhere this plan type-checks contracts.)

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write packages/contracts/src/social/social.ts
git add packages/contracts/src/social/social.ts
git commit -m "feat(contracts): PublicMemberTeaserView for the public member page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `getPublicMemberTeaser` query (backend, TDD)

**Files:**

- Create: `packages/backend/convex/social/getPublicMemberTeaser.ts`
- Create: `packages/backend/convex/publicMemberTeaser.test.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (only if convex dev is not running)
- Modify: `packages/gateway/src/operations.ts` (social block, around line 255)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/publicMemberTeaser.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NO_AVAILABILITY = { forTrade: false, forSale: false, forLend: false };

// Four members: public-with-username (2 copies, consented avatar), public-without-username,
// private-with-username (avatar NOT consented), and an inactive member.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Partial<{
        username: string;
        avatar: string;
        bio: string;
        location: string;
        shareAvatarPublicly: boolean;
        isActive: boolean;
      }> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: extra.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    const alice = await mkUser("clerk_alice", "Alice", {
      username: "alice",
      avatar: "https://img.example/alice.png",
      bio: "I love gradients",
      location: "Utrecht",
      shareAvatarPublicly: true,
    });
    const bob = await mkUser("clerk_bob", "Bob"); // public by default, no username
    const carol = await mkUser("clerk_carol", "Carol", {
      username: "carol",
      avatar: "https://img.example/carol.png",
      bio: "secret bio",
      location: "Amsterdam",
      // No shareAvatarPublicly: avatar must NOT reach anonymous callers.
    });
    const dave = await mkUser("clerk_dave", "Dave", {
      username: "dave",
      isActive: false,
    });

    await ctx.db.insert("profiles", {
      memberId: carol,
      displayName: "Carol de Puzzelaar",
      visibility: "private",
      updatedAt: now,
    });

    // Two copies for Alice so puzzleCount is exercised.
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzle,
      ownerId: alice,
      condition: "good",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzle,
      ownerId: alice,
      condition: "fair",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, carol, dave };
  });

describe("getPublicMemberTeaser", () => {
  test("resolves a username for an anonymous caller (public member)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "alice" },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.memberId).toBe(alice);
    expect(teaser!.displayName).toBe("Alice");
    expect(teaser!.username).toBe("alice");
    expect(teaser!.visibility).toBe("public");
    expect(teaser!.puzzleCount).toBe(2);
    // Consented: avatar visible to anonymous callers.
    expect(teaser!.avatar).toBe("https://img.example/alice.png");
    // The payload never carries bio/location — assert at the object level.
    expect(teaser).not.toHaveProperty("bio");
    expect(teaser).not.toHaveProperty("location");
  });

  test("falls back to the users id when the handle is not a username", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: bob },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.memberId).toBe(bob);
    expect(teaser!.username).toBeUndefined();
  });

  test("unknown handle and inactive member both return null", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, {
        handle: "nobody-here",
      }),
    ).toBeNull();
    expect(
      await t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, {
        handle: "dave",
      }),
    ).toBeNull();
  });

  test("private member: named, but no puzzleCount and no unconsented avatar (anonymous caller)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "carol" },
    );
    expect(teaser).not.toBeNull();
    // Deliberate: a private member IS named on their own direct link (spec decision),
    // with the profile displayName preferred over the account name.
    expect(teaser!.displayName).toBe("Carol de Puzzelaar");
    expect(teaser!.visibility).toBe("private");
    expect(teaser!.puzzleCount).toBeNull();
    // No shareAvatarPublicly consent -> anonymous callers never see the avatar.
    expect(teaser!.avatar).toBeUndefined();
    expect(teaser).not.toHaveProperty("bio");
    expect(teaser).not.toHaveProperty("location");
  });

  test("authenticated caller sees the avatar without public consent (in-app parity)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const teaser = await asAlice.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "carol" },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.avatar).toBe("https://img.example/carol.png");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/backend`): `pnpm exec vitest run convex/publicMemberTeaser.test.ts`
Expected: FAIL — `api.social.getPublicMemberTeaser` is undefined (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/backend/convex/social/getPublicMemberTeaser.ts`:

```ts
import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { profileVisibilityOf } from "./privacy";

// Resolve the acting member from auth WITHOUT throwing (mirrors catalog/getPuzzleById): an
// unauthenticated caller simply yields null. Used only to decide avatar disclosure below.
const optionalActingMember = async (
  ctx: QueryCtx,
): Promise<Id<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  return user?._id ?? null;
};

// The UNAUTHENTICATED read behind /members/$handle. Deliberately tiny: identity fields only —
// never bio, shelf, stats, or location. A private member IS disclosed by name on their own direct
// link (spec: Instagram-style interstitial; the page renders robots-noindex for private profiles),
// while enumeration stays blocked because search remains visibility-gated. Handle resolution is
// username-first with a users-id fallback so id-based QR/share links survive username renames.
export const getPublicMemberTeaser = query({
  args: { handle: v.string() },
  handler: async (ctx, args): Promise<PublicMemberTeaserView | null> => {
    const handle = args.handle.trim();
    if (!handle) return null;

    let user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", handle))
      .unique();
    if (!user) {
      const id = ctx.db.normalizeId("users", handle);
      if (id) user = await ctx.db.get(id);
    }
    if (!user || !user.isActive) return null;

    const memberId = user._id;
    const [visibility, profile, viewer] = await Promise.all([
      profileVisibilityOf(ctx, memberId),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique(),
      optionalActingMember(ctx),
    ]);

    // Avatar: any signed-in member may see it (parity with search results and member tiles);
    // anonymous callers only with the member's explicit public-surface consent.
    const avatar =
      viewer !== null || user.shareAvatarPublicly ? user.avatar : undefined;

    // Coarse collection size — public profiles only.
    let puzzleCount: number | null = null;
    if (visibility === "public") {
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
        .collect();
      puzzleCount = copies.length;
    }

    return {
      memberId,
      displayName: profile?.displayName ?? user.name,
      username: user.username,
      avatar,
      memberSince: user.createdAt,
      visibility,
      puzzleCount,
    };
  },
});
```

- [ ] **Step 4: Regenerate (or hand-edit) the generated API**

If `convex dev` is running, `packages/backend/convex/_generated/api.d.ts` updates by itself — verify with:
`grep -n "getPublicMemberTeaser" packages/backend/convex/_generated/api.d.ts`

If it is NOT running, hand-edit `packages/backend/convex/_generated/api.d.ts` (two edits, matching how every other `social/*` module appears there):

1. Alongside the other imports: `import type * as social_getPublicMemberTeaser from "../social/getPublicMemberTeaser.js";`
2. In the `fullApi` module map, alphabetically within the `social/` entries: `"social/getPublicMemberTeaser": typeof social_getPublicMemberTeaser;`

- [ ] **Step 5: Run the test to verify it passes**

Run (from `packages/backend`): `pnpm exec vitest run convex/publicMemberTeaser.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Register the gateway operation**

In `packages/gateway/src/operations.ts`, inside the `social:` block, directly after the line `profile: api.social.getProfile.getProfile,`, add:

```ts
    publicMemberTeaser:
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
```

Run: `pnpm nx type-check @jigswap/gateway --skip-nx-cache` (confirm the project name via `packages/gateway/project.json` if it differs).
Expected: success.

- [ ] **Step 7: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/getPublicMemberTeaser.ts packages/backend/convex/publicMemberTeaser.test.ts packages/gateway/src/operations.ts
git add packages/backend/convex/social/getPublicMemberTeaser.ts packages/backend/convex/publicMemberTeaser.test.ts packages/backend/convex/_generated/api.d.ts packages/gateway/src/operations.ts
git commit -m "feat(social): unauthenticated getPublicMemberTeaser behind /members/\$handle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: i18n strings (en, nl, source)

**Files:**

- Modify: `apps/web/locales/en.json`
- Modify: `apps/web/locales/nl.json`
- Modify: `apps/web/locales/source.json`

- [ ] **Step 1: Add the `members` namespace to en.json**

In `apps/web/locales/en.json`, directly after the `"people": { ... }` block (around line 1410), add:

```json
"members": {
  "memberSince": "Member since {date}",
  "collects": "Collects ~{count, plural, one {# puzzle} other {# puzzles}} on JigSwap",
  "privateTitle": "{name}'s profile is private",
  "privateSub": "Follow each other to see their collection and swap.",
  "joinCta": "Join JigSwap to follow {name}",
  "logIn": "Log in",
  "shelfTitle": "Featured shelf",
  "bioTitle": "About",
  "notFoundTitle": "Member not found",
  "notFoundSub": "This link may be outdated, or the member may have changed their username.",
  "findPeople": "Find people",
  "backHome": "Back to home"
},
```

Also add, inside the existing `"shell"` namespace's `"pages"` object (find it with `grep -n '"pages"' apps/web/locales/en.json`):

```json
"members": {
  "title": "Members",
  "subtitle": "Community member profiles"
},
```

- [ ] **Step 2: Add the same keys to nl.json (translated)**

In `apps/web/locales/nl.json`, after its `"people": { ... }` block:

```json
"members": {
  "memberSince": "Lid sinds {date}",
  "collects": "Verzamelt ~{count, plural, one {# puzzel} other {# puzzels}} op JigSwap",
  "privateTitle": "Het profiel van {name} is privé",
  "privateSub": "Volg elkaar om hun collectie te zien en te ruilen.",
  "joinCta": "Word lid van JigSwap om {name} te volgen",
  "logIn": "Inloggen",
  "shelfTitle": "Uitgelichte plank",
  "bioTitle": "Over",
  "notFoundTitle": "Lid niet gevonden",
  "notFoundSub": "Deze link is mogelijk verouderd, of het lid heeft hun gebruikersnaam gewijzigd.",
  "findPeople": "Mensen vinden",
  "backHome": "Terug naar home"
},
```

And in nl.json's `shell.pages`:

```json
"members": {
  "title": "Leden",
  "subtitle": "Profielen van communityleden"
},
```

- [ ] **Step 3: Mirror en.json into source.json**

`apps/web/locales/source.json` carries the English source strings — add the identical two blocks from Step 1 at the corresponding positions (`members` namespace after `people`; `members` under `shell.pages`).

- [ ] **Step 4: Verify JSON validity**

Run: `node -e "['en','nl','source'].forEach(l => JSON.parse(require('fs').readFileSync('apps/web/locales/'+l+'.json','utf8')) && console.log(l, 'ok'))"`
Expected: `en ok`, `nl ok`, `source ok`.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git add apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git commit -m "feat(web): i18n strings for the public member page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Member page components (teaser, interstitial, full profile)

**Files:**

- Create: `apps/web/src/components/members/member-identity-header.tsx`
- Create: `apps/web/src/components/members/logged-out-teaser.tsx`
- Create: `apps/web/src/components/members/private-interstitial.tsx`
- Create: `apps/web/src/components/members/member-profile-view.tsx`

- [ ] **Step 1: Shared identity header**

Create `apps/web/src/components/members/member-identity-header.tsx`:

```tsx
"use client";

// Shared identity block for every /members/$handle tier: avatar, display name,
// @username (muted mono), member-since — with an optional right-aligned action
// slot (Follow/Message on the full profile; nothing on the teaser).

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFormatter, useTranslations } from "use-intl";

export function MemberIdentityHeader({
  displayName,
  username,
  avatar,
  memberSince,
  location,
  actions,
}: {
  displayName: string;
  username?: string;
  avatar?: string;
  memberSince: number;
  location?: string;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("members");
  const format = useFormatter();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar className="size-20 shrink-0">
        {avatar && <AvatarImage src={avatar} alt={displayName} />}
        <AvatarFallback className="text-2xl">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <h1 className="font-heading truncate text-3xl">{displayName}</h1>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          {username && <span className="font-mono">@{username}</span>}
          <span>
            {t("memberSince", {
              date: format.dateTime(new Date(memberSince), {
                year: "numeric",
                month: "long",
              }),
            })}
          </span>
          {location && <span>{location}</span>}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Logged-out teaser (marketing shell content)**

Create `apps/web/src/components/members/logged-out-teaser.tsx`:

```tsx
"use client";

// The anonymous-visitor view of /members/$handle: identity header (avatar already
// consent-gated server-side), a coarse collection line for public profiles, the
// private-profile card for private ones, and join/log-in CTAs that round-trip
// through Clerk back to this page (redirect_url).

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslations } from "use-intl";

export function LoggedOutTeaser({
  teaser,
  returnToHref,
}: {
  teaser: PublicMemberTeaserView;
  returnToHref: string;
}) {
  const t = useTranslations("members");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12">
      <MemberIdentityHeader
        displayName={teaser.displayName}
        username={teaser.username}
        avatar={teaser.avatar}
        memberSince={teaser.memberSince}
      />

      {teaser.visibility === "public" && teaser.puzzleCount !== null && (
        <p className="text-muted-foreground text-lg">
          {t("collects", { count: teaser.puzzleCount })}
        </p>
      )}

      {teaser.visibility === "private" && (
        <PrivateProfileCard displayName={teaser.displayName} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link
            to="/sign-up/$"
            params={{ _splat: "" }}
            search={{ redirect_url: returnToHref }}
          >
            {t("joinCta", { name: teaser.displayName })}
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link
            to="/sign-in/$"
            params={{ _splat: "" }}
            search={{ redirect_url: returnToHref }}
          >
            {t("logIn")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// The quiet private-profile card (shared shape with the logged-in interstitial):
// full identity above, one sentence of mutuality framing, no blurred-content
// silhouettes — respectful, never a paywall tease.
export function PrivateProfileCard({ displayName }: { displayName: string }) {
  const t = useTranslations("members");
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed p-8 text-center">
      <Lock className="text-muted-foreground h-5 w-5" />
      <p className="font-semibold">
        {t("privateTitle", { name: displayName })}
      </p>
      <p className="text-muted-foreground text-sm">{t("privateSub")}</p>
    </Card>
  );
}
```

- [ ] **Step 3: Logged-in private interstitial**

Create `apps/web/src/components/members/private-interstitial.tsx`:

```tsx
"use client";

// Logged-in, non-mutual view of a private member: full identity header (the
// person feels present, not withheld) + the quiet private card + the follow
// action. Phase 1 keeps today's instant follow; the request-to-follow flow
// replaces this button in Phase 2. No Message button — messaging is
// connection-gated anyway.

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { PrivateProfileCard } from "@/components/members/logged-out-teaser";
import { FollowButton } from "@/components/social/follow-button";
import { Id } from "@/gateway";
import type { PublicMemberTeaserView } from "@jigswap/contracts";

export function PrivateInterstitial({
  teaser,
}: {
  teaser: PublicMemberTeaserView;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <MemberIdentityHeader
        displayName={teaser.displayName}
        username={teaser.username}
        avatar={teaser.avatar}
        memberSince={teaser.memberSince}
      />
      <PrivateProfileCard displayName={teaser.displayName} />
      <div className="flex justify-center">
        <FollowButton memberId={teaser.memberId as Id<"users">} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Full profile view**

Create `apps/web/src/components/members/member-profile-view.tsx`:

```tsx
"use client";

// Full member profile for viewers the privacy gate admits (public profile, or
// mutual follower): identity header with Follow/Message, the people-hub stat
// row, the curated featured shelf (hidden when uncurated), and the bio.
// All reads are the existing privacy-gated identity/social queries.

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { FollowButton } from "@/components/social/follow-button";
import { MessageButton } from "@/components/social/message-button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import type { MemberView } from "@jigswap/contracts";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useTranslations } from "use-intl";

export function MemberProfileView({ member }: { member: MemberView }) {
  const t = useTranslations("members");
  const tPeople = useTranslations("people");
  const memberId = member._id as Id<"users">;

  const { data: profile } = useQuery(
    convexQuery(gateway.social.profile, { memberId }),
  );
  const { data: stats } = useQuery(
    convexQuery(gateway.identity.userStats, { userId: memberId }),
  );
  const { data: shelf } = useQuery(
    convexQuery(gateway.social.featuredShelf, { userId: memberId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <MemberIdentityHeader
        displayName={profile?.displayName ?? member.name}
        username={member.username}
        avatar={member.avatar}
        memberSince={member.createdAt}
        location={member.location}
        actions={
          <>
            <FollowButton memberId={memberId} />
            <MessageButton memberId={memberId} />
          </>
        }
      />

      {stats === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : stats === null ? null : (
        <div className="grid grid-cols-3 divide-x rounded-lg border">
          <StatCell value={stats.puzzlesOwned} label={tPeople("ownedLabel")} />
          <StatCell
            value={stats.tradesCompleted}
            label={tPeople("swapsLabel")}
          />
          <div className="flex flex-col items-center gap-0.5 p-4">
            <span className="inline-flex items-center gap-1 text-xl font-bold">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {stats.totalReviews > 0 ? stats.averageRating.toFixed(1) : "–"}
            </span>
          </div>
        </div>
      )}

      {shelf && shelf.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl">{t("shelfTitle")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shelf.map((copy) => (
              <Card key={copy._id} className="overflow-hidden p-0">
                {copy.coverUrl ? (
                  <img
                    src={copy.coverUrl}
                    alt={copy.puzzle?.title ?? copy.snapshot?.title ?? ""}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="bg-muted aspect-square w-full" />
                )}
                <p className="truncate p-2 text-sm font-medium">
                  {copy.puzzle?.title ?? copy.snapshot?.title}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {member.bio && (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-xl">{t("bioTitle")}</h2>
          <p className="text-muted-foreground whitespace-pre-wrap">
            {member.bio}
          </p>
        </section>
      )}
    </div>
  );
}

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 p-4">
      <span className="text-xl font-bold">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}
```

Note: `OwnedCopyView.coverUrl` exists on the contract (resolved cover photo or box art — see `packages/contracts/src/library/views.ts:52`). If the type-check in Task 5 flags it as optional-null, render exactly as written (`copy.coverUrl ?` handles both).

- [ ] **Step 5: Type-check (expect route errors only)**

Run: `pnpm nx type-check web --skip-nx-cache`
Expected: no errors in the four new component files. (Note the known noise: `routeTree.gen.ts` churn appears in web type-check output when routes change — ignore only that file's diffs, never real type errors.)

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write apps/web/src/components/members/
git add apps/web/src/components/members/
git commit -m "feat(web): member page tier components (teaser, interstitial, full profile)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The `/members/$handle` route

**Files:**

- Create: `apps/web/src/routes/members.$handle.tsx`
- Modify: `apps/web/src/components/dashboard-layout/route-meta.ts` (ROUTE_META map, community section around line 164)

- [ ] **Step 1: Add the shell route-meta entries**

In `apps/web/src/components/dashboard-layout/route-meta.ts`, in the Community section of `ROUTE_META` (after the `"/people"` entry), add:

```ts
  // Public member profile: nav-highlights Community for signed-in viewers; the
  // anonymous tier renders the marketing shell instead (no shell meta needed).
  "/members": { pageKey: "members", group: "community" },
  "/members/$handle": { pageKey: "members", group: "community" },
```

- [ ] **Step 2: Create the route**

Create `apps/web/src/routes/members.$handle.tsx`:

```tsx
import { LoggedOutTeaser } from "@/components/members/logged-out-teaser";
import { PrivateInterstitial } from "@/components/members/private-interstitial";
import { MemberProfileView } from "@/components/members/member-profile-view";
import { DashboardShell } from "@/components/dashboard-layout/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Navigate,
  notFound,
  redirect,
  useRouteContext,
} from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// The canonical member page (spec Phase 1): one URL for every viewer tier.
// Standalone route — OUTSIDE _dashboard (its beforeLoad requires auth) and
// outside _public (signed-in members get the dashboard shell instead), exactly
// like the public home route. Handle resolution and the strictly-limited
// anonymous payload live server-side in social/getPublicMemberTeaser.
export const Route = createFileRoute("/members/$handle")({
  // `invite` is tolerated (and preserved through the canonical redirect) so
  // Phase 3 QR/share links keep working; Phase 1 does not consume it.
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: async ({ context, params, deps }) => {
    const teaser = await context.queryClient.ensureQueryData(
      convexQuery(gateway.social.publicMemberTeaser, {
        handle: params.handle,
      }),
    );
    if (!teaser) throw notFound();
    // Canonical display URL is the username; id URLs (QR/share links) redirect.
    if (teaser.username && teaser.username !== params.handle) {
      throw redirect({
        to: "/members/$handle",
        params: { handle: teaser.username },
        search: deps.invite ? { invite: deps.invite } : {},
        replace: true,
      });
    }
    return { teaser };
  },
  // head runs after the loader on the SSR pass, which is the pass crawlers
  // see — so the private-profile noindex is reliably in the served HTML.
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.teaser
          ? `${loaderData.teaser.displayName} — JigSwap`
          : "JigSwap",
      },
      ...(loaderData?.teaser?.visibility === "private"
        ? [{ name: "robots", content: "noindex" }]
        : []),
    ],
  }),
  pendingComponent: () => <PageLoading message="Loading member..." />,
  notFoundComponent: MemberNotFound,
  component: MemberPage,
});

function MemberPage() {
  const { userId } = useRouteContext({ from: "__root__" });
  const { handle } = Route.useParams();
  const { invite } = Route.useSearch();
  const { data: teaser } = useQuery(
    convexQuery(gateway.social.publicMemberTeaser, { handle }),
  );

  if (!teaser) return <PageLoading message="Loading member..." />;

  if (!userId) {
    const returnToHref = `/members/${handle}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    return (
      <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
        <MarketingHeader />
        <main>
          <LoggedOutTeaser teaser={teaser} returnToHref={returnToHref} />
        </main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <DashboardShell>
      <AuthedMemberPage
        memberId={teaser.memberId as Id<"users">}
        teaser={teaser}
      />
    </DashboardShell>
  );
}

function AuthedMemberPage({
  memberId,
  teaser,
}: {
  memberId: Id<"users">;
  teaser: NonNullable<
    Awaited<ReturnType<NonNullable<typeof Route.options.loader>>>
  >["teaser"];
}) {
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  // Privacy-gated tier discriminator: getUserById returns null for a private
  // non-mutual target (and only then, for an existing active member).
  const { data: member } = useQuery(
    convexQuery(gateway.identity.byId, { userId: memberId }),
  );

  if (me === undefined || member === undefined) {
    return <PageLoading message="Loading member..." />;
  }
  // Own handle -> the single own-profile surface.
  if (me && me._id === memberId) {
    return <Navigate to="/profile" replace />;
  }
  if (member === null) {
    return <PrivateInterstitial teaser={teaser} />;
  }
  return <MemberProfileView member={member} />;
}

function MemberNotFound() {
  const { userId } = useRouteContext({ from: "__root__" });
  const t = useTranslations("members");
  const body = (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="font-heading text-2xl">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("notFoundSub")}</p>
      {userId ? (
        <Button asChild>
          <Link to="/people">{t("findPeople")}</Link>
        </Button>
      ) : (
        <Button asChild>
          <Link to="/">{t("backHome")}</Link>
        </Button>
      )}
    </div>
  );
  if (userId) return body;
  return (
    <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
      <MarketingHeader />
      <main>{body}</main>
      <MarketingFooter />
    </div>
  );
}
```

Implementation note for the `AuthedMemberPage` teaser prop type: if the `Awaited<ReturnType<...>>` expression fights the router's generics, replace it with the plain contract type `PublicMemberTeaserView` (imported from `@jigswap/contracts`) — it is the same shape and is the fallback of record, not a placeholder.

- [ ] **Step 3: Type-check + route tree regeneration**

Run: `pnpm nx type-check web --skip-nx-cache`
Expected: success. The dev server (or `vite build`) regenerates `routeTree.gen.ts` with the new route; if type-check complains the route is missing from the tree, run `pnpm nx dev web` briefly (it runs on port 3001) or `pnpm nx build web --skip-nx-cache` once, then re-run type-check.

- [ ] **Step 4: Manual smoke check (dev server)**

Run: `pnpm nx dev web` (serves on http://localhost:3001; no browser automation available in this environment — check with curl):

- `curl -s http://localhost:3001/members/<a-real-username> | grep -o "<title>[^<]*"` → the member's display name.
- `curl -s http://localhost:3001/members/<a-private-member-handle> | grep -c 'name="robots" content="noindex"'` → `1`.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/members/definitely-not-a-member` → 200 with the not-found body (TanStack renders notFound in-page; verify `grep -c "Member not found"` → 1).

Expected: all three behave as listed. If no dev deployment/seed data is available, note the skipped check in the commit body instead of faking it.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/routes/members.\$handle.tsx apps/web/src/components/dashboard-layout/route-meta.ts
git add apps/web/src/routes/members.\$handle.tsx apps/web/src/components/dashboard-layout/route-meta.ts apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /members/\$handle route with teaser, interstitial and full-profile tiers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Integration — ⌘K search links and MemberTile names

**Files:**

- Modify: `packages/backend/convex/search/globalSearch.ts:91` (the `href: "/people"` placeholder)
- Modify: `apps/web/src/components/social/member-tile.tsx:65` (name span)

- [ ] **Step 1: Point ⌘K People results at the member page**

In `packages/backend/convex/search/globalSearch.ts`, replace (inside the people loop, currently `href: "/people",`):

```ts
        href: "/people",
```

with:

```ts
        // Canonical member page; username-first, id fallback (matches the
        // /members/$handle resolution rules).
        href: `/members/${u.username ?? u._id}`,
```

- [ ] **Step 2: Run the existing globalSearch tests (regression)**

Run (from `packages/backend`): `pnpm exec vitest run convex/globalSearch.test.ts`
Expected: PASS (the suite does not assert the placeholder href; if an assertion does fail on the new href, update that expectation to the new `/members/...` value — the behavior change is the point of this task).

- [ ] **Step 3: Link the MemberTile name**

In `apps/web/src/components/social/member-tile.tsx`:

Add to the imports:

```tsx
import { Link } from "@tanstack/react-router";
```

Replace:

```tsx
<span className="truncate text-base font-bold">{member.name}</span>
```

with:

```tsx
<Link
  to="/members/$handle"
  params={{ handle: member.username ?? member._id }}
  className="truncate text-base font-bold hover:underline"
>
  {member.name}
</Link>
```

- [ ] **Step 4: Type-check both projects**

Run: `pnpm nx type-check web --skip-nx-cache && pnpm nx type-check @jigswap/backend --skip-nx-cache`
Expected: success.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex/search/globalSearch.ts apps/web/src/components/social/member-tile.tsx
git add packages/backend/convex/search/globalSearch.ts apps/web/src/components/social/member-tile.tsx
git commit -m "feat(web): link search results and member tiles to /members/\$handle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend test suite**

Run (from `packages/backend`): `pnpm exec vitest run`
Expected: all suites PASS, including the new `publicMemberTeaser.test.ts`.

- [ ] **Step 2: Workspace type-check + lint + format, CI-faithful**

Run (from repo root):

```bash
pnpm nx run-many --target=type-check --all --skip-nx-cache
pnpm nx run-many --target=lint --all --skip-nx-cache
pnpm format:check
```

Expected: all green. Fix anything that fails before proceeding (formatting failures: `pnpm format`).

- [ ] **Step 3: Verify the spec's Phase 1 acceptance behaviors**

Re-run the Task 5 Step 4 curl checks, plus:

- Signed-in flows need a browser session; verify via the dev server manually if available, otherwise confirm behavior through the backend tests (tier gating is server-side in `getUserById`/`getPublicMemberTeaser`, both covered).
- Confirm the ⌘K palette (signed-in) navigates a People hit to the member page.

Report honestly which checks ran and which were not runnable in the environment.

---

## Self-review (completed at authoring time)

- **Spec coverage:** route + handle rules + canonical redirect + self-redirect (Task 5), teaser payload limits + consent-gated avatar + coarse count (Task 2), all three viewer tiers (Tasks 4–5), noindex for private teasers (Task 5 head), `?invite=` tolerated and preserved (Task 5), ⌘K + MemberTile integration (Task 6), i18n en/nl/source (Task 3), leak-assertion tests (Task 2). Out of Phase-1 scope by design: follow requests (Phase 2), QR (Phase 3).
- **Placeholder scan:** no TBDs; every code step carries full code; the one intentional fallback (teaser prop typing in Task 5) names its exact replacement type.
- **Type consistency:** `getPublicMemberTeaser` / `gateway.social.publicMemberTeaser` / `PublicMemberTeaserView` used identically across Tasks 1, 2, 4, 5; `MemberIdentityHeader`, `PrivateProfileCard`, `LoggedOutTeaser`, `PrivateInterstitial`, `MemberProfileView` names match between definition (Task 4) and use (Task 5).
