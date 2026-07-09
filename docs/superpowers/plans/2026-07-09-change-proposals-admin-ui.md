# Puzzle Change Proposals — Admin Review UI Implementation Plan (PR 3 of 3, stacked)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PR 3 of the approved spec (`docs/superpowers/specs/2026-07-08-puzzle-definition-change-proposals-design.md`): the admin side of change proposals — a pending-proposals queue with conflict badges, a per-proposal review screen (per-field current→proposed diff, baseline shown on conflicting fields, images side-by-side, approve / decline-with-reason), a proposals history section on the admin definition detail page, and **direct admin editing** of definitions via the existing `updatePuzzleDefinition` mutation, now stamping a new `definition_edited` moderation-action kind when an admin edits someone else's definition — stacked on `feat/change-proposals-member-ui` (PR #43).

**Architecture:** Pure consumption of the PR-1 backend reads/mutations (`gateway.admin.listPendingChangeProposals` / `listProposalsForDefinition`, `gateway.catalog.approveChangeProposal` / `rejectChangeProposal` / `updatePuzzle`) — the ONLY backend change is the `definition_edited` stamp in `updatePuzzleDefinition` (+ kind unions). The member suggest-edit form's field JSX is extracted into a shared `PuzzleDefinitionFields` component so the admin direct-edit page reuses it with the same `proposal-diff` helper (its args shape matches `updatePuzzleDefinition` exactly). The review screen's diff rows come from a small pure `field-diff` helper (unit-tested per web convention). Routes follow the directory conventions established in PR 2 (`$puzzleId/` becomes a directory; `proposals/` gets index + `$proposalId`). One deliberate deviation from the spec's wording: the queue is a sibling ROUTE (`/admin/puzzles/proposals`, linked from the puzzles console header with a pending count) rather than a literal tab — the admin puzzles index has no tab structure, and a dedicated URL gives the review screen a natural parent.

**Tech Stack:** TanStack Router/Query via `@convex-dev/react-query`, shadcn ui (Badge/Button/Dialog/AlertDialog/Textarea), use-intl EN/NL, vitest (node env, pure helpers only), convex-test for the backend stamp.

---

## Executor setup & non-negotiable constraints

- [ ] **The worktree already exists** — work in `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/change-proposals-admin-ui`, branch `feat/change-proposals-admin-ui`, branched from `feat/change-proposals-member-ui` at `517e77bc4`. Do NOT create a new worktree; do NOT touch the PR-1/PR-2 worktrees. Run `pnpm install --frozen-lockfile` once before Task 1.
- [ ] First commit: this plan. `git add docs/superpowers/plans/2026-07-09-change-proposals-admin-ui.md && git commit -m "docs: change-proposals admin-ui plan (PR 3)"`

**STACKED-PR RULES:** Base is `feat/change-proposals-member-ui`; never rebase onto `main`; the eventual PR targets that base (`gh pr create --base feat/change-proposals-member-ui`, controller does it). The controller handles base-branch updates.

**routeTree caveat:** `apps/web/src/routeTree.gen.ts` is gitignored and absent in a fresh worktree. Running the web vitest suite once (vite-based) regenerates it; after that `pnpm --filter @jigswap/web exec tsc --noEmit` should be FULLY clean. If it did not regenerate, tolerate ONLY the documented `createFileRoute`-pattern noise (one error per route file + `router.tsx`/`routes/index.tsx`), nothing else. Task 3 moves `admin/puzzles/$puzzleId.tsx` into a directory — hand-write the new `createFileRoute(...)` path strings exactly as specified; never edit `routeTree.gen.ts` by hand and never commit it.

**Scope guardrails (embed in every review):**

- Backend changes are ONLY: `schema.ts` `moderationActions.kind` + `admin/stampModerationAction.ts` (one literal each), `catalog/updatePuzzleDefinition.ts` (the stamp), and one backend test file. No domain-package changes, no new Convex functions, NO `_generated/api.d.ts` edits (no new function modules).
- The stamp fires ONLY when an admin edits a definition they did not submit; submitter self-edits stay un-audited (spec: "submitter self-edits stay un-audited, as today").
- The suggest-edit extraction (Task 2) is behavior-identical — the member flow must not change (web tests stay green, no locale changes in that task).
- Reuse `forms.puzzle-form.*` labels and the existing `suggestEdit.replaceImage`/`currentImage` keys; new namespaces: `admin.proposals`, `admin.puzzles.edit`, two `admin.puzzles.detail.*` keys, one `admin.moderation.activity.definition_edited` entry.

**Baselines:** web 113 tests / backend 582 / domain 1087; all suites green at `517e77bc4`.

**Test commands:** web `pnpm --filter @jigswap/web exec vitest run`; backend `pnpm --filter @jigswap/backend exec vitest run`; sweep (Task 7) `pnpm exec nx run-many -t type-check|test|lint --skip-nx-cache` + `pnpm exec prettier --check .`. Prettier every changed file before each commit.

---

### Task 1 — Backend: `definition_edited` audit stamp (TDD) + Activity Log rendering

**Files:**

- Modify: `packages/backend/convex/schema.ts` (`moderationActions.kind` union)
- Modify: `packages/backend/convex/admin/stampModerationAction.ts` (`ModerationKind`)
- Modify: `packages/backend/convex/catalog/updatePuzzleDefinition.ts` (stamp)
- Modify: `packages/backend/convex/catalogMutations.test.ts` (2 new tests)
- Modify: `apps/web/src/components/admin/moderation/activity-log.tsx` (`KIND_META` — the exhaustive Record forces this at type-check time)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (`admin.moderation.activity.definition_edited`)

**Steps:**

