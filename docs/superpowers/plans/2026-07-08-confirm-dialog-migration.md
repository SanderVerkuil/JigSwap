# Confirm Dialog Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two raw browser `confirm()` calls (my-puzzles delete, collections delete) with the repo's controlled shadcn `AlertDialog` pattern, including en + nl i18n keys.

**Architecture:** Each call site independently adopts the controlled-AlertDialog idiom already established in `apps/web/src/components/admin/category-list.tsx`: a `useState<Target | null>` holds the row awaiting confirmation, the handler sets it instead of mutating, and a single `<AlertDialog open={target !== null}>` at the bottom of the component runs the mutation from a destructive-styled `AlertDialogAction`. No shared wrapper component is introduced (per the approved spec). The single `deleteConfirm` message key is replaced by `deleteConfirmTitle` / `deleteConfirmBody` / `deleteConfirmAction` keys in all three locale catalogs.

**Tech Stack:** React 19 + TanStack Start/Router, Radix `@radix-ui/react-alert-dialog` via `@/components/ui/alert-dialog`, `use-intl` translations, TanStack Query + Convex mutations, pnpm + nx monorepo (project name `@jigswap/web`), prettier with organize-imports plugin.

---

## Executor constraints (read first)

- Work happens in a **git worktree on branch `feat/confirm-dialogs`** (the branch already exists and contains the spec commit). Write files via the worktree path, not the main-repo path.
- Scope is **ONLY** these two call sites plus the i18n keys. Do not refactor adjacent code, do not touch other `deleteConfirm*` keys (the `completions` namespace has its own — leave it), do not add a delete button to the collections page (the handler stays unwired; its `eslint-disable-next-line @typescript-eslint/no-unused-vars` marker stays).
- Match existing code style exactly (comment style, handler naming, state naming like the existing `solveTarget`).
- **Prettier must be run on every changed file before each commit** — CI runs `format:check` as its first step. The repo uses `prettier-plugin-organize-imports`, so it also fixes import ordering.
- Mirror CI by running nx with `--skip-nx-cache` (the Nx cache hides fresh failures).
- Locale catalogs: `apps/web/locales/source.json` is the **dev catalog** (`src/lib/i18n.ts` imports `source.json` in development) and `en.json` mirrors it byte-for-byte; `nl.json` is the Dutch catalog. **All three files must be edited** or the dialog shows missing-message errors in dev.
- Verification commands (real target names from `apps/web/project.json`):
  - `pnpm nx run @jigswap/web:lint --skip-nx-cache`
  - `pnpm nx run @jigswap/web:type-check --skip-nx-cache` (runs `tsc --noEmit` in `apps/web`)
  - Note: if `type-check` reports errors only in `src/routeTree.gen.ts`, that is pre-existing generated-file noise in worktrees, not caused by this change (this change adds no routes).
- Browser automation is unavailable in this environment; the spec's "drive the my-puzzles delete flow" check is a manual/human step (dev server runs on :3001), listed at the end.

---

### Task 1: Migrate my-puzzles delete to AlertDialog (+ puzzles i18n keys)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/my-puzzles/index.tsx` (imports lines 8–21, component state ~lines 106–114, handler lines 182–199, JSX after the `LogSolveDialog` block lines 372–383)
- Modify: `apps/web/locales/source.json` (line ~473, `puzzles` namespace)
- Modify: `apps/web/locales/en.json` (line ~473, identical edit to source.json)
- Modify: `apps/web/locales/nl.json` (line ~473, Dutch)
- Test: none (UI-only change; verification is lint + type-check)

**Steps:**

- [ ] 1.1 In `apps/web/src/routes/_dashboard/my-puzzles/index.tsx`, add the AlertDialog import and extend the Button import. Replace this existing import block:

  ```tsx
  import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  ```

  with:

  ```tsx
  import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
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
  import { Button, buttonVariants } from "@/components/ui/button";
  ```

- [ ] 1.2 In the same file, add the `common` translator and the delete-target state. Replace this existing block inside `PuzzlesPage`:

  ```tsx
  const t = useTranslations("puzzles");
  const tLending = useTranslations("lending");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // The copy a solve is being logged against; null when the dialog is closed.
  const [solveTarget, setSolveTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);
  ```

  with:

  ```tsx
  const t = useTranslations("puzzles");
  const tLending = useTranslations("lending");
  const tCommon = useTranslations("common");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // The copy a solve is being logged against; null when the dialog is closed.
  const [solveTarget, setSolveTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);
  // The copy awaiting the destructive delete confirm; null when the dialog is closed.
  const [deleteTarget, setDeleteTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);
  ```

- [ ] 1.3 Convert the handler: it now stages the target instead of calling `confirm()`, and the mutation moves into a confirm helper the dialog invokes. Replace this existing block:

  ```tsx
  const handleDeletePuzzle = async (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain delete takes the Copy aggregateId; resolve it from the loaded row. Guard rows
    // that predate the backfill (no aggregateId) rather than send an unresolvable id.
    const copy = userownedPuzzles?.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot delete: copy is missing its aggregateId.");
      return;
    }
    if (confirm(t("deleteConfirm"))) {
      try {
        await deletePuzzle.mutateAsync({
          copyId: copy.aggregateId,
        });
      } catch (error) {
        console.error("Failed to delete puzzle:", error);
      }
    }
  };
  ```

  with:

  ```tsx
  const handleDeletePuzzle = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain delete takes the Copy aggregateId; resolve it from the loaded row. Guard rows
    // that predate the backfill (no aggregateId) rather than send an unresolvable id.
    const copy = userownedPuzzles?.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot delete: copy is missing its aggregateId.");
      return;
    }
    setDeleteTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
    });
  };

  const confirmDeletePuzzle = async (copyId: string) => {
    try {
      await deletePuzzle.mutateAsync({ copyId });
    } catch (error) {
      console.error("Failed to delete puzzle:", error);
    }
  };
  ```