- [ ] Write the failing tests. In `packages/backend/convex/catalogMutations.test.ts`, read the file first: its `describe("catalog.updatePuzzleDefinition", ...)` block (~line 288) runs as the submitter (`asAlice`). Reuse its existing helpers (seed/identity/submit helpers as named IN THAT FILE — read them, don't assume). If it lacks an admin identity helper, add one mirroring `changeProposals.test.ts`'s `asAdmin` (same clerk subject with `metadata: { role: "admin" }`) and a second member (`bob`) if needed. Append to that describe:

```ts
test("an admin editing someone else's definition stamps definition_edited with the post-edit title", async () => {
  const t = convexTest(schema, modules);
  // Seed: bob submits; admin (a DIFFERENT member) edits.
  // Use this file's existing seeding helpers; the admin identity must NOT be the submitter.
  // (Mirror changeProposalDecisions.test.ts: seedMembers gives alice+bob; asBob submits,
  //  asAdmin — alice with role admin — edits.)
  const { alice } = await seedMembers(t);
  const id = await asBob(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );

  await asAdmin(t).mutation(
    api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
    { puzzleDefinitionId: id as string, title: "Mountain Vista II" },
  );

  const actions = await t.run((ctx) =>
    ctx.db.query("moderationActions").collect(),
  );
  const stamp = actions.find((a) => a.kind === "definition_edited");
  expect(stamp).toMatchObject({
    actorId: alice,
    targetId: id,
    targetLabel: "Mountain Vista II", // post-edit title, matching the sibling stamps' convention
  });
});

test("a submitter self-edit does NOT stamp definition_edited", async () => {
  const t = convexTest(schema, modules);
  await seedMembers(t);
  const id = await asBob(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );

  await asBob(t).mutation(
    api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
    { puzzleDefinitionId: id as string, title: "Renamed By Owner" },
  );

  const actions = await t.run((ctx) =>
    ctx.db.query("moderationActions").collect(),
  );
  expect(actions.some((a) => a.kind === "definition_edited")).toBe(false);
});
```

If `catalogMutations.test.ts`'s existing helpers differ (e.g. it has only one seeded member), add the minimal helpers (copied verbatim from `changeProposalDecisions.test.ts`) rather than restructuring existing tests.

- [ ] Run and watch the first test fail: `pnpm --filter @jigswap/backend exec vitest run convex/catalogMutations.test.ts` — expected failure: schema validation rejects `"definition_edited"` isn't possible yet (the find returns undefined → `toMatchObject` fails).
- [ ] Add the kind. In `packages/backend/convex/schema.ts`, `moderationActions.kind` union — after `v.literal("definition_reenabled"),` add:

```ts
      v.literal("definition_edited"),
```

In `packages/backend/convex/admin/stampModerationAction.ts`, add `| "definition_edited"` to `ModerationKind` at the same relative position.

- [ ] Add the stamp. In `packages/backend/convex/catalog/updatePuzzleDefinition.ts`: the handler already computes `actingMember`, `existing`, and `submittedBy` for the ownership ACL. Capture the branch before running the update, and stamp after success, mirroring `approvePuzzleDefinition.ts` (post-action row re-read for the label):

```ts
// An admin editing someone ELSE's definition is a moderation act; stamp it after success.
// Submitter self-edits stay un-audited (unchanged behavior). The ACL above already
// guaranteed that a non-submitter actor IS an admin.
const isAdminEditingOthers =
  submittedBy !== (actingMember as unknown as string);
```

(place it right after the ACL block), and after the `if (result.isErr) throw toConvexError(result.error);` line:

```ts
if (isAdminEditingOthers) {
  const row = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", args.puzzleDefinitionId),
    )
    .unique();
  await stampModerationAction(ctx, {
    actorId: actingMember as unknown as Id<"users">,
    kind: "definition_edited",
    targetLabel: row?.title ?? args.puzzleDefinitionId,
    targetId: args.puzzleDefinitionId,
  });
}
```

Add the imports the file lacks: `import { stampModerationAction } from "../admin/stampModerationAction";` and `import type { Id } from "../_generated/dataModel";`.

- [ ] Run the two tests — PASS. Full backend suite: `pnpm --filter @jigswap/backend exec vitest run` — expected 582 + 2 = 584.
- [ ] Web `KIND_META` (type-check forces it): in `apps/web/src/components/admin/moderation/activity-log.tsx`, add to the exhaustive record, after `definition_reenabled`, mirroring the tone conventions in the file (read it; the pair shape is `[LucideIcon, toneClass]`):

```ts
  definition_edited: [Pencil, "text-muted-foreground"],
```

(import `Pencil` from `lucide-react` if not already imported; if the file uses a different neutral tone for non-judgemental actions — check `definition_reenabled`'s tone — match THAT convention instead of the literal above and note it.)

- [ ] Locale keys: in all three locale files, inside `admin.moderation.activity`, after `definition_reenabled`:
  - en + source: `"definition_edited": "<strong>{actor}</strong> edited <strong>{target}</strong>",`
  - nl: `"definition_edited": "<strong>{actor}</strong> bewerkte <strong>{target}</strong>",`
- [ ] Verify: backend suite 584; `pnpm --filter @jigswap/web exec vitest run` 113; web tsc clean (see routeTree caveat); JSON parse check on the three locales.
- [ ] Prettier; commit: `git add -A && git commit -m "feat(backend): stamp definition_edited when an admin edits another member's definition"`

---

### Task 2 — Extract shared `PuzzleDefinitionFields` from the suggest-edit form (behavior-identical refactor)

**Files:**

- Create: `apps/web/src/components/suggest-edit/definition-fields.tsx`
- Modify: `apps/web/src/routes/_dashboard/puzzles/$id/suggest-edit.tsx`

The member form's field JSX (everything from the first `SectionDivider` through the image-replace control — NOT the header, comment, or footer) moves into a shared controlled component so Task 3's admin edit page reuses it. No locale changes, no behavior changes.

**Steps:**

- [ ] Read `apps/web/src/routes/_dashboard/puzzles/$id/suggest-edit.tsx` in full. Create `apps/web/src/components/suggest-edit/definition-fields.tsx` exporting:

```tsx
import {
  DIFFICULTY_OPTIONS,
  PieceCountField,
  SectionDivider,
  SegmentedPills,
  TagInput,
} from "@/components/add-puzzle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useTranslations } from "use-intl";
import type { ProposalFormState } from "./proposal-diff";

// The controlled field set for editing a puzzle definition, shared by the member
// suggest-edit form and the admin direct-edit form. Pure presentation: all state lives in
// the caller's ProposalFormState; labels come from the existing forms.puzzle-form namespace
// (plus suggestEdit.replaceImage for the image control). The difficulty/shape pills are
// SEEDED with the definition's current value for display, but only onChange writes form
// state — an untouched pill therefore never produces a diff.
export interface PuzzleDefinitionFieldsProps {
  form: ProposalFormState;
  set: <K extends keyof ProposalFormState>(
    key: K,
    value: ProposalFormState[K],
  ) => void;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
  difficultySeed: ProposalFormState["difficulty"];
  shapeSeed: ProposalFormState["shape"];
  currentImageUrl: string | undefined;
  imageStateLabel: string;
  onPickFile: (file: File | undefined) => void;
  idPrefix: string; // "se" (member) / "ae" (admin) — keeps htmlFor/id unique per page
}

const SHAPE_VALUES = ["rectangular", "panoramic", "round", "shaped"] as const;

export function PuzzleDefinitionFields({ ... }: PuzzleDefinitionFieldsProps) {
  ...
}
```

The body is MOVED VERBATIM from `suggest-edit.tsx`'s `SuggestEditForm` return value: everything from `<SectionDivider label={tf("formTitle")} />` through the image-replace block (`<SectionDivider label={tf("image.label")} />` + preview + Replace button), with these mechanical substitutions:

- `form.X` stays; `set(...)` stays (now the prop).
- Every `id="se-..."` / `htmlFor="se-..."` becomes ``id={`${idPrefix}-...`}`` / ``htmlFor={`${idPrefix}-...`}`` (title, description, brand, pieces, artist, series, ean, upc, model, category).
- The difficulty pill seed `form.difficulty || view.difficulty || "medium"` becomes `form.difficulty || difficultySeed || "medium"`; shape likewise with `shapeSeed` and `"rectangular"`.
- The image block's `currentImageUrl` and state label come from the `currentImageUrl` / `imageStateLabel` props; the file input's onChange calls `onPickFile(e.target.files?.[0])`; the Replace-image button keeps `useTranslations("suggestEdit")`'s `t("replaceImage")` (declare `const t = useTranslations("suggestEdit");` inside the component alongside `tf = useTranslations("forms.puzzle-form")` and `useLocale()` for the category name).
- The category-name helper (`locale === "nl" ? c.name.nl : c.name.en`) moves in with it.

- [ ] Rewrite `SuggestEditForm` in `suggest-edit.tsx` to render `<PuzzleDefinitionFields form={form} set={set} categories={categories} difficultySeed={view.difficulty ?? ""} shapeSeed={view.shape ?? ""} currentImageUrl={currentImageUrl} imageStateLabel={coverFile || form.newImageStorageId ? t("proposedImage") : t("currentImage")} onPickFile={setCoverFile} idPrefix="se" />` between its header and the comment section, deleting the moved JSX and now-unused imports (the add-puzzle components, Select, Input, Label — keep Textarea for the comment; keep everything the remaining code uses). The header, comment `SectionDivider` + Textarea, footer buttons, mutations, and all state stay in `suggest-edit.tsx` untouched.
- [ ] Verify behavior-identical: `pnpm --filter @jigswap/web exec vitest run` — 113 passing; web tsc clean; `git diff --stat` shows only the two files.
- [ ] Prettier; commit: `git add -A && git commit -m "refactor(web): extract shared PuzzleDefinitionFields from suggest-edit"`

---

### Task 3 — Admin detail route → directory + direct-edit page

**Files:**

- Move: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId.tsx` → `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx`
- Create: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/edit.tsx`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (`admin.puzzles.edit` namespace)

**Steps:**

- [ ] `git mv 'apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId.tsx' 'apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx'` (mkdir the directory first if `git mv` complains). In the moved file, change the registration to `createFileRoute("/_dashboard/admin/puzzles/$puzzleId/")` (trailing slash). Nothing else changes in this step.
- [ ] Add the Edit action in the moved file's header action area (the `<div className="flex shrink-0 items-center">` currently holding only `<PuzzleLifecycleAction .../>`), BEFORE the lifecycle action, using the file's existing `t = useTranslations("admin.puzzles")` and `Link` conventions (check whether the file uses `@/compat/link` or router navigation — mirror it; extend the lucide import with `Pencil`):

```tsx
<Button variant="outline" size="sm" asChild>
  <Link href={`/admin/puzzles/${puzzleId}/edit`}>
    <Pencil className="h-4 w-4" />
    {t("edit.button")}
  </Link>
</Button>
```

(add the `Button` import if absent; wrap the two actions in `gap-2` on the container: `className="flex shrink-0 items-center gap-2"`.)

- [ ] Add the `admin.puzzles.edit` namespace inside `admin.puzzles` (after `"loadMore"`), en + source:

```json
    "edit": {
      "button": "Edit",
      "title": "Edit definition",
      "subtitle": "Direct edit of “{title}”. Changes apply immediately and are audit-logged.",
      "save": "Save changes",
      "saving": "Saving…",
      "saved": "Definition updated",
      "noChanges": "Change at least one field",
      "failed": "Couldn't save the definition",
      "cancel": "Cancel"
    },
```

nl:

```json
    "edit": {
      "button": "Bewerken",
      "title": "Definitie bewerken",
      "subtitle": "Directe bewerking van “{title}”. Wijzigingen gelden direct en worden gelogd.",
      "save": "Wijzigingen opslaan",
      "saving": "Opslaan…",
      "saved": "Definitie bijgewerkt",
      "noChanges": "Wijzig minstens één veld",
      "failed": "Definitie opslaan mislukt",
      "cancel": "Annuleren"
    },
```

- [ ] Create `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/edit.tsx` — the admin direct-edit page. Structure mirrors the member suggest-edit page minus the proposal machinery (no open-proposal lookup, no comment field); it diffs against a frozen baseline and submits the changed fields to `gateway.catalog.updatePuzzle`. Full implementation:

```tsx
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { PuzzleDefinitionFields } from "@/components/suggest-edit/definition-fields";
import {
  buildProposalArgs,
  formFromView,
} from "@/components/suggest-edit/proposal-diff";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute(
  "/_dashboard/admin/puzzles/$puzzleId/edit",
)({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminEditPage,
});

type ViewData = NonNullable<
  FunctionReturnType<typeof gateway.catalog.puzzleById>
>;

function AdminEditPage() {
  const { puzzleId } = Route.useParams();
  const t = useTranslations("admin.puzzles");

  // puzzleById discloses non-approved definitions to admins, so this works for any status.
  const { data: view } = useQuery(
    convexQuery(gateway.catalog.puzzleById, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const { data: categories } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  if (view === undefined || categories === undefined) {
    return <PageLoading message={t("edit.title")} />;
  }
  if (view === null || !view.aggregateId) {
    return (
      <EmptyState
        title={t("detail.notFoundTitle")}
        sub={t("detail.notFound")}
      />
    );
  }
  return <AdminEditForm view={view} categories={categories} />;
}

function AdminEditForm({
  view,
  categories,
}: {
  view: ViewData;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
}) {
  const { puzzleId } = Route.useParams();
  const router = useRouter();
  const t = useTranslations("admin.puzzles");
  const tSuggest = useTranslations("suggestEdit");

  // Frozen diff baseline (same rationale as the member form): a concurrent change to the
  // definition must not turn untouched fields into diffs.
  const [baseline] = useState(() => view);
  const [form, setForm] = useState(() => formFromView(baseline));
  const [coverFile, setCoverFile] = useState<File | undefined>(undefined);

  const coverPreview = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : undefined),
    [coverFile],
  );
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const updatePuzzle = useConvexMutation(gateway.catalog.updatePuzzle);

  const pendingArgs = buildProposalArgs(baseline, form, categories);
  const canSubmit = pendingArgs !== null || coverFile !== undefined;

  const submit = useMutation({
    mutationFn: async () => {
      let imageId = form.newImageStorageId;
      if (coverFile) {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": coverFile.type },
          body: coverFile,
        });
        if (!res.ok) throw new Error("Image upload failed");
        const { storageId } = (await res.json()) as { storageId: string };
        imageId = storageId;
      }
      const args = buildProposalArgs(
        baseline,
        { ...form, newImageStorageId: imageId },
        categories,
      );
      if (!args) return;
      await updatePuzzle({
        puzzleDefinitionId: view.aggregateId!,
        ...args,
      });
    },
    onSuccess: () => {
      toast.success(t("edit.saved"));
      router.push(`/admin/puzzles/${puzzleId}`);
    },
    onError: () => {
      toast.error(t("edit.failed"));
    },
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("edit.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("edit.subtitle", { title: view.title })}
        </p>
      </div>

      <PuzzleDefinitionFields
        form={form}
        set={set}
        categories={categories}
        difficultySeed={view.difficulty ?? ""}
        shapeSeed={view.shape ?? ""}
        currentImageUrl={coverPreview ?? view.image ?? undefined}
        imageStateLabel={
          coverFile ? tSuggest("proposedImage") : tSuggest("currentImage")
        }
        onPickFile={setCoverFile}
        idPrefix="ae"
      />

      <div className="flex items-center justify-end gap-2">
        {!canSubmit && (
          <span className="text-muted-foreground text-sm">
            {t("edit.noChanges")}
          </span>
        )}
        <Button variant="outline" asChild>
          <Link href={`/admin/puzzles/${puzzleId}`}>{t("edit.cancel")}</Link>
        </Button>
        <Button
          variant="brand"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? t("edit.saving") : t("edit.save")}
        </Button>
      </div>
    </div>
  );
}
```

(If `view.image` is typed `string | null`, the `?? undefined` normalization above handles it — keep it here since `image` on this DTO is `string | null`, unlike the member page's chain.)

- [ ] Verify: web vitest 113; web tsc clean; JSON parses. Manually sanity-check the moved detail route still registers (`grep createFileRoute apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx`).
- [ ] Prettier; commit: `git add -A && git commit -m "feat(web): admin direct-edit page for puzzle definitions"`

---

### Task 4 — Pure `field-diff` helper for the review screen (TDD)

**Files:**

- Create: `apps/web/src/components/admin/proposals/field-diff.ts`
- Create: `apps/web/src/components/admin/proposals/field-diff.test.ts`

**Steps:**

- [ ] Write the failing test. Create `apps/web/src/components/admin/proposals/field-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fieldDiffRows } from "./field-diff";

describe("fieldDiffRows", () => {
  it("emits one row per defined change, pairing proposed with current/baseline and conflict flag", () => {
    const rows = fieldDiffRows({
      changes: { title: "New", pieceCount: 500, brand: undefined },
      baseline: { title: "Old", pieceCount: 1000 },
      current: { title: "Renamed Meanwhile", pieceCount: 1000 },
      conflictFields: ["title"],
    });
    expect(rows).toEqual([
      {
        key: "title",
        proposed: "New",
        current: "Renamed Meanwhile",
        baseline: "Old",
        conflict: true,
      },
      {
        key: "pieceCount",
        proposed: 500,
        current: 1000,
        baseline: 1000,
        conflict: false,
      },
    ]);
  });

  it("keeps grouped/object values intact (barcodes, dimensions, tags)", () => {
    const rows = fieldDiffRows({
      changes: {
        barcodes: { ean: "4006381333931" },
        tags: ["a", "b"],
        dimensions: { width: 70, height: 50, unit: "cm" },
      },
      baseline: { barcodes: {}, tags: [], dimensions: undefined },
      current: { barcodes: {}, tags: [], dimensions: undefined },
      conflictFields: [],
    });
    expect(rows.map((r) => r.key)).toEqual(["barcodes", "tags", "dimensions"]);
    expect(rows[0].proposed).toEqual({ ean: "4006381333931" });
    expect(rows[2].current).toBeUndefined();
  });

  it("returns [] for an empty diff", () => {
    expect(
      fieldDiffRows({
        changes: {},
        baseline: {},
        current: {},
        conflictFields: [],
      }),
    ).toEqual([]);
  });
});
```

- [ ] Run it — module-resolution failure expected.
- [ ] Create `apps/web/src/components/admin/proposals/field-diff.ts`:

```ts
// Pure mapping from an enriched change-proposal row (changes/baseline/current snapshots in
// the same field shape + derived conflictFields) to display rows for the admin review
// screen. Rendering/formatting stays in the component; this only pairs the values.

export interface FieldDiffRow {
  key: string;
  proposed: unknown;
  current: unknown;
  baseline: unknown;
  conflict: boolean;
}

export interface EnrichedDiffSource {
  changes: Record<string, unknown>;
  baseline: Record<string, unknown>;
  current: Record<string, unknown>;
  conflictFields: readonly string[];
}

export const fieldDiffRows = (source: EnrichedDiffSource): FieldDiffRow[] =>
  Object.entries(source.changes)
    .filter(([, proposed]) => proposed !== undefined)
    .map(([key, proposed]) => ({
      key,
      proposed,
      current: source.current[key],
      baseline: source.baseline[key],
      conflict: source.conflictFields.includes(key),
    }));
```

- [ ] Run: the test file (3 passing); full web suite — 113 + 3 = 116.
- [ ] Prettier; commit: `git add -A && git commit -m "feat(web): field-diff rows helper for proposal review"`

---

### Task 5 — Proposals queue page + entry point + route meta

**Files:**

- Create: `apps/web/src/routes/_dashboard/admin/puzzles/proposals/index.tsx`
- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/index.tsx` (header action link + count)
- Modify: `apps/web/src/components/dashboard-layout/route-meta.ts` (two `ROUTE_META` entries)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (`admin.proposals` namespace)

**Steps:**

- [ ] Add the `admin.proposals` namespace (top level inside `admin`, after `puzzles`), en + source:

```json
    "proposals": {
      "title": "Suggested edits",
      "subtitle": "Community-proposed changes awaiting review.",
      "empty": {
        "title": "No open suggestions",
        "description": "Community-proposed edits to catalogue puzzles will appear here."
      },
      "conflict": "Conflict",
      "conflictBanner": "The puzzle changed since this was proposed. Marked fields no longer match what the proposer saw.",
      "fieldsChanged": "{count, plural, one {# field changed} other {# fields changed}}",
      "proposedBy": "by {name}",
      "comment": "Proposer's note",
      "current": "Current",
      "proposed": "Proposed",
      "wasWhenProposed": "Was {value} when proposed",
      "none": "—",
      "review": "Review",
      "approve": "Approve",
      "approveConfirmTitle": "Approve this suggestion?",
      "approveConfirmBody": "The proposed changes to “{title}” are applied immediately.",
      "approved": "Suggestion approved and applied",
      "reject": "Decline",
      "rejectTitle": "Decline this suggestion?",
      "rejectBody": "The proposer is notified of the decision. You can add an optional reason.",
      "reasonLabel": "Reason (optional)",
      "reasonPlaceholder": "e.g. the current title matches the box",
      "rejected": "Suggestion declined",
      "alreadyDecided": "This suggestion was already decided",
      "alreadyDecidedSub": "Another admin handled it, or the proposer withdrew it.",
      "actionFailed": "Couldn't complete the action",
      "backToQueue": "Back to suggestions"
    },
```

nl:

```json
    "proposals": {
      "title": "Wijzigingsvoorstellen",
      "subtitle": "Door de community voorgestelde wijzigingen die op beoordeling wachten.",
      "empty": {
        "title": "Geen open voorstellen",
        "description": "Door de community voorgestelde wijzigingen aan cataloguspuzzels verschijnen hier."
      },
      "conflict": "Conflict",
      "conflictBanner": "De puzzel is gewijzigd sinds dit voorstel werd ingediend. Gemarkeerde velden komen niet meer overeen met wat de indiener zag.",
      "fieldsChanged": "{count, plural, one {# veld gewijzigd} other {# velden gewijzigd}}",
      "proposedBy": "door {name}",
      "comment": "Toelichting van de indiener",
      "current": "Huidig",
      "proposed": "Voorgesteld",
      "wasWhenProposed": "Was {value} bij indienen",
      "none": "—",
      "review": "Beoordelen",
      "approve": "Goedkeuren",
      "approveConfirmTitle": "Dit voorstel goedkeuren?",
      "approveConfirmBody": "De voorgestelde wijzigingen aan “{title}” worden direct toegepast.",
      "approved": "Voorstel goedgekeurd en toegepast",
      "reject": "Afwijzen",
      "rejectTitle": "Dit voorstel afwijzen?",
      "rejectBody": "De indiener wordt op de hoogte gebracht. Je kunt optioneel een reden toevoegen.",
      "reasonLabel": "Reden (optioneel)",
      "reasonPlaceholder": "bijv. de huidige titel komt overeen met de doos",
      "rejected": "Voorstel afgewezen",
      "alreadyDecided": "Dit voorstel is al beoordeeld",
      "alreadyDecidedSub": "Een andere beheerder heeft het afgehandeld, of de indiener heeft het ingetrokken.",
      "actionFailed": "Actie kon niet worden uitgevoerd",
      "backToQueue": "Terug naar voorstellen"
    },
```

- [ ] In `apps/web/src/components/dashboard-layout/route-meta.ts`, add to `ROUTE_META` next to the existing puzzle entries:

```ts
  "/admin/puzzles/proposals": { pageKey: "adminPuzzles", group: "admin" },
  "/admin/puzzles/proposals/$proposalId": {
    pageKey: "adminPuzzles",
    group: "admin",
  },
```

- [ ] Create `apps/web/src/routes/_dashboard/admin/puzzles/proposals/index.tsx`:

```tsx
import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Lightbulb, Puzzle as PuzzleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/proposals/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: ProposalsQueuePage,
});

function ProposalsQueuePage() {
  const t = useTranslations("admin.proposals");
  const format = useFormatter();
  const { data: rows } = useQuery(
    convexQuery(gateway.admin.listPendingChangeProposals, {}),
  );

  if (rows === undefined) {
    return <PageLoading message={t("title")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Lightbulb className="text-muted-foreground size-8" aria-hidden />
          <p className="font-semibold">{t("empty.title")}</p>
          <p className="text-muted-foreground text-sm">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border">
          {rows.map((row) => {
            const changedCount = Object.values(row.changes).filter(
              (value) => value !== undefined,
            ).length;
            return (
              <div
                key={row._id}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
              >
                {row.definitionImage ? (
                  <img
                    src={row.definitionImage}
                    alt=""
                    className="size-11 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg border">
                    <PuzzleIcon
                      className="text-muted-foreground size-5"
                      aria-hidden
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-semibold">
                      {row.definitionTitle}
                    </span>
                    {row.hasConflict && (
                      <Badge variant="destructive">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {t("conflict")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {row.proposerName &&
                      `${t("proposedBy", { name: row.proposerName })} · `}
                    {t("fieldsChanged", { count: changedCount })}
                    {" · "}
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </p>
                  {row.comment && (
                    <p className="text-muted-foreground truncate text-xs">
                      {t("comment")}: {row.comment}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/admin/puzzles/proposals/${row.aggregateId}`}>
                      {t("review")}
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] In `apps/web/src/routes/_dashboard/admin/puzzles/index.tsx`, add the header entry point via `usePageHeaderActions` (the file currently registers none — read `admin/categories.tsx` for the exact hook usage and `page-header-slot` import path). Add a pending-count query and publish the link:

```tsx
const t2 = useTranslations("admin.proposals");
const { data: pending } = useQuery(
  convexQuery(gateway.admin.listPendingChangeProposals, {}),
);
usePageHeaderActions(
  () => (
    <Button variant="outline" size="sm" asChild>
      <Link href="/admin/puzzles/proposals">
        <Lightbulb className="h-4 w-4" />
        {t2("title")}
        {pending && pending.length > 0 ? ` (${pending.length})` : ""}
      </Link>
    </Button>
  ),
  [pending?.length],
);
```

(add the needed imports: `usePageHeaderActions`, `useQuery`/`convexQuery`, `Link` from `@/compat/link`, `Lightbulb`; keep the file's existing paginated list untouched.)

- [ ] Verify: web vitest 116; web tsc clean; JSON parses.
- [ ] Prettier; commit: `git add -A && git commit -m "feat(web): admin proposals queue with conflict badges"`

---

### Task 6 — Per-proposal review screen

**Files:**

- Create: `apps/web/src/routes/_dashboard/admin/puzzles/proposals/$proposalId.tsx`

The review screen finds the proposal in the pending queue (queue links only exist for pending proposals; a proposal decided/withdrawn in the meantime shows the `alreadyDecided` empty state). Per-field rows come from Task 4's `fieldDiffRows`; value formatting lives here (i18n-dependent). Approve = AlertDialog confirm; Decline = Dialog with optional reason Textarea (the `category-dialog.tsx` input-dialog pattern, simplified to useState — no RHF for a single optional field).

**Steps:**

- [ ] Create `apps/web/src/routes/_dashboard/admin/puzzles/proposals/$proposalId.tsx`:

```tsx
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import {
  fieldDiffRows,
  type FieldDiffRow,
} from "@/components/admin/proposals/field-diff";
import { EmptyState } from "@/components/library/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute(
  "/_dashboard/admin/puzzles/proposals/$proposalId",
)({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: ProposalReviewPage,
});

function ProposalReviewPage() {
  const { proposalId } = Route.useParams();
  const t = useTranslations("admin.proposals");
  const { data: rows } = useQuery(
    convexQuery(gateway.admin.listPendingChangeProposals, {}),
  );
  const { data: categories } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  if (rows === undefined || categories === undefined) {
    return <PageLoading message={t("title")} />;
  }
  const proposal = rows.find((row) => row.aggregateId === proposalId);
  if (!proposal) {
    // Decided or withdrawn since the queue was rendered (or a bad link).
    return (
      <EmptyState title={t("alreadyDecided")} sub={t("alreadyDecidedSub")} />
    );
  }
  return <ProposalReview proposal={proposal} categories={categories} />;
}

type ProposalRow = FunctionReturnType<
  typeof gateway.admin.listPendingChangeProposals
>[number];

function ProposalReview({
  proposal,
  categories,
}: {
  proposal: ProposalRow;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
}) {
  const router = useRouter();
  const t = useTranslations("admin.proposals");
  const tf = useTranslations("forms.puzzle-form");
  const format = useFormatter();
  const locale = useLocale();

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const approve = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.approveChangeProposal),
    onSuccess: () => {
      toast.success(t("approved"));
      router.push("/admin/puzzles/proposals");
    },
    onError: () => toast.error(t("actionFailed")),
  });
  const reject = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.rejectChangeProposal),
    onSuccess: () => {
      toast.success(t("rejected"));
      router.push("/admin/puzzles/proposals");
    },
    onError: () => toast.error(t("actionFailed")),
  });
  const busy = approve.isPending || reject.isPending;

  // Render a raw field value for display. Grouped/object values get bespoke text; the
  // image row is rendered specially below (side-by-side thumbnails), so it's excluded here.
  const formatValue = (key: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") return t("none");
    switch (key) {
      case "barcodes": {
        const group = value as {
          ean?: string;
          upc?: string;
          modelNumber?: string;
        };
        const parts = [
          group.ean && `${tf("ean.label")} ${group.ean}`,
          group.upc && `${tf("upc.label")} ${group.upc}`,
          group.modelNumber &&
            `${tf("modelNumber.label")} ${group.modelNumber}`,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : t("none");
      }
      case "dimensions": {
        const dims = value as { width: number; height: number; unit: string };
        return `${dims.width} × ${dims.height} ${dims.unit}`;
      }
      case "tags":
        return (value as string[]).length > 0
          ? (value as string[]).join(", ")
          : t("none");
      case "category": {
        const match = categories.find(
          (c) => (c.aggregateId ?? c._id) === (value as string),
        );
        return match
          ? locale === "nl"
            ? match.name.nl
            : match.name.en
          : String(value);
      }
      case "difficulty":
        return tf(`difficulty.${value as string}`);
      case "shape":
        return tf(`shape.${value as string}`);
      default:
        return String(value);
    }
  };

  const fieldLabel = (key: string): string => {
    switch (key) {
      case "barcodes":
        return `${tf("ean.label")} / ${tf("upc.label")} / ${tf("modelNumber.label")}`;
      case "image":
        return tf("image.label");
      default:
        return tf(`${key}.label`);
    }
  };

  const rows = fieldDiffRows(proposal);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-bold">
          {proposal.definitionTitle}
        </h1>
        <p className="text-muted-foreground text-sm">
          {proposal.proposerName &&
            `${t("proposedBy", { name: proposal.proposerName })} · `}
          {format.dateTime(proposal.createdAt, { dateStyle: "medium" })}
        </p>
        {proposal.comment && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("comment")}: </span>
            {proposal.comment}
          </p>
        )}
      </div>

      {proposal.hasConflict && (
        <div className="border-destructive/50 bg-destructive/10 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <AlertTriangle
            className="text-destructive mt-0.5 h-4 w-4 shrink-0"
            aria-hidden
          />
          {t("conflictBanner")}
        </div>
      )}

      <div className="bg-card divide-y rounded-xl border">
        {rows.map((row: FieldDiffRow) =>
          row.key === "image" ? (
            <div key={row.key} className="space-y-2 p-4">
              <p className="text-sm font-semibold">{fieldLabel(row.key)}</p>
              <div className="flex items-center gap-6">
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground text-xs">
                    {t("current")}
                  </figcaption>
                  {proposal.definitionImage ? (
                    <img
                      src={proposal.definitionImage}
                      alt=""
                      className="size-24 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="bg-muted size-24 rounded-lg border" />
                  )}
                </figure>
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground text-xs">
                    {t("proposed")}
                  </figcaption>
                  {proposal.proposedImageUrl ? (
                    <img
                      src={proposal.proposedImageUrl}
                      alt=""
                      className="size-24 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="bg-muted size-24 rounded-lg border" />
                  )}
                </figure>
              </div>
            </div>
          ) : (
            <div key={row.key} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{fieldLabel(row.key)}</p>
                {row.conflict && (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {t("conflict")}
                  </Badge>
                )}
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("current")}: </span>
                {formatValue(row.key, row.current)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("proposed")}: </span>
                <span className="font-medium">
                  {formatValue(row.key, row.proposed)}
                </span>
              </p>
              {row.conflict && (
                <p className="text-destructive text-xs">
                  {t("wasWhenProposed", {
                    value: formatValue(row.key, row.baseline),
                  })}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/admin/puzzles/proposals">{t("backToQueue")}</Link>
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRejectOpen(true)}
        >
          {t("reject")}
        </Button>
        <Button
          variant="brand"
          disabled={busy}
          onClick={() => setConfirmingApprove(true)}
        >
          {t("approve")}
        </Button>
      </div>

      <AlertDialog open={confirmingApprove} onOpenChange={setConfirmingApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("approveConfirmBody", {
                title: proposal.definitionTitle ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("backToQueue")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingApprove(false);
                approve.mutate({ changeProposalId: proposal.aggregateId });
              }}
            >
              {t("approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={busy}
            >
              {t("backToQueue")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setRejectOpen(false);
                reject.mutate({
                  changeProposalId: proposal.aggregateId,
                  reason: reason.trim() || undefined,
                });
              }}
            >
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

IMPLEMENTATION NOTES:

- Add `import type { FunctionReturnType } from "convex/server";` for `ProposalRow`.
- Use `tCommon("cancel")` (`useTranslations("common")`) as the cancel label in BOTH dialogs instead of `backToQueue` — `backToQueue` stays only on the page-level back button. (Amend the two dialog cancel buttons accordingly; no new i18n keys.)
- If `fieldDiffRows(proposal)` fails to typecheck against `EnrichedDiffSource` (generated object types vs `Record<string, unknown>` index signatures), pass a fresh literal instead: `fieldDiffRows({ changes: proposal.changes, baseline: proposal.baseline, current: proposal.current, conflictFields: proposal.conflictFields })` — object literals get the implicit index signature.
- `formatValue`'s `barcodes` branch renders the group members present on either side; an all-empty group renders as `t("none")`.

- [ ] Verify: web vitest 116; web tsc clean; click-path sanity via grep: the queue's Review link `/admin/puzzles/proposals/${row.aggregateId}` matches this route's param usage (`proposalId` compared against `row.aggregateId`).
- [ ] Prettier; commit: `git add -A && git commit -m "feat(web): per-field proposal review screen with conflict markers + approve/decline"`

---

### Task 7 — Proposals section on the admin detail page + full sweep

**Files:**

- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx` (new section)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (two `admin.puzzles.detail` keys + status labels reuse)

**Steps:**

- [ ] Add two keys inside `admin.puzzles.detail` (after `"auditEmpty"`), en + source:

```json
      "proposalsTitle": "Suggested edits",
      "proposalsEmpty": "No suggested edits for this puzzle."
```

nl:

```json
      "proposalsTitle": "Wijzigingsvoorstellen",
      "proposalsEmpty": "Geen wijzigingsvoorstellen voor deze puzzel."
```

- [ ] In `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx`, add a Proposals section BEFORE the Moderation-activity section, gated on `definition.aggregateId` being present. Add the query near the existing one and reuse the member page's status-variant convention:

```tsx
const { data: proposals } = useQuery(
  convexQuery(gateway.admin.listProposalsForDefinition, {
    puzzleDefinitionId: definition.aggregateId ?? "",
  }),
);
```

NOTE on hook placement: the component destructures `definition` from `data` after loading gates — if hooks cannot run after the gates in this file's structure, query with `data?.definition.aggregateId ?? ""` at the top instead and let the empty-string query return `[]` (the backend index lookup on an empty aggregateId matches nothing); pick whichever placement keeps hooks unconditional, and note which you chose.

Section JSX (mirrors the audit section's shape). Declare at module level `const PROPOSAL_STATUS_VARIANT = { pending: "secondary", approved: "default", rejected: "destructive", withdrawn: "outline" } as const;` (typed against the row's status union like the member `my-puzzles/suggestions.tsx` does), and in the component `const tp = useTranslations("admin.proposals");`. Status labels come from the NEW `admin.proposals.status.*` keys added below:

```tsx
<section className="space-y-2">
  <h2 className="text-sm font-semibold">{t("detail.proposalsTitle")}</h2>
  {!proposals || proposals.length === 0 ? (
    <p className="text-muted-foreground text-sm">
      {t("detail.proposalsEmpty")}
    </p>
  ) : (
    <div className="bg-card divide-y rounded-xl border">
      {proposals.map((row) => {
        const changedCount = Object.values(row.changes).filter(
          (value) => value !== undefined,
        ).length;
        return (
          <div key={row._id} className="flex items-center gap-3 px-4 py-2.5">
            <Badge variant={PROPOSAL_STATUS_VARIANT[row.status]}>
              {tp(`status.${row.status}`)}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {row.proposerName &&
                  `${tp("proposedBy", { name: row.proposerName })} · `}
                {tp("fieldsChanged", { count: changedCount })}
              </p>
              {row.status === "rejected" && row.rejectionReason && (
                <p className="text-muted-foreground truncate text-xs">
                  {row.rejectionReason}
                </p>
              )}
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              {format.dateTime(row.createdAt, { dateStyle: "medium" })}
            </span>
            {row.status === "pending" && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/puzzles/proposals/${row.aggregateId}`}>
                  {tp("review")}
                </Link>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  )}
</section>
```

The `admin.proposals.status.*` keys the section uses are NEW — add them in this task's locale edits, in all three files:

en + source, inside `admin.proposals` after `"conflict"`:

```json
      "status": {
        "pending": "Pending",
        "approved": "Approved",
        "rejected": "Declined",
        "withdrawn": "Withdrawn"
      },
```

nl:

```json
      "status": {
        "pending": "In behandeling",
        "approved": "Goedgekeurd",
        "rejected": "Afgewezen",
        "withdrawn": "Ingetrokken"
      },
```

(use `tp = useTranslations("admin.proposals")` for status/fieldsChanged/proposedBy/review; add the needed imports: `Badge`, `Button`, `Link`, `useQuery`/`convexQuery` if absent, `format = useFormatter()` exists already for dates — check.)

- [ ] Verify: web vitest 116; web tsc clean; JSON parses; en==source check for the whole `admin` namespace.
- [ ] Full sweep:

```bash
pnpm exec nx run-many -t type-check --skip-nx-cache
pnpm exec nx run-many -t test --skip-nx-cache
pnpm exec nx run-many -t lint --skip-nx-cache
pnpm exec prettier --check .
pnpm --filter @jigswap/backend exec vitest run
pnpm --filter @jigswap/web exec vitest run
```

Expected: all green — backend 584, web 116, domain 1087. Write-fix any prettier findings.

- [ ] Prettier; commit: `git add -A && git commit -m "feat(web): proposals history on admin definition detail"`
- [ ] Report done. The controller pushes and opens the stacked PR (`gh pr create --base feat/change-proposals-member-ui`).