- [ ] 1.4 Render the controlled AlertDialog at the bottom of the component. Replace this existing block (the end of the component's JSX):

  ```tsx
      {solveTarget && (
        <LogSolveDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setSolveTarget(null);
          }}
          copyId={solveTarget.copyId}
          puzzleTitle={solveTarget.title}
          viewerIsOwner={true}
        />
      )}
    </div>
  );
  ```

  with:

  ```tsx
      {solveTarget && (
        <LogSolveDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setSolveTarget(null);
          }}
          copyId={solveTarget.copyId}
          puzzleTitle={solveTarget.title}
          viewerIsOwner={true}
        />
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteConfirmTitle", { title: deleteTarget?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (deleteTarget) {
                  void confirmDeletePuzzle(deleteTarget.copyId);
                }
                setDeleteTarget(null);
              }}
            >
              {t("deleteConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
  ```

- [ ] 1.5 Replace the `puzzles.deleteConfirm` key in **both** `apps/web/locales/source.json` and `apps/web/locales/en.json` (the files are identical; the key is at line ~473 in each, inside the `"puzzles"` namespace between `"listView"` and `"loadingPuzzles"`). Replace exactly this line:

  ```json
      "deleteConfirm": "Are you sure you want to delete this puzzle?",
  ```

  with:

  ```json
      "deleteConfirmTitle": "Delete \"{title}\"?",
      "deleteConfirmBody": "This permanently removes this puzzle from your library. This action cannot be undone.",
      "deleteConfirmAction": "Delete",
  ```

  Do NOT touch the other `deleteConfirm` occurrences at lines ~1341 (`collections`, Task 2) and ~1588 (`completions` nested namespace, out of scope).

- [ ] 1.6 Apply the same replacement in `apps/web/locales/nl.json` (line ~473, same position in the `"puzzles"` namespace). Replace exactly this line:

  ```json
      "deleteConfirm": "Weet je zeker dat je deze puzzel wilt verwijderen?",
  ```

  with:

  ```json
      "deleteConfirmTitle": "\"{title}\" verwijderen?",
      "deleteConfirmBody": "Dit verwijdert deze puzzel permanent uit je bibliotheek. Deze actie kan niet ongedaan worden gemaakt.",
      "deleteConfirmAction": "Verwijderen",
  ```

- [ ] 1.7 Run lint (CI mirror):

  ```bash
  pnpm nx run @jigswap/web:lint --skip-nx-cache
  ```

  Expected outcome: exits 0 with `Successfully ran target lint for project @jigswap/web`. No `no-restricted-globals`/unused-variable errors in `my-puzzles/index.tsx`.

- [ ] 1.8 Run type-check (CI mirror):

  ```bash
  pnpm nx run @jigswap/web:type-check --skip-nx-cache
  ```

  Expected outcome: exits 0 with `Successfully ran target type-check for project @jigswap/web`. (If errors appear _only_ in `src/routeTree.gen.ts`, that is pre-existing worktree codegen noise — confirm no errors reference `my-puzzles/index.tsx`.)

- [ ] 1.9 Format the changed files (CI runs `format:check` first):

  ```bash
  pnpm prettier --write apps/web/src/routes/_dashboard/my-puzzles/index.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  ```

  Expected outcome: exits 0; files are rewritten or reported unchanged (the organize-imports plugin fixes import order if step 1.1 placement was off).

- [ ] 1.10 Commit:

  ```bash
  git add apps/web/src/routes/_dashboard/my-puzzles/index.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  git commit -m "feat(web): replace raw confirm() with AlertDialog on my-puzzles delete" -m "Adopts the controlled AlertDialog pattern from admin/category-list for the
  owned-copy delete flow, and splits the puzzles.deleteConfirm message into
  title/body/action keys (en + nl + source catalogs)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected outcome: commit created on `feat/confirm-dialogs` with exactly those 4 files.

---

### Task 2: Convert the collections delete handler to the AlertDialog pattern (still unwired) (+ collections i18n keys)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/collections/index.tsx` (imports lines 14–15, component state ~lines 63–66, handler lines 119–136, JSX after `EditCollectionDialog` lines 373–378)
- Modify: `apps/web/locales/source.json` (line ~1341, `collections` namespace)
- Modify: `apps/web/locales/en.json` (line ~1341, identical edit to source.json)
- Modify: `apps/web/locales/nl.json` (line ~1341, Dutch)
- Test: none (UI-only change; verification is lint + type-check)

**Important:** No delete button is added (explicit non-goal in the spec). `handleDeleteCollection` remains unused and keeps its `eslint-disable-next-line @typescript-eslint/no-unused-vars` marker so lint passes. The dialog is rendered but can only open once a future PR wires an affordance that calls the handler.

**Steps:**

- [ ] 2.1 In `apps/web/src/routes/_dashboard/collections/index.tsx`, add the AlertDialog import and extend the Button import. Replace this existing import block:

  ```tsx
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  ```

  with:

  ```tsx
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
  import { Button, buttonVariants } from "@/components/ui/button";
  ```

- [ ] 2.2 Add the delete-target state next to the existing dialog state. Replace this existing block inside `CollectionsPage`:

  ```tsx
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] =
    useState<EditableCollection | null>(null);
  ```

  with:

  ```tsx
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] =
    useState<EditableCollection | null>(null);
  // The collection aggregateId awaiting the destructive delete confirm; null
  // when the dialog is closed. Nothing sets it yet — the delete affordance
  // lands in a follow-up — but the confirm flow is already in its final shape.
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  ```

- [ ] 2.3 Convert the handler: it stages the target instead of calling `confirm()`, and the mutation moves into a confirm helper the dialog invokes. The unused-vars disable stays on the (still unwired) handler. Replace this existing block:

  ```tsx
  // Wired to a delete affordance in a follow-up; kept to preserve the intended flow.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteCollection = async (collectionAggregateId?: string) => {
    // The domain delete takes the CollectionId (aggregateId); guard rows missing it.
    if (!collectionAggregateId) {
      console.error("Cannot delete: collection is missing its aggregateId.");
      return;
    }
    if (confirm(t("deleteConfirm"))) {
      try {
        await deleteCollection.mutateAsync({
          collectionId: collectionAggregateId,
        });
      } catch (error) {
        console.error("Failed to delete collection:", error);
      }
    }
  };
  ```

  with:

  ```tsx
  // Wired to a delete affordance in a follow-up; kept to preserve the intended flow.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteCollection = (collectionAggregateId?: string) => {
    // The domain delete takes the CollectionId (aggregateId); guard rows missing it.
    if (!collectionAggregateId) {
      console.error("Cannot delete: collection is missing its aggregateId.");
      return;
    }
    setDeleteTarget(collectionAggregateId);
  };

  const confirmDeleteCollection = async (collectionId: string) => {
    try {
      await deleteCollection.mutateAsync({ collectionId });
    } catch (error) {
      console.error("Failed to delete collection:", error);
    }
  };
  ```

- [ ] 2.4 Render the controlled AlertDialog at the bottom of the component. Replace this existing block (the end of the component's JSX):

  ```tsx
      <EditCollectionDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        collection={editingCollection}
      />
    </div>
  );
  ```

  with:

  ```tsx
      <EditCollectionDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        collection={editingCollection}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (deleteTarget) {
                  void confirmDeleteCollection(deleteTarget);
                }
                setDeleteTarget(null);
              }}
            >
              {t("deleteConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
  ```

  (`tCommon` already exists in this component: `const tCommon = useTranslations("common");` at line 62.)

- [ ] 2.5 Replace the `collections.deleteConfirm` key in **both** `apps/web/locales/source.json` and `apps/web/locales/en.json` (line ~1341 in each, inside the `"collections"` namespace between `"newCollection"` and `"loadingCollections"`). Replace exactly this line:

  ```json
      "deleteConfirm": "Are you sure you want to delete this collection?",
  ```

  with:

  ```json
      "deleteConfirmTitle": "Delete this collection?",
      "deleteConfirmBody": "This permanently deletes the collection. This action cannot be undone.",
      "deleteConfirmAction": "Delete",
  ```

  Leave the `completions` namespace's `deleteConfirm*` keys (line ~1588) untouched.

- [ ] 2.6 Apply the same replacement in `apps/web/locales/nl.json` (line ~1341, same position in the `"collections"` namespace). Replace exactly this line:

  ```json
      "deleteConfirm": "Weet je zeker dat je deze collectie wilt verwijderen?",
  ```

  with:

  ```json
      "deleteConfirmTitle": "Deze collectie verwijderen?",
      "deleteConfirmBody": "Dit verwijdert de collectie permanent. Deze actie kan niet ongedaan worden gemaakt.",
      "deleteConfirmAction": "Verwijderen",
  ```

- [ ] 2.7 Run lint (CI mirror):

  ```bash
  pnpm nx run @jigswap/web:lint --skip-nx-cache
  ```

  Expected outcome: exits 0 with `Successfully ran target lint for project @jigswap/web`. In particular, no unused-variable error for `handleDeleteCollection` (the eslint-disable marker still covers it) and no unused error for `confirmDeleteCollection` / `deleteTarget` (both are referenced by the dialog).

- [ ] 2.8 Run type-check (CI mirror):

  ```bash
  pnpm nx run @jigswap/web:type-check --skip-nx-cache
  ```

  Expected outcome: exits 0 with `Successfully ran target type-check for project @jigswap/web` (same `routeTree.gen.ts` caveat as step 1.8).

- [ ] 2.9 Format the changed files:

  ```bash
  pnpm prettier --write apps/web/src/routes/_dashboard/collections/index.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  ```

  Expected outcome: exits 0; files rewritten or unchanged.

- [ ] 2.10 Commit:

  ```bash
  git add apps/web/src/routes/_dashboard/collections/index.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  git commit -m "feat(web): convert collections delete confirm to AlertDialog pattern" -m "The handler now stages a deleteTarget for a controlled AlertDialog instead
  of calling window.confirm; it stays unwired (no delete affordance yet, per
  spec) with its eslint-disable marker preserved. Splits the
  collections.deleteConfirm message into title/body/action keys (en + nl +
  source catalogs)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected outcome: commit created on `feat/confirm-dialogs` with exactly those 4 files.

---

### Task 3: Final verification sweep

**Files:**

- Create: none
- Modify: none (verification only; fix-and-amend within Task 1/2 scope if anything fails)
- Test: none

**Steps:**

- [ ] 3.1 Confirm no raw browser confirms remain anywhere in the web app:

  ```bash
  grep -rn "if (confirm(\|window.confirm" apps/web/src
  ```

  Expected outcome: no output (exit code 1 from grep).

- [ ] 3.2 Confirm the old key is gone from the two migrated namespaces and only the out-of-scope `completions` key remains:

  ```bash
  grep -n '"deleteConfirm"' apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  ```

  Expected outcome: exactly one match per file, at line ~1588, inside the `completions` namespace (`"deleteConfirm": "Delete"` / `"deleteConfirm": "Verwijderen"`).

- [ ] 3.3 Run the full CI-mirror verification:

  ```bash
  pnpm nx run @jigswap/web:lint --skip-nx-cache && pnpm nx run @jigswap/web:type-check --skip-nx-cache
  ```

  Expected outcome: both targets succeed (exit 0).

- [ ] 3.4 Confirm formatting is clean on every file this plan touched:

  ```bash
  pnpm prettier --check apps/web/src/routes/_dashboard/my-puzzles/index.tsx apps/web/src/routes/_dashboard/collections/index.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
  ```

  Expected outcome: `All matched files use Prettier code style!` (exit 0).

- [ ] 3.5 Manual check (human, browser automation unavailable in this environment): start the dev server (`pnpm dev:web`, serves on :3001), open My Puzzles, trigger delete from a puzzle card's overflow menu — the AlertDialog appears with title/body, **Cancel** closes it without deleting, **Delete** removes the copy. Dev mode reads `locales/source.json`, so the new keys must render (no `puzzles.deleteConfirmTitle` literals on screen).

  Expected outcome: dialog behavior matches the old `confirm()` semantics; no console i18n errors.

---

## Out of scope (do not do)

- Adding a delete button/affordance on the collections page.
- A shared confirm-dialog wrapper component.
- Touching `completions` namespace keys or the completions delete dialog.
- Any backend, gateway, domain, or schema change.
- Refactoring adjacent code in either route file.
