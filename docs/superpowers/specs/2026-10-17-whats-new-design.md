# What's new: changelog page, unread badge, highlight modal, notification and tours

**Date:** 2026-10-17
**Status:** Draft for review (ticket W1, bottom of the What's new stack)
**Lands on:** `feat/whats-new-foundation` (W1) → W2 (page, badge, modal) → W3
(notification) → W4 (multi-step tours and the real seed entries).

This spec has two parts. **Part A** is the technical design (content model,
manifest, read state, API, surfacing rules, tour architecture, tests). **Part
B** is the UI Designer's visual design, merged in with the open items resolved
where they are technical. Section references like "§3.1" inside Part B point
at Part B sections; Part A sections are numbered A1, A2, ….

## User decisions (final)

1. **Entries are Markdown in the repo.** No CMS, no admin UI.
2. **Surfacing:** a `/whats-new` page plus an unread badge, a one-time modal
   for highlighted entries, and an in-app notification.
3. **Onboarding is multi-step tours.**
4. **Entries published before a member's account was created count as
   already read.** They appear in the list but are never unread.

## Decisions made in this spec (summary)

| #   | Decision                                                                                                   | Section                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| D1  | Metadata manifest is generated into `packages/contracts` (not a new package)                               | A2                       |
| D2  | Manifest agreement is a text-exact check, run by a web test and by the Vite plugin at build                | A2                       |
| D3  | Unread is tracked as a **per-entry seen set**, no watermark                                                | A3                       |
| D4  | No separate "modal shown" state: modal eligibility derives from the seen set                               | A3                       |
| D5  | Unknown entry ids are ignored (deploy-skew tolerant); unknown tour ids are rejected                        | A5                       |
| D6  | Body headings are demoted two levels (`h2→h4`, `h3→h5`, deeper → `h6`); an `h1` in a body is a build error | A1, resolves O3          |
| D7  | `whats_new` notifications get their own `product` preferences category                                     | A6, resolves O4          |
| D8  | Dark-mode chips and pills use the Tailwind palette `violet-300`, no new token                              | Part B §1.4, resolves O5 |
| D9  | The highlight modal is the lowest-priority surface and never stacks on another prompt                      | A6                       |
| D10 | Tours are a custom runner on our Radix Popover/Dialog primitives, no tour library (decided in W4)          | A7                       |

---

# Part A: technical design

## A1. Content model

### Files

```
docs/whats-new/<yyyy-mm-dd>-<slug>.en.md   (required, canonical)
docs/whats-new/<yyyy-mm-dd>-<slug>.nl.md   (optional translation)
```

- The `<yyyy-mm-dd>-<slug>` basename pairs the locales of one entry. Files that
  do not match `^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.(en|nl)\.md$`
  are a build error (catches `.md` typos and stray files).
- `en` is canonical. An `nl` file without its `en` sibling is a build error.
- A missing `nl` file falls back to the `en` content for `nl` readers, and the
  build prints one warning per entry
  (`[whats-new] 2026-10-20-households: no nl translation, falling back to en`).
- A missing `docs/whats-new/` directory means "no entries" (W1 ships none; W4
  adds the real seed entries). Tests use inline fixtures.

### Frontmatter

| Field         | Type                                     | Required   | Locale-invariant     | Notes                                                                                                                                          |
| ------------- | ---------------------------------------- | ---------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | kebab-case string, ≤ 64 chars            | yes        | yes                  | Stable forever. Read state is keyed on it, so renaming the file is fine but changing `id` resets everyone's read state. Unique across entries. |
| `publishedAt` | `YYYY-MM-DD` or ISO datetime with offset | yes        | yes                  | Normalised to epoch ms (UTC). A bare date means 00:00 UTC. Its UTC date must equal the filename date.                                          |
| `title`       | non-empty string                         | yes        | no                   | Card and modal title; the notification message (W3).                                                                                           |
| `summary`     | non-empty string                         | yes        | no                   | The lead; modal description.                                                                                                                   |
| `category`    | `feature` \| `improvement` \| `fix`      | yes        | yes                  |                                                                                                                                                |
| `highlight`   | boolean                                  | no (false) | yes                  | `true` → eligible for the one-time modal.                                                                                                      |
| `notify`      | boolean                                  | no (false) | yes                  | `true` → W3 sends a `whats_new` notification.                                                                                                  |
| `cta`         | `{ label, to }`                          | no         | `to` yes, `label` no | `to` is an in-app path: starts with `/`, not `//`, no scheme.                                                                                  |
| `image`       | string                                   | no         | yes                  | Root-relative public asset (`/whats-new/…`) or an `https://` URL.                                                                              |
| `imageAlt`    | string                                   | no         | no                   | Per-locale alt text (designer O1). Only allowed with `image`; absent means decorative (`alt=""`).                                              |
| `tour`        | kebab-case tour id                       | no         | yes                  | Links the entry to a W4 tour.                                                                                                                  |

- Unknown keys are a build error (a `hightlight: true` typo must not silently
  ship without a modal).
- Locale-invariant fields must be identical in the `en` and `nl` files; a
  mismatch is a build error naming both files. The `en` values win in the
  output.
- Validation runs with zod in the loader; all problems in a build are
  collected and reported together.

### Rendering pipeline

The loader reuses the docs stack (`unified` + `remark-gfm` + `remark-rehype`
with raw HTML + `rehype-raw` + `rehype-external-links` + `@shikijs/rehype` with
the same `github-light`/`github-dark` themes) so code blocks and links render
exactly like `/docs`. Differences from the docs pipeline:

- **Heading demotion (resolves O3).** The card title is an `h3`, so body
  headings shift two levels: `h2→h4`, `h3→h5`, `h4`–`h6` → `h6`. An `h1` in a
  body is a build error (the title comes from frontmatter). The
  `WHATS_NEW_PROSE` selectors in Part B §1.6 therefore target `h4`/`h5`.
- No slugs, autolinked headings, TOC, callouts or search text: entries are
  short and are not part of the docs search index.

### `virtual:whats-new`

A new Vite plugin (`apps/web/vite-plugin-whats-new.ts`, a sibling of the docs
plugin, registered next to it in `vite.config.ts`) exposes:

```ts
declare module "virtual:whats-new" {
  export const entries: WhatsNewEntry[]; // newest first (publishedAt desc, then id)
}

type WhatsNewLocale = "en" | "nl";

interface WhatsNewEntry {
  id: string;
  publishedAt: number; // epoch ms
  category: "feature" | "improvement" | "fix";
  highlight: boolean;
  notify: boolean;
  tour?: string;
  image?: string;
  ctaTo?: string;
  content: Record<
    WhatsNewLocale,
    {
      title: string;
      summary: string;
      html: string; // rendered, demoted, Shiki-highlighted body
      imageAlt?: string;
      ctaLabel?: string;
      fallback: boolean; // true when this locale fell back to en
    }
  >;
}
```

Entries are bundled synchronously, so the page never waits for content (Part B
§1.9: the "no skeleton" branch applies). The dev server watches
`docs/whats-new/` and full-reloads on change, like the docs plugin. The Nx web
`build` target lists `docs/whats-new/**/*` as an input.

## A2. Metadata manifest (D1, D2)

The backend must know entry ids, dates and flags (to compute unread, validate
ids and, in W3, send notifications), but it cannot import web's virtual
module. A small metadata manifest is therefore committed as source:

```ts
// packages/contracts/src/whats-new/types.ts
export interface WhatsNewManifestEntry {
  id: string;
  publishedAt: number; // epoch ms
  highlight: boolean;
  notify: boolean;
  tour?: string;
}

// packages/contracts/src/whats-new/manifest.generated.ts  (GENERATED, prettier-ignored)
export const WHATS_NEW_MANIFEST: readonly WhatsNewManifestEntry[] = [ … ];
```

**Location: `packages/contracts` (D1).** Both `@jigswap/backend` and
`@jigswap/web` already depend on contracts, and its Nx tag
(`type:contracts`, self-contained) fits a dependency-free data file. A new
package would add a `package.json`, `project.json`, tsconfig, lockfile entries
and two new workspace dependencies for one array, with no isolation benefit,
since the manifest has no dependencies of its own. The cost is that contracts,
otherwise types plus small pure helpers, now holds generated data; the
`.generated.ts` suffix, a header comment and a `.prettierignore` entry make
that explicit. Convex bundles contracts from source (it already uses runtime
helpers like `resolveMemberDisplayName`), so no build step is involved.

**Generation and agreement (D2).** One pure function,
`renderManifestSource(toManifest(entries))`, produces the file text. It is
used twice:

1. **Test** (`apps/web/src/whats-new/manifest.spec.ts`): loads the real
   `docs/whats-new/` and asserts the committed file matches with
   `toMatchFileSnapshot`. Authors regenerate with
   `pnpm --filter @jigswap/web whats-new:manifest` (that spec with `-u`). In
   CI a mismatch fails the web `test` target.
2. **Vite plugin**: on `vite build` a mismatch throws, so a deploy can never
   ship content the backend does not know about. On `vite dev` it prints a
   warning with the regenerate command instead, so authors can iterate.

The comparison is text-exact on purpose: the file is prettier-ignored, so the
generator owns its formatting and "equal text" is the simplest, strictest
notion of agreement.

## A3. Read state and the unread rule (D3, D4)

```
unread(entry, member) =
  entry.publishedAt > member.createdAt  &&  entry.id ∉ member.seenEntryIds
```

The rule is a pure function in `packages/domain`
(`whats-new/domain/unread.ts`, `unreadWhatsNewEntryIds(entries, reader)`), so
it is unit-tested once and shared by the backend.

**Per-entry seen set, no watermark (D3).** The alternative is a watermark
(`lastSeenAt`, set by "mark all seen") plus a seen set for single entries
(modal close, notification open). It was rejected because:

- **Exactness.** A watermark marks "everything with `publishedAt` ≤ X" read. An
  entry whose `publishedAt` is earlier than an existing entry's, or that
  deploys days after its date, would silently count as read for anyone who
  visited the page in between. A seen set records what the member was actually
  shown.
- **One concept, not two.** The watermark still needs the seen set for
  single-entry reads, so it adds a field and a second code path.
- **Bounded size without it.** Only ids that are in the manifest **and** were
  unread are stored (pre-account entries are never stored, they are read by
  definition), and ids that left the manifest are pruned on every write. The
  array is bounded by the number of entries published during the account's
  lifetime, far below Convex's 8192-element array limit at any realistic
  cadence.
- The account-created cutoff already plays the role of the watermark for
  history (user decision 4).

**No separate "modal shown" state (D4).** Part B §4 says any close of the
modal (including "Maybe later") marks the entry read, and the modal only ever
picks the newest _unread_ highlighted entry. Every path that would set "modal
shown" also sets "seen", and nothing reads "modal shown" independently, so the
modal state is derived: `modalCandidate = newest entry with highlight ∧
unread`. The "at most one modal per session" rule is client session state
(W2), not persisted. If a later product decision separates them (for example a
"remind me later" that keeps the entry unread), a `modalShownIds` field can be
added to the same row without a migration.

## A4. Data model

```ts
// One row per member that has ever marked something seen.
whatsNewReadStates: defineTable({
  memberId: v.id("users"),
  seenEntryIds: v.array(v.string()), // manifest ids only; pruned on write
  updatedAt: v.number(),
}).index("by_member", ["memberId"]),

// One row per (member, tour) the member has started.
whatsNewTourProgress: defineTable({
  memberId: v.id("users"),
  tourId: v.string(),
  status: v.union(
    v.literal("in_progress"), // started or paused; `step` is where to resume
    v.literal("completed"),
    v.literal("dismissed"),
  ),
  step: v.optional(v.number()), // 0-based index of the current / last step
  updatedAt: v.number(),
}).index("by_member_tour", ["memberId", "tourId"]),
```

- A single read-state row per member keeps `getWhatsNewState` to one indexed
  read, and the badge count is computed in memory against the manifest.
  Concurrent writes from two tabs conflict on the row and Convex retries them
  (OCC), which is correct for a set union.
- `by_member_tour` serves both the point lookup (record progress) and the
  per-member listing (prefix query on `memberId`).
- Member deletion (`users.deleteUser`) does not cascade to any table today;
  these two tables inherit that pre-existing gap (noted as a follow-up, not
  fixed here).

## A5. API

All functions live in `packages/backend/convex/whatsNew/`. Each calls
`requireMember` unconditionally first and reads or writes only the caller's
own rows; no function accepts a member id.

```ts
// api.whatsNew.getWhatsNewState.getWhatsNewState
query({ args: {} }) → WhatsNewStateView
interface WhatsNewStateView {
  unreadIds: string[];               // manifest order (newest first)
  tours: WhatsNewTourProgressView[];
}
interface WhatsNewTourProgressView {
  tourId: string;
  status: "in_progress" | "completed" | "dismissed";
  step?: number;
  updatedAt: number;
}

// api.whatsNew.markWhatsNewSeen.markWhatsNewSeen
mutation({ args: { ids: v.array(v.string()) } }) → null
//   ids.length ≤ 50, else ConvexError({ code: "too_many_ids" })
//   ids not in the manifest, and ids that are already read, are ignored

// api.whatsNew.markAllSeen.markAllSeen
mutation({ args: {} }) → null        // marks every currently unread entry seen

// api.whatsNew.recordTourProgress.recordTourProgress
mutation({ args: {
  tourId: v.string(),
  status: v.union(v.literal("in_progress"), v.literal("completed"), v.literal("dismissed")),
  step: v.optional(v.number()),
} }) → null
//   tourId must be a `tour` referenced by a manifest entry, else ConvexError({ code: "unknown_tour" })
//   step must be an integer in [0, 50), else ConvexError({ code: "invalid_step" })
//   status "in_progress" requires step, else ConvexError({ code: "invalid_step" })
//   upsert: last write wins (replaying a completed tour moves it back to in_progress)
```

The view types live in `packages/contracts/src/whats-new/types.ts`.

**Unknown ids (D5).** Web (Vercel) and Convex deploy separately, so for a few
minutes the web bundle can know entries the backend manifest does not (or the
reverse). `markWhatsNewSeen` runs fire-and-forget from the page, the modal and
the notification; throwing on an id the backend does not know yet would turn a
harmless skew into an error toast. Unknown ids are therefore ignored and never
stored, which still satisfies "validate against the manifest": nothing outside
the manifest can enter the table. Tour progress is different: it is an explicit
write of a row, and an unknown tour id is a client bug, so it is rejected.
Batch size is capped either way.

## A6. Surfacing rules

### Unread count and badge (W2)

`unreadIds.length` from `getWhatsNewState`, intersected with the ids in
`virtual:whats-new` (an id only one side knows is ignored). While the query is
loading the count is 0 (server snapshot "seen"), per Part B §3.4.

### Page visit (W2)

The page captures `unreadIds` at mount (the "New" pills), then calls
`markAllSeen` once after the first render.

### Highlight modal priority (D9, W2)

The modal is the **lowest-priority** surface. Surfaces in priority order:

1. Any dialog or sheet the member opened (solve dialogs, swap dialogs, the
   mobile quick sheet, the command palette, …).
2. Task-flow prompts the app opens after an action:
   `DurationPromptProvider` (`components/solving/duration-prompt-provider.tsx`,
   the first-time "track solve duration?" prompt) and
   `CompletionFollowUpProvider`
   (`components/solving/completion-follow-up-provider.tsx`, the post-solve
   review and photos dialog). They chain: solve dialog closes → duration
   prompt → follow-up.
3. A running tour (W4; it only starts from an explicit click).
4. The highlight modal.

Rule: the modal opens only when nothing in 1–3 is open **and** no prompt chain
is pending. W2 implements this with a tiny shell-level "surface busy" signal:
both providers report `active` while their dialog is open or a request is in
flight (a small additive change to their context values), the tour reports
while running, and a generic guard checks for any open Radix dialog
(`[role="dialog"][data-state="open"]`) at the moment of opening. If busy, the
modal defers to the next route change in the same session (Part B §4.1); it is
never queued on top. Because the modal is itself modal, a higher-priority
prompt cannot be triggered while it is open, so the reverse stacking cannot
happen.

Other rules (Part B §4.1): newest unread `highlight` entry, at most one per
session, never on `/whats-new`, ~600 ms after route settle, any close calls
`markWhatsNewSeen([id])`.

### Notification (W3, resolves O4)

`notify: true` entries produce one `whats_new` notification for each member
the entry is unread for by A3 (account created before `publishedAt`). Delivery mechanics (a deploy-time or cron fan
out keyed on the manifest, idempotent per `(member, entryId)`) are W3's design.
The type gets its **own `product` preferences category** (D7) so members can
mute product news without muting social notifications; this follows the
designer's recommendation and the enum fan-out listed in Part B §6. Opening the
notification also calls `markWhatsNewSeen([entryId])`.

## A7. Tour architecture

Requirements from Part B §5: spotlight with
cut-out and click shield, anchored popover with arrow on desktop, docked card
on mobile, cross-route steps with a pending state, missing-target fallback,
focus management and `aria-*` per §5.4, reduced-motion handling, i18n copy, and
resume from a saved step (`recordTourProgress`).

| Candidate                          | Notes to evaluate                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **driver.js**                      | Small, framework-agnostic, has spotlight/overlay and popovers. Check: React rendering of step content, cross-route steps, styling with our tokens, a11y (focus trap, roles), the mobile docked-card layout.                                                                          |
| **react-joyride**                  | React-native API and a mature step model. Check: React 19 support, bundle size, a11y of its tooltip, how much of its styling we would override, controlled mode for resume.                                                                                                          |
| **Shepherd.js** (`react-shepherd`) | Floating UI positioning, good keyboard support. Check: licence (AGPL / commercial for some uses), React wrapper quality.                                                                                                                                                             |
| **Intro.js**                       | Mature, but AGPL / commercial licence; likely excluded on licence.                                                                                                                                                                                                                   |
| **Reactour** (`@reactour/tour`)    | Small React lib with a mask. Check: maintenance, React 19, a11y.                                                                                                                                                                                                                     |
| **Custom on Radix Popover**        | Reuses `components/ui/popover.tsx` (focus trap, collision handling, `PopoverAnchor virtualRef`), our tokens and i18n directly; the spotlight is a fixed div with a box-shadow (Part B §5.2). Cost: we own geometry updates, scroll-into-view, cross-route waits and the mobile card. |

Tour definitions (steps, targets via `data-tour="…"` attributes, routes) live
in web code keyed by the `tour` id from the manifest; their copy lives in the
locale files (`tours.<tourId>.steps.<stepId>.title|body`).

### Decision (W4): custom runner on Radix, no tour library

Evaluated on 2026-10-17 against the latest release of each candidate that is
at least two weeks old. Sizes are minified + gzipped, measured with esbuild
0.25.10 bundling each library's tour entry point with React and React DOM
external (CSS listed separately where the library ships it).

| Candidate                                    | Version | Size (min+gz)        | React 19            | a11y (from its source)                                                                                            | Licence      | Last release |
| -------------------------------------------- | ------- | -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| driver.js                                    | 1.9.0   | 7.7 KB + 1.0 KB CSS  | n/a (DOM, no React) | `role="dialog"`, Esc and arrow keys, focus handling; no `aria-modal`                                              | MIT          | 2026-10-15   |
| react-joyride                                | 3.2.0   | 27.5 KB              | peer `16.8 - 19`    | focus trap, `aria-modal`, Esc                                                                                     | MIT          | 2026-07-09   |
| react-shepherd (+ shepherd.js 15.3.0)        | 7.0.6   | 16.4 KB + 1.0 KB CSS | peer `^18 \|\| ^19` | `role="dialog"`, labelledby                                                                                       | **AGPL-3.0** | 2026-08-24   |
| @reactour/tour                               | 3.8.0   | 9.8 KB               | peer `16.x … 19.x`  | Esc / arrows via key codes, `aria-label`s; no dialog role, no focus trap                                          | MIT          | 2025-05-07   |
| Intro.js                                     | 8.6.0   | not measured         | n/a                 | not evaluated                                                                                                     | **AGPL-3.0** | 2026-09-21   |
| **Custom (Radix Popover + Dialog, shipped)** | in-repo | **4.7 KB**           | yes (our code)      | Radix modal focus trap, `aria-hidden` on the rest, Esc; `aria-modal`, labelledby eyebrow + title, roledescription | ours         | n/a          |

driver.js 1.10.x was released two days before the evaluation, so 1.9.0 was
measured. The custom figure is the tour runner, layer and definitions only;
Radix Popover and Dialog are already in the app bundle.

**Why custom.**

- **Shepherd and Intro.js are out on licence** (AGPL-3.0).
- **The spec's UI is ours either way.** Every library ships its own popover.
  To meet Part B §5 (our card anatomy, tokens, the mobile docked card, the
  centred pending and missing-target card, and the eyebrow-plus-title
  labelledby) we would override or replace most of its rendering. driver.js
  builds the popover as HTML strings outside React, so our `Button`s, icons and
  `use-intl` copy cannot render in it. react-joyride is the heaviest option and
  still needs a custom tooltip component and its own controlled mode for
  resume. Reactour has no dialog role or focus trap and has not had a release in
  17 months.
- **Cross-route steps are app logic in every option.** None of the libraries
  knows TanStack Router: each would need our own "navigate, wait for the anchor,
  then continue" loop. That loop is most of the runner.
- **The primitives already exist.** Radix `Popover` (modal) gives the desktop
  card its focus trap, collision handling and arrow, anchored to the target
  element through `PopoverAnchor virtualRef`. Radix `Dialog` (modal, no
  overlay) does the same for the docked and centred cards. Both are already
  dependencies, so the runner adds no package and about 4.7 KB.

The decision rests on the measured sizes, the licences and reading each
library's source and docs. It was not made by prototyping the hardest step in
each library.

### How the runner works

- **`components/tour/definitions.ts`**: `TOURS`, keyed by tour id. A step is
  `{ id, route, target?, side?, align? }`. A step without `target` explains
  something that is not on screen and shows as the centred card.
- **`components/tour/controller.ts`**: a framework-free state machine
  (`TourController`) with `start(tourId, index)`, `next`, `back`, `pause` and
  `handleKey`. Entering a step saves `in_progress` with its index, navigates when
  the step's route is not the current one, and then waits for
  `data-tour="<target>"` on the new page: 3 s after navigating, 0.5 s on the
  same page (the target may still be loading). If the target does not appear,
  the step shows as the centred card (`missing`) and the tour carries on. The
  last Next saves `completed`. Pause (Esc or the close button) writes nothing
  more, because the current step is already saved. Stale waits are dropped when
  the member moves on.
- **`components/tour/tour-provider.tsx`**: the real `TourLauncher`, mounted in
  the dashboard layout above the `Outlet` so a tour survives its own page
  changes. It connects the controller to TanStack Router (the resolved
  location, so a shell anchor such as the account menu is not taken from the
  old page), `document` (the first anchor with a non-zero box, since some are
  mounted twice for desktop and mobile) and `recordTourProgress`. It reports
  `useReportSurfaceBusy("tour", running)`, restores focus to `returnFocus` (or
  `main`) when the tour ends, and shows the paused (with Resume) and completed
  toasts.
- **`components/tour/tour-layer.tsx`**: the click shield, the spotlight (or the
  full dim when no target is lit), and the card: Radix Popover anchored to the
  target on desktop, and a Radix Dialog card docked to the bottom, or to the top
  when the target sits in the bottom 45%, on mobile. The centred card is used
  for pending and missing steps. Focus moves to the step title on every step.
  Arrow keys move between steps inside the card.
- **Resume and restart.** "Take the tour" resumes a paused tour at its saved
  step; the entry card then reads "Resume tour (step k of n)" with "Start over"
  beside it, and "Replay the tour" after completing it (Part B §1.7). The
  highlight modal shows the same label but no "Start over".

## A8. Test plan

**Domain** (`packages/domain/src/whats-new/domain/unread.spec.ts`)

- published after account creation and not seen → unread
- published before or at account creation → never unread, even if not seen
- seen → read
- order of the result follows the input order

**Web content pipeline** (`apps/web/src/whats-new/*.spec.ts`, inline
fixtures)

- frontmatter: valid entry parses with defaults (`highlight`/`notify` false);
  missing required fields, unknown keys, bad category, bad id, `cta.to` not an
  in-app path, `imageAlt` without `image`, `publishedAt` not matching the
  filename date, bad filename → errors (all collected)
- locales: `nl` missing → `en` content with `fallback: true` and one warning;
  `nl` without `en` → error; locale-invariant mismatch between `en` and `nl` →
  error; duplicate ids across entries → error
- markdown: headings demoted (`h2→h4`, `h3→h5`), `h1` rejected, external links
  get `target="_blank"`, fenced code is Shiki-highlighted; HTML assertions
  parse with `parse5` (never regex over HTML)
- ordering: newest first, ties by id
- manifest: `toManifest` keeps only id/publishedAt/highlight/notify/tour;
  `renderManifestSource` is stable; the committed
  `manifest.generated.ts` matches the real `docs/whats-new/` (agreement check)

**Backend** (`packages/backend/convex/whatsNew.test.ts`, convex-test; the
backend reads the manifest through `convex/whatsNew/manifest.ts`, which the
test mocks with fixture entries since W1 ships no real entries)

- unauthenticated calls to all four functions are rejected
- an entry published before the member's account was created is never in
  `unreadIds`, even with no read state
- seen / unseen: an entry published after creation is unread until
  `markWhatsNewSeen([id])`
- `markAllSeen` clears every unread id
- idempotence: repeating `markWhatsNewSeen` / `markAllSeen` keeps a single row
  without duplicate ids
- unknown ids are ignored and not stored; batch over 50 is rejected
- ids that left the manifest are pruned on the next write
- no cross-member writes: member A's writes never change member B's state
- tour progress: insert, update (resume step), complete; unknown tour
  rejected; invalid or missing step rejected

**Build**

- `pnpm --filter @jigswap/web build` runs the plugin end to end (agreement
  check and HTML generation).

---

# Part B: visual design (UI Designer)

## 0. Design language recap (what this builds on)

| Concern                | Existing source                                                                                                                                                    | Used here for                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Brand primary          | `--primary` / `--jigsaw-primary` (violet `#6048e8`, dark `#7560f0`)                                                                                                | CTA, unread pill, spotlight ring, tour progress                                      |
| Surfaces               | `bg-card`, `bg-popover`, `bg-background`, `bg-muted`, `bg-sidebar`                                                                                                 | cards, tour popover, skeletons                                                       |
| Status pills           | `bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200` (`catalog-detail-parts.tsx`), `bg-amber-500/15 … dark:text-amber-400` (`pulse-section.tsx`) | category chips                                                                       |
| Group label typography | sidebar `font-mono text-[10px] font-medium tracking-[0.09em] uppercase`                                                                                            | month headings                                                                       |
| Headings               | `font-heading` (Baloo 2)                                                                                                                                           | entry titles, modal title                                                            |
| Unread count pill      | Messages `SidebarMenuBadge` + mobile tab badge (`bg-jigsaw-primary-accent` pink)                                                                                   | **not reused as-is**, see §3.1 (contrast)                                            |
| Unread dot             | notification bell row `h-2 w-2 rounded-full bg-primary`                                                                                                            | collapsed-sidebar dot                                                                |
| Dismissible notice     | `people.tsx` `DiscoverabilityNotice` (`role="status"`, `bg-muted/60`, `safeStorage`)                                                                               | reference for SSR-safe "seen" reads (`useSyncExternalStore`, server snapshot = seen) |
| Overlay                | `DialogOverlay` `bg-black/50`                                                                                                                                      | modal + tour spotlight dim (same 50% black)                                          |
| Bottom sheet           | `MobileQuickSheet` (`rounded-t-[20px] bg-card`, drag handle `h-1 w-10 bg-border`)                                                                                  | mobile tour card styling                                                             |
| Empty state            | notifications page `Card > CardContent p-12 text-center`, `size-16 rounded-full bg-muted` icon tile                                                                | page empty state                                                                     |

Icon for the feature everywhere: **`Sparkles`** (lucide). Category icons: `Rocket` (feature),
`TrendingUp` (improvement), `Wrench` (fix). Tour: `Compass`.

---

## 1. `/whats-new` page

### 1.1 Shell integration

- Route `/_dashboard/whats-new`. `ROUTE_META["/whats-new"] = { pageKey: "whatsNew" }`, with no
  group. Like `/profile`, it is a top-level page with no crumb row, so the shell page head
  renders `shell.pages.whatsNew.title` / `.subtitle`.
- The page is reached from the sidebar footer entry (§3.1), the user menu (§3.2), the mobile quick
  sheet (§3.3), the modal (§4), the notification (§6) and the command palette (free, via
  ROUTE_META).
- Reading column: `mx-auto w-full max-w-3xl`. It ignores the shell "full width" preference
  because long prose lines read badly.

### 1.2 Structure

```
<div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
  <section aria-labelledby="m-2026-10">            ← one per month, newest first
    <h2 id="m-2026-10" class="month-heading">October 2026</h2>
    <ol class="flex flex-col gap-4">                ← entries newest first
      <li><article id="entry-{id}" …>…</article></li>
    </ol>
  </section>
</div>
```

- **Month heading:** `flex items-center gap-3 font-mono text-[11px] font-medium uppercase
tracking-[0.09em] text-muted-foreground` with a trailing hairline
  `<span aria-hidden class="h-px flex-1 bg-border" />`. Month label from
  `Intl.DateTimeFormat(locale, { month: "long", year: "numeric" })` (nl gives "oktober 2026").
  It is not sticky, since there are few entries per month and sticky headers fight the sticky
  mobile top bar.
- **Ordering:** by `publishedAt` desc, both across months and within a month.
- Each `<article>` gets `scroll-mt-20` (mobile top bar 56px plus breathing room) so
  `/whats-new#entry-{id}` deep links from the notification and modal land cleanly.

### 1.3 Entry card

Built on `Card` (`rounded-xl border bg-card shadow-sm`). The content order is fixed:

1. **Meta row:** `flex flex-wrap items-center gap-2 text-sm`
   - Category chip (§1.4)
   - `<time dateTime="2026-10-14" class="text-muted-foreground">14 Oct 2026</time>`
     (`date-fns` `format(…, "PP", { locale: useDateFnsLocale() })`)
   - Unread marker (§1.5), pushed right with `ml-auto`
2. **Title:** `<h3 class="font-heading text-xl font-semibold leading-tight text-card-foreground">`
3. **Summary (lead):** `<p class="text-muted-foreground">`. Authors should not repeat the summary
   in the body.
4. **Image (optional):** `<img loading="lazy" decoding="async" class="aspect-video w-full
rounded-lg border bg-muted object-cover">`. Alt text: see open item O1.
5. **Body:** rendered Markdown in `<div class={WHATS_NEW_PROSE}>` (§1.6).
6. **Actions (only when `cta` or `tour`):** `flex flex-wrap gap-2 pt-1`
   - Tour present: `Button` (default, `bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90`,
     the same treatment as the top bar "Add puzzle") with the `Compass` icon showing the tour
     label (§1.7), plus the CTA as `Button variant="outline"` with a trailing `ArrowRight`.
   - No tour: the CTA becomes the primary button.
   - Mobile (`<sm`): both buttons `w-full` (`flex-col sm:flex-row`); primary first in DOM and
     visually.

Padding `p-5 sm:p-6`; internal rhythm `flex flex-col gap-3`; image and body get `gap-4` around
them via `mt-1`.

Unread card state: `border-primary/30 bg-jigsaw-primary/5 dark:bg-jigsaw-primary/10`. This tint
is subtle and comes **in addition to** the text "New" pill, never instead of it, so the state
does not rely on colour alone.

### 1.4 Category chips (both themes, measured contrast)

Base: `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold
[&>svg]:size-3`, with the icon `aria-hidden`. The chips are labels, not filters (see
out-of-scope).

| Category                                   | Classes                                                                                   | Light ratio | Dark ratio |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------- | ---------- |
| feature: "Feature" / "Functie"             | `bg-jigsaw-primary/10 text-jigsaw-primary dark:bg-jigsaw-primary/20 dark:text-violet-300` | 5.1:1       | 6.3:1      |
| improvement: "Improvement" / "Verbetering" | `bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200` (existing pill)    | 6.5:1       | 10.3:1     |
| fix: "Fix" / "Oplossing"                   | `bg-amber-500/15 text-amber-800 dark:text-amber-400`                                      | 6.3:1       | 6.5:1      |

Ratios were computed against `--card` in each theme with alpha blending.
Notes:

- **Fix uses `text-amber-800`, not the existing `text-amber-700`**, because amber-700 on
  amber-500/15 measures 4.49:1 and just fails AA at 12px.
- **Feature dark uses `text-violet-300`.** `text-jigsaw-primary` on its own 20% tint is only
  2.6:1 in dark mode. `violet-300` is a Tailwind palette colour, consistent with the codebase's
  existing palette-coloured status pills (green-_, amber-_).
- Map these in one `CATEGORY_META` record (`icon`, `className`, `labelKey`) and reuse it in the
  page, the modal and the notification accent.

### 1.5 Unread marker on entries

- "Unread" means `publishedAt > member.createdAt` and the entry id is not in the member's seen
  set (Part A §A3). Pre-account entries count as read (user decision).
- **Snapshot rule:** visiting `/whats-new` marks everything seen (server write after first
  render), but the page keeps the **unread set captured at mount**, so the "New" pills stay
  visible for the whole visit and only disappear on the next visit. Without this the markers
  would flash and vanish.
- The marker is a text pill: `rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase
tracking-wide bg-primary text-primary-foreground dark:bg-violet-300 dark:text-background`
  with the label "New" / "Nieuw". Contrast: 5.8:1 light, 8.9:1 dark. Plain `bg-primary` in dark
  mode is only 3.8:1.
- A11y: the pill is real text. Also prefix the `<h3>` with `<span class="sr-only">New: </span>` so
  heading navigation announces it.

### 1.6 Markdown body styling **[NEW-ish]**

`.docs-prose` is tied to the marketing `--mk-*` tokens and the 17px marketing type scale, so it
cannot be reused. Define one exported class-string constant in the feature folder, built from
app tokens only:

```ts
export const WHATS_NEW_PROSE = cn(
  "text-[15px] leading-relaxed text-card-foreground",
  "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h4]:font-heading [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold",
  "[&_h5]:mt-4 [&_h5]:mb-1.5 [&_h5]:font-semibold",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li::marker]:text-jigsaw-primary",
  "[&_a]:text-primary [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary/80",
  "[&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
  "[&_img]:my-4 [&_img]:rounded-lg [&_img]:border",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
);
```

Headings inside the body start at h2 in Markdown but must render **below** the card's h3. The
pipeline demotes them (`h2 → h4`, `h3 → h5`, deeper → `h6`; an `h1` is a build error), so the
selectors above target `[&_h4]`/`[&_h5]` (resolved O3, Part A §A1).

### 1.7 Tour button states (on the card and in the modal)

| Tour state for member     | Primary button                                                | Secondary                                       |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| never started / completed | `Compass` "Take the tour" (completed shows "Replay the tour") | none                                            |
| paused at step _k_        | `Compass` "Resume tour (step 3 of 5)"                         | `Button variant="ghost" size="sm"` "Start over" |

Resume state comes from the saved tour progress. Both labels are i18n plurals/params (§9).

### 1.8 Wireframes

**360px** (mobile top bar plus tab bar from the shell; page gutter `px-4`):

```
┌──────────────────────────────────┐
│ ‹  What's new              🔍 🔔 ◯│  mobile top bar (title only)
├──────────────────────────────────┤
│ OCTOBER 2026 ─────────────────── │  month heading (mono, muted)
│ ┌──────────────────────────────┐ │
│ │ (🚀 Feature) 14 Oct    [NEW] │ │  chip · date · pill
│ │ Households: share one shelf  │ │  h3 font-heading xl
│ │ Pool your puzzles with the   │ │  summary, muted
│ │ people you live with.        │ │
│ │ ┌──────────────────────────┐ │ │
│ │ │        16:9 image        │ │ │
│ │ └──────────────────────────┘ │ │
│ │ Body markdown paragraph …    │ │
│ │ • bullet                     │ │
│ │ ┌──────────────────────────┐ │ │
│ │ │ 🧭 Take the tour          │ │ │  primary, full width
│ │ └──────────────────────────┘ │ │
│ │ ┌──────────────────────────┐ │ │
│ │ │ Open household         → │ │ │  outline, full width
│ │ └──────────────────────────┘ │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ (🔧 Fix) 3 Oct               │ │  read entry: no pill, no tint
│ │ Names no longer show "null"  │ │
│ │ …                            │ │
│ └──────────────────────────────┘ │
│ SEPTEMBER 2026 ───────────────── │
│ …                                │
├──────────────────────────────────┤
│  ⌂     📖     (+•)    ⇄     👥   │  tab bar (dot on + : §3.3)
└──────────────────────────────────┘
```

**Desktop (≥1024, sidebar expanded):**

```
┌──────────┬──────────────────────────────────────────────────────────┐
│ sidebar  │  What's new                                              │
│          │  Fresh features, improvements and fixes.                 │
│ …        │                                                          │
│          │        OCTOBER 2026 ──────────────────────────────       │
│          │        ┌────────────────────────────────────────────┐    │
│          │        │ (🚀 Feature) 14 Oct 2026            [NEW]  │    │
│          │        │ Households: share one shelf                │    │
│          │        │ Pool your puzzles with the people you…     │    │
│          │        │ ┌────────────────────────────────────────┐ │    │
│          │        │ │               16:9 image               │ │    │
│          │        │ └────────────────────────────────────────┘ │    │
│          │        │ Body markdown …                            │    │
│          │        │ [🧭 Take the tour] [Open household →]       │    │
│          │        └────────────────────────────────────────────┘    │
│ ──────── │        ┌────────────────────────────────────────────┐    │
│ ✨ What's│        │ (📈 Improvement) 9 Oct 2026                │    │
│   new [2]│        │ …                                          │    │
│ ◯ Sander │        └────────────────────────────────────────────┘    │
└──────────┴──────────────────────────────────────────────────────────┘
               max-w-3xl centred reading column
```

### 1.9 Loading state

Shown while the entry index or the member's seen-state query is `undefined`. The entries are
bundled at build time, so this is mostly the seen-state wait. Render the real layout but do not
compute "New" markers until seen-state arrives, so pills do not flash in.

- If entries are bundled synchronously: render the cards immediately **without** pills or tint,
  then add pills when seen-state lands. There is no skeleton in that case, which is preferred.
- If entries are fetched: show the skeleton with `aria-busy="true"` on the column and an sr-only
  `role="status"` "Loading updates…":

```
OCTOBER 2026 ─────────            ← Skeleton h-3 w-28
┌───────────────────────────┐
│ ▭▭▭▭  ▭▭▭▭▭               │     ← Skeleton h-5 w-20 rounded-full / h-4 w-24
│ ▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭           │     ← h-6 w-3/4
│ ▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭      │     ← h-4 w-full, h-4 w-2/3
└───────────────────────────┘
(×2 cards)
```

Use `Skeleton` (`bg-accent animate-pulse`), with `motion-reduce:animate-none` on each.

### 1.10 Empty state

This happens with no entries for the locale, which is mainly dev and preview.

```
┌───────────────────────────────┐
│            ( ✨ )             │  size-16 rounded-full bg-muted, Sparkles size-8 text-muted-foreground
│      No updates yet           │  h2 text-lg font-medium
│ New features and fixes will   │  text-sm text-muted-foreground
│ show up here.                 │
└───────────────────────────────┘
```

`Card > CardContent className="p-12 text-center"`, identical to the notifications empty state.

### 1.11 Page a11y

- One `h1` (shell page head), `h2` per month (labels its `<section>`), `h3` per entry, body
  headings demoted to `h4/h5`.
- Entries are an `<ol>` (order matters); each `<article aria-labelledby="entry-{id}-title">`.
- External links in bodies get `target="_blank" rel="noopener"` plus the existing
  external-link treatment from the docs pipeline (`rehype-external-links`).
- Arriving via `#entry-{id}`: scroll there (`behavior: "auto"` under reduced motion) and move
  focus to the article's `h3` (`tabIndex={-1}`, `focus-visible:outline-none`) so screen
  readers start at the right entry.

---

## 2. Category chip, unread marker and count: shared tokens summary

| Element                                                     | Light                                                                | Dark                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Unread count pill (sidebar / sheet)                         | `bg-primary text-primary-foreground` (5.8:1)                         | `dark:bg-violet-300 dark:text-background` (8.9:1) |
| Unread dot (collapsed sidebar, user-menu icon, tab-bar "+") | `size-2 rounded-full bg-jigsaw-primary-accent ring-2 ring-{surface}` | same; dots are non-text (3:1 vs surface is met)   |
| "New" pill on entry                                         | as count pill                                                        | as count pill                                     |
| Unread card tint                                            | `border-primary/30 bg-jigsaw-primary/5`                              | `dark:bg-jigsaw-primary/10`                       |

**Why not the pink Messages pill?** White on `#ec4899` is 3.5:1, which fails AA for 10–12px
text. Pink also signals "someone is waiting on you" (messages, swap requests). What's new is
informational, so violet keeps it calmer and passes contrast. The **dots** do use pink accent,
because a dot carries no text and has to pop at 8px.

---

## 3. Badge placement

### 3.1 Desktop sidebar: footer entry

Add a single `SidebarMenu` **inside `SidebarFooter`, above `UserFooter`**, with one item:
`Sparkles` "What's new". It is not part of NAV_GROUPS: it is a meta destination, not a library or
community area, and the footer is where the identity and "about the app" chrome lives.

```
expanded                                 collapsed (icon rail)
│ ─────────────────────────── │          │ ─── │
│ ✨ What's new          [ 2 ]│          │ ✨• │   dot top-right of icon
│ ◯  Sander Verkuil           │          │ ◯   │
│    s***@pm.me               │
```

- `SidebarMenuButton asChild isActive={pathname === "/whats-new"} tooltip={title}` wrapping
  `<Link href="/whats-new">` with the `data-tour="whats-new-entry"` target.
- Count: `SidebarMenuBadge aria-hidden className="rounded-full bg-primary text-primary-foreground
dark:bg-violet-300 dark:text-background"` showing `formatUnreadCount(n)` (caps at 9 → "9+";
  more than 9 unseen entries is unrealistic).
- In the collapsed rail `SidebarMenuBadge` is hidden by the sidebar primitive, so add a dot:
  `<span aria-hidden class="pointer-events-none absolute right-1.5 top-1.5 hidden size-2
rounded-full bg-jigsaw-primary-accent ring-2 ring-sidebar
group-data-[collapsible=icon]:block" />` on the menu item.
- SR: inside the link, `<span class="sr-only">{whatsNew.unreadCount}</span>`, the exact pattern
  Messages uses.

### 3.2 User menu (Clerk `UserButton`)

`ShellUserButton` is shared by desktop and mobile, so one entry covers both:

```
┌──────────────────────────┐
│ 👤 My profile             │
│ ✨• What's new            │   ← UserButton.Link, labelIcon = Sparkles + dot
│ 🛡 Admin                  │
│ ⚙ Manage account          │
│ ↪ Sign out                │
└──────────────────────────┘
```

- `UserButton.Link label={t("whatsNew.menuLabel")} href="/whats-new"` with `labelIcon`
  `<span class="relative"><Sparkles class="size-4"/>{unread>0 && <span class="absolute
-right-1 -top-1 size-2 rounded-full bg-jigsaw-primary-accent ring-2 ring-popover"/>}</span>`.
- Clerk's `label` is a plain string, so the count cannot be styled. When unread, pass
  `label = t("whatsNew.menuLabelUnread", { count })` ("What's new (2)"), which also gives SR users
  the count.
- **No dot on the avatar itself.** The sidebar entry covers desktop and the quick sheet covers
  mobile. A dot on the avatar would compete with the notification bell.

### 3.3 Mobile: tab bar and quick sheet

The tab bar has four fixed destinations plus "+", and there is no room for a fifth.

- **Quick sheet:** add a sixth row at the bottom (after Profile), same anatomy as the existing
  rows: violet icon chip `Sparkles`, title "What's new", sub "Latest features and fixes", and
  **the count pill before the chevron** (`h-5 min-w-5 rounded-full px-1.5 text-xs font-semibold
tabular-nums` with the count-pill colours from §2). Navigates to `/whats-new`.
- **Tab bar "+":** when unread > 0, a dot on the raised button: `absolute right-0.5 top-0.5 size-2.5
rounded-full bg-jigsaw-primary-accent ring-2 ring-card` (aria-hidden). Its `aria-label` becomes
  `shell.mobile.openQuickActionsUnread` ("Quick actions, 2 updates").

```
360px quick sheet
┌──────────────────────────────────┐
│              ────                │ drag handle
│ (+)  Add a puzzle             ›  │
│ (✓)  Log a completion         ›  │
│ (⇄)  Propose a swap           ›  │
│ (🔍) Browse community         ›  │
│ (👤) Profile                  ›  │
│ (✨) What's new        [ 2 ]  ›  │  ← new row, pill before chevron
└──────────────────────────────────┘
```

### 3.4 Badge a11y and live announcements

- Visual counts and dots are always `aria-hidden`. Each trigger carries the count in its
  accessible name (sr-only span or aria-label).
- **aria-live:** a single shell-level `<div role="status" aria-live="polite" class="sr-only">`
  owned by the what's-new provider. It announces **only on an increase after hydration**
  ("1 new update in What's new"). It does not announce on first load or on decrease. Without
  this, a badge sitting in the sidebar would be read on every route change, or never. One region
  avoids duplicate announcements from the sidebar, sheet and menu, which all render the same
  count.
- The count is 0 while seen-state loads (server snapshot = "seen", the same approach as
  `DiscoverabilityNotice`), so nothing flashes during SSR.

---

## 4. Highlight modal

### 4.1 Rules (visual-facing)

- At most one per session: the newest unseen entry with `highlight: true`.
- Shown only when no other dialog, sheet, tour or onboarding prompt is open. If one is open, it
  defers and retries on the next route change in the same session. It is never queued on top.
- Never shown on `/whats-new` itself; the page already marks things seen.
- Delay about 600ms after route settle so it does not fight page-load focus.
- Any close marks that entry's modal as seen, and also the entry as read.

### 4.2 Anatomy

`Dialog` + `DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0
sm:max-w-md"`. The built-in close X stays (`showCloseButton`), with a `bg-background/80
backdrop-blur-sm rounded-full p-1` treatment when it overlaps the image.

```
desktop (sm:max-w-md = 448px)              360px (328px wide)
┌──────────────────────────────────┐      ┌────────────────────────────┐
│ ┌──────────────────────────────┐ │      │ ┌────────────────────────┐ │
│ │                          (×) │ │      │ │                    (×) │ │
│ │       16:9 image (cover)     │ │      │ │      16:9 image        │ │
│ └──────────────────────────────┘ │      │ └────────────────────────┘ │
│  ✨ NEW IN JIGSWAP · (🚀 Feature) │      │ ✨ NEW IN JIGSWAP          │
│  Households: share one shelf     │      │ (🚀 Feature)               │
│  Pool your puzzles with the      │      │ Households: share one      │
│  people you live with, and pick  │      │ shelf                      │
│  per copy who may lend it.       │      │ Pool your puzzles with …   │
│                                  │      │ ┌────────────────────────┐ │
│  See all updates                 │      │ │ 🧭 Take the tour        │ │
│     [Later] [Open hh] [🧭 Tour]   │      │ └────────────────────────┘ │
└──────────────────────────────────┘      │ ┌────────────────────────┐ │
                                          │ │ Open household       → │ │
                                          │ └────────────────────────┘ │
                                          │        Maybe later         │
                                          │      See all updates       │
                                          └────────────────────────────┘
```

- **Media:** with `image`, use `<img class="aspect-video w-full bg-muted object-cover">` flush to
  the top edge (the dialog is `p-0 overflow-hidden`, so the radius clips it). Without an image,
  use a header band `flex h-28 items-center justify-center bg-jigsaw-primary-tint` with a
  `size-14 rounded-2xl bg-card text-jigsaw-primary shadow-sm` tile holding `Sparkles size-7`. It
  is decorative and aria-hidden.
- **Body:** `flex flex-col gap-2 p-6 pt-5`
  - Eyebrow: `flex flex-wrap items-center gap-2`, with `<span class="font-mono text-[11px]
uppercase tracking-[0.09em] text-muted-foreground">New in JigSwap</span>` and the
    category chip (§1.4).
  - `DialogTitle class="font-heading text-2xl font-semibold leading-tight text-left"`
  - `DialogDescription class="text-muted-foreground text-left"` showing the `summary` only. No
    Markdown body in the modal.
- **Footer:** `DialogFooter className="border-t bg-muted/40 px-6 py-4"`. `DialogFooter` is
  already `flex-col-reverse sm:flex-row sm:justify-end`, so on mobile the primary ends up on top.
  - Primary: tour exists → "Take the tour" (`Compass`). Otherwise the CTA. Otherwise "Read more"
    → `/whats-new#entry-{id}`.
  - Secondary (`outline`): the CTA when the primary is the tour.
  - Tertiary (`ghost`): "Maybe later". It closes and marks seen.
  - "See all updates": `Button variant="link" size="sm"` as the last item on mobile, and
    left-aligned on desktop via `sm:mr-auto`.
  - All buttons are `w-full sm:w-auto`.
- CTA or tour click: close the dialog **first**, then navigate or start the tour, so focus is not
  restored to a node that is about to unmount.

### 4.3 Modal a11y

- Radix Dialog gives `role="dialog"`, `aria-modal`, focus trap, Esc to close, inert background
  and focus restore.
- Initial focus goes to the **primary button** (`onOpenAutoFocus` → `primaryRef.focus()`), not
  the close X, which Radix would otherwise pick first. The title and description are still read
  through `aria-labelledby`/`aria-describedby`.
- Esc, X, overlay click and "Maybe later" all mean "seen, dismissed". There is no "remind me".
- Focus restore: the opener is not a user trigger, so let Radix restore to the previously focused
  element. If that is `body`, do nothing.
- Image: see O1. Without `imageAlt` it is `alt=""` (decorative), since the title and summary
  carry the meaning.
- Contrast: all text uses card and popover tokens already verified in §1.4 and §2.
- Motion: the existing `zoom-in-95 fade-in-0` from `DialogContent`. Under reduced motion, add
  `motion-reduce:animate-none` to content and overlay **[NEW-ish: className on usage, not the
  primitive]**.

---

## 5. Multi-step tour

### 5.1 Decision: spotlight with an anchored popover (desktop) or a docked card (mobile)

- **Spotlight: yes.** The tour points at specific controls that are often small (sidebar items,
  tab-bar "+", a filter). A dimmed page with a cut-out says "this one" more clearly than an arrow
  alone, and it blocks stray clicks that would break the step sequence.
- **Target is not interactive during the tour.** Steps describe; they do not require the member
  to act. This keeps the state machine simple (interactive steps are out of scope).

### 5.2 Layers (z-order, all inside one portal)

```
z-50  ┌ click shield: fixed inset-0, transparent, pointer-events-auto (eats outside clicks)
z-50  ├ spotlight ring: fixed, at target rect + 6px pad
      │   rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background
      │   shadow-[0_0_0_9999px_rgb(0_0_0/0.5)]  ← the dim (same 50% black as DialogOverlay)
      │   pointer-events-none
      │   transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none
      │   forced-colors:shadow-none forced-colors:outline forced-colors:outline-2 forced-colors:outline-[Highlight]
z-50  └ step card: Radix Popover (desktop) / fixed docked card (mobile)
```

- The radius follows the target: pass an optional `radius` per step (`rounded-full` for the "+"
  button and avatar). The default is `rounded-lg`.
- Spotlight geometry updates on scroll, resize and target `ResizeObserver` via
  `requestAnimationFrame`.
- If the target is in a scroll container, it is scrolled into view first: `block: "center"`
  on desktop; on mobile, centred within the space the docked card leaves (§5.5).

### 5.3 Step card (desktop popover)

Radix `Popover` (open-controlled, `modal`), anchored with `PopoverAnchor virtualRef` to the
target's rect. `PopoverContent side={step.side ?? "bottom"} align={step.align ?? "start"}
sideOffset={12} collisionPadding={16} className="w-80 p-0"`.

- **Arrow:** yes on desktop. Use `PopoverPrimitive.Arrow width={14} height={7} className="fill-popover"`.
  **[NEW-ish: export `PopoverArrow` from `components/ui/popover.tsx`, a one-line re-export.]**
  The popover's `shadow-md` defines its edge, so the arrow needs no stroke. Radix hides the arrow
  automatically when the popover cannot align with the anchor.

```
              ┌───────────────┐
              │  target (lit) │  ← spotlight ring, rest of page dimmed
              └───────────────┘
                   ▲
┌──────────────────┴─────────────────────┐ w-80
│ STEP 2 OF 5                        (×) │ mono eyebrow · ghost icon btn "End tour"
│ Your shared shelf                      │ font-heading text-lg font-semibold
│ Copies everyone in your household owns │ text-sm text-muted-foreground
│ show up here, with who may lend them.  │
│                                        │
│ ● ━━ ○ ○ ○                              │ progress (aria-hidden)
├────────────────────────────────────────┤ border-t
│ [‹ Back]                     [Next ›]  │ ghost sm · default sm
└────────────────────────────────────────┘
```

- Header `flex items-start justify-between gap-3 px-4 pt-4`
  - Eyebrow `font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground`, showing
    "Step 2 of 5".
  - Close: `Button variant="ghost" size="icon" className="size-7 -mr-1 -mt-1"` with `X`,
    `aria-label="End tour"`.
- Title `px-4 pt-1 font-heading text-lg font-semibold leading-snug` (`id` for labelledby).
- Body `px-4 pt-1 text-sm text-muted-foreground` (`id` for describedby). Plain text or a short
  inline-Markdown subset; no images in steps (out of scope).
- Progress `flex items-center gap-1.5 px-4 pt-3 pb-4`: one segment per step; done/upcoming
  `size-1.5 rounded-full bg-border`, current `h-1.5 w-4 rounded-full bg-primary`, with
  `transition-[width] motion-reduce:transition-none`. Past steps use `bg-primary/40`.
- Footer `flex items-center justify-between gap-2 border-t px-3 py-2.5`
  - Back: `Button variant="ghost" size="sm"` + `ChevronLeft`. **Hidden** (not just disabled) on
    step 1; a spacer keeps Next right-aligned.
  - Next: `Button size="sm" className="bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90"`
    - `ChevronRight`. On the last step the label is "Done" with a `Check` icon.
- **Cross-route step:** when the next step's target is on another route, the Next label becomes
  "Next: Library" (`tour.nextOnPage`), the route navigates, and the card shows a pending state
  while the target mounts: spotlight hidden, card centred (no anchor, no arrow), body replaced
  by `Loader2 animate-spin motion-reduce:animate-none` + "Opening Library…". Timeout 3s.
- **Missing target fallback:** if the target never appears (feature flag, empty list, collapsed
  section), show the step as a **centred card** (fixed, `top-1/2 left-1/2 -translate-1/2`) with
  no spotlight cut-out (full dim) and no arrow. The content stays readable and the tour does
  not dead-end.
- **Last step:** after Done, a sonner toast `toast.success(t("tour.completed"))` with the
  title "You're all set". The spotlight fades out.

### 5.4 Keyboard and focus (tour)

| Key             | Action                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Tab / Shift+Tab | cycle within the card (focus trapped by `Popover modal`)                                |
| Enter / Space   | activate focused button                                                                 |
| →               | Next (when focus is inside the card and not on a text field, which steps never contain) |
| ←               | Back (ignored on step 1)                                                                |
| Esc             | **pause** the tour (= "End tour" X)                                                     |

- Card semantics: `role="dialog" aria-modal="true" aria-labelledby={titleId}
aria-describedby={bodyId} aria-roledescription="tour step"`.
- **Focus on each step:** move focus to the card's title (`tabIndex={-1}`) via
  `onOpenAutoFocus` / on step change, so SR users hear "Step 2 of 5, Your shared shelf, …".
  Include the eyebrow text in the labelledby (`aria-labelledby="{eyebrowId} {titleId}"`). The
  first Tab lands on Back (or Next on step 1).
- A polite live region is **not** needed for step changes, since the focus move announces. Use
  the shell region (§3.4) only for "Tour paused" and "Tour completed".
- **Pause (Esc or X):** save `{tourId, stepIndex}`, remove the overlay, restore focus to the
  element that started the tour (the "Take the tour" button, if still mounted, or else `main`),
  and show the toast `tour.paused` with an action button "Resume". Resuming later shows
  "Resume tour (step 3 of 5)" on the entry (§1.7).
- The spotlit target gets `aria-describedby` pointing at the step body while lit, so a member who
  focuses it after the tour still hears the context. **[optional]**

### 5.5 Mobile behaviour (`<md`): docked card, not a popover

At 360px an anchored popover with an arrow collides with almost everything (top bar, tab bar,
narrow targets). Mobile uses the same spotlight plus a **card docked to the bottom**, styled
like `MobileQuickSheet`. It is **not** the Radix `Sheet`: that dims the whole screen and would hide
the spotlight.

- Card: `fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 rounded-[20px]
border bg-card shadow-lg`, with the same inner header, body, progress and footer as desktop.
  There is no drag handle (it is not draggable, so a handle would lie).
- If the target sits in the **bottom 45% of the viewport after scrolling** (tab bar "+",
  bottom-of-page controls), dock the card to the top instead:
  `top-[calc(68px+env(safe-area-inset-top))]` (below the 56px top bar).
- Scroll the target into the visible band above (or below) the card before showing the
  spotlight.
- No arrow (`Arrow` is not rendered); the spotlight ring is the pointer.
- Footer buttons grow to touch size: `size="default"` (h-9) plus `min-h-11` on the Next and
  Back buttons for 44px targets. The close X uses `size-11`.
- Swipe gestures: none (out of scope). Buttons only.

```
360px, target in upper half                360px, target is the tab-bar "+"
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ ‹  Library                 🔍 🔔 ◯│      │ ‹  Dashboard               🔍 🔔 ◯│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│      │┌────────────────────────────────┐│
│▓▓┌────────────────────────────┐▓▓│      ││ STEP 1 OF 3               (×)  ││
│▓▓│  Household shelf (lit)     │▓▓│      ││ Add puzzles fast               ││
│▓▓└────────────────────────────┘▓▓│      ││ Tap + for quick actions …      ││
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│      ││ ━━ ○ ○                         ││
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│      ││                     [ Next › ] ││
│┌────────────────────────────────┐│      │└────────────────────────────────┘│
││ STEP 2 OF 5               (×)  ││      │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ Your shared shelf              ││      │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ Copies everyone in your …      ││      │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ ● ━━ ○ ○ ○                     ││      │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
││ [‹ Back]            [ Next › ] ││      │▓▓  ▓▓  ( + ) ▓▓  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← lit, rounded-full
│└────────────────────────────────┘│      └──────────────────────────────────┘
└──────────────────────────────────┘
```

### 5.6 Reduced motion (`prefers-reduced-motion: reduce`)

| Element                          | Default                                             | Reduced                                                                           |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Spotlight moving between targets | 300ms ease-out on top/left/width/height             | jump (`motion-reduce:transition-none`)                                            |
| Step card enter                  | Popover `fade-in-0 zoom-in-95 slide-in-from-*-2`    | `motion-reduce:animate-none` (instant)                                            |
| Mobile card                      | `slide-in-from-bottom-4 fade-in-0` (tw-animate-css) | `motion-reduce:animate-none`                                                      |
| Target scroll                    | `scrollIntoView({ behavior: "smooth" })`            | `behavior: "auto"` (read `matchMedia` once per step)                              |
| Progress segment width           | `transition-[width] duration-200`                   | none                                                                              |
| Pending spinner                  | `animate-spin`                                      | `motion-reduce:animate-none` (static loader icon plus text still says "Opening…") |
| Modal                            | zoom/fade                                           | `motion-reduce:animate-none`                                                      |
| Skeletons                        | `animate-pulse`                                     | `motion-reduce:animate-none`                                                      |

Nothing in this feature auto-plays. Images are static (animated GIF/WebP is out of scope, O2).

### 5.7 Tour a11y checklist

- Focus is trapped in the card while the tour runs. The rest of the page is visually dimmed and
  pointer-blocked. Mark the app root `inert` while active (Radix `modal` popover does this via
  `aria-hidden` on siblings).
- The spotlight ring is 2px `ring-primary` with a 2px offset in `--background`. Contrast vs card:
  6.0:1 light, 3.7:1 dark, both ≥ 3:1 for non-text UI.
- Windows High Contrast / forced colours: the box-shadow dim disappears, so the ring falls back to
  a `Highlight` outline (§5.2).
- Card text uses `popover-foreground` / `muted-foreground`. muted-on-card is 4.8:1 light and
  5.8:1 dark (AA).
- The tour never starts on its own. It starts only from an explicit "Take the tour" click on the
  page or in the modal.

---

## 6. In-app notification

Uses the existing bell and notifications page. Only the type metadata is new.

- New `NotificationType`: `"whats_new"`. This fans out to the enum-literal sync points: schema,
  validators, `notification-meta.ts`, preferences matrix category, and 3 locale files.
- `notificationIcon("whats_new") = Sparkles`; `notificationAccent = "text-jigsaw-primary"`
  (matches the feature chip); `notificationHref = "/whats-new#entry-{entryId}"`.
- Copy: title `notifications.types.whats_new.title` = "New in JigSwap", message = the entry
  `title` (one line; the bell row line-clamps). Summary is not used because it is too long for
  `line-clamp-2` next to the title.
- Category in the preferences matrix: its own `"product"` group (resolved O4, Part A §A6), so
  members can mute it without muting social. Copy is in §9.
- Opening it marks the notification read **and** the entry seen. The badge counts then drop
  together.

```
bell popover row
┌────────────────────────────────────────┐
│ (✨) New in JigSwap                  •  │
│      Households: share one shelf       │
│      2 hours ago                       │
└────────────────────────────────────────┘
```

---

## 7. Coordination of surfaces (visual consequences only)

| Surface                            | Count source              | Clears when                                                   |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Sidebar pill / collapsed dot       | unseen entries            | `/whats-new` visited                                          |
| User-menu label "(n)" and icon dot | same                      | same                                                          |
| Quick-sheet pill and "+" dot       | same                      | same                                                          |
| Entry "New" pill                   | snapshot at page mount    | next visit                                                    |
| Modal                              | newest unseen `highlight` | any close                                                     |
| Bell notification                  | notification row          | opened or mark-all-read; opening it also marks the entry seen |

The bell count and the What's-new count are **separate**. A `notify: true` entry shows in both
until either path is used. That duplication is expected and is cleared by either path.

---

## 8. Component inventory

| New component                      | Built from                                   | Notes                 |
| ---------------------------------- | -------------------------------------------- | --------------------- |
| `WhatsNewPage`                     | Card, Button, Skeleton                       | §1                    |
| `WhatsNewEntryCard`                | Card, Button, `CategoryChip`, `NewPill`      | §1.3                  |
| `CategoryChip`                     | span + `CATEGORY_META`                       | §1.4, reused in modal |
| `WhatsNewNavItem`                  | SidebarMenuItem/Button/Badge                 | §3.1                  |
| `WhatsNewHighlightDialog`          | Dialog*                                      | §4                    |
| `TourOverlay` (spotlight + shield) | fixed divs                                   | §5.2                  |
| `TourStepCard`                     | Popover (+ `PopoverArrow` re-export), Button | §5.3, desktop         |
| `TourDockedCard`                   | div styled like `MobileQuickSheet`           | §5.5, mobile          |
| shell live region                  | sr-only div                                  | §3.4                  |

Only change to `components/ui`: export `PopoverArrow`. Everything else composes existing pieces.

---

## 9. i18n keys (add to `locales/source.json`, `en.json`, `nl.json`)

ICU message format as used elsewhere (`{count, plural, …}`). Dutch uses informal "je", matching
the existing copy.

| Key                                            | en                                                                                      | nl                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `shell.pages.whatsNew.title`                   | What's new                                                                              | Wat is er nieuw                                                                                         |
| `shell.pages.whatsNew.subtitle`                | Fresh features, improvements and fixes.                                                 | Nieuwe functies, verbeteringen en oplossingen.                                                          |
| `shell.pages.whatsNew.description`             | Everything that changed in JigSwap, newest first.                                       | Alles wat er in JigSwap is veranderd, nieuwste eerst.                                                   |
| `titles.whatsNew`                              | What's new — JigSwap                                                                    | Wat is er nieuw — JigSwap                                                                               |
| `shell.mobile.quick.whatsNewSub`               | Latest features and fixes                                                               | De nieuwste functies en oplossingen                                                                     |
| `shell.mobile.openQuickActionsUnread`          | `{count, plural, one {Quick actions, # update} other {Quick actions, # updates}}`       | `{count, plural, one {Snelle acties, # update} other {Snelle acties, # updates}}`                       |
| `whatsNew.menuLabel`                           | What's new                                                                              | Wat is er nieuw                                                                                         |
| `whatsNew.menuLabelUnread`                     | `What's new ({count})`                                                                  | `Wat is er nieuw ({count})`                                                                             |
| `whatsNew.unreadCount`                         | `{count, plural, =0 {No new updates} one {# new update} other {# new updates}}`         | `{count, plural, =0 {Geen nieuwe updates} one {# nieuwe update} other {# nieuwe updates}}`              |
| `whatsNew.announce`                            | `{count, plural, one {# new update in What's new} other {# new updates in What's new}}` | `{count, plural, one {# nieuwe update in Wat is er nieuw} other {# nieuwe updates in Wat is er nieuw}}` |
| `whatsNew.new`                                 | New                                                                                     | Nieuw                                                                                                   |
| `whatsNew.newPrefix`                           | New:                                                                                    | Nieuw:                                                                                                  |
| `whatsNew.category.feature`                    | Feature                                                                                 | Functie                                                                                                 |
| `whatsNew.category.improvement`                | Improvement                                                                             | Verbetering                                                                                             |
| `whatsNew.category.fix`                        | Fix                                                                                     | Oplossing                                                                                               |
| `whatsNew.loading`                             | Loading updates…                                                                        | Updates laden…                                                                                          |
| `whatsNew.empty.title`                         | No updates yet                                                                          | Nog geen updates                                                                                        |
| `whatsNew.empty.body`                          | New features and fixes will show up here.                                               | Nieuwe functies en oplossingen verschijnen hier.                                                        |
| `whatsNew.readMore`                            | Read more                                                                               | Lees meer                                                                                               |
| `whatsNew.seeAll`                              | See all updates                                                                         | Alle updates bekijken                                                                                   |
| `whatsNew.modal.eyebrow`                       | New in JigSwap                                                                          | Nieuw in JigSwap                                                                                        |
| `whatsNew.modal.later`                         | Maybe later                                                                             | Misschien later                                                                                         |
| `whatsNew.tour.take`                           | Take the tour                                                                           | Doe de rondleiding                                                                                      |
| `whatsNew.tour.replay`                         | Replay the tour                                                                         | Rondleiding opnieuw bekijken                                                                            |
| `whatsNew.tour.resume`                         | `Resume tour (step {step} of {total})`                                                  | `Rondleiding hervatten (stap {step} van {total})`                                                       |
| `whatsNew.tour.restart`                        | Start over                                                                              | Opnieuw beginnen                                                                                        |
| `tour.stepOf`                                  | `Step {step} of {total}`                                                                | `Stap {step} van {total}`                                                                               |
| `tour.roleDescription`                         | tour step                                                                               | rondleidingsstap                                                                                        |
| `tour.back`                                    | Back                                                                                    | Terug                                                                                                   |
| `tour.next`                                    | Next                                                                                    | Volgende                                                                                                |
| `tour.nextOnPage`                              | `Next: {page}`                                                                          | `Volgende: {page}`                                                                                      |
| `tour.done`                                    | Done                                                                                    | Klaar                                                                                                   |
| `tour.end`                                     | End tour                                                                                | Rondleiding stoppen                                                                                     |
| `tour.opening`                                 | `Opening {page}…`                                                                       | `{page} openen…`                                                                                        |
| `tour.paused`                                  | Tour paused. You can pick it up again from What's new.                                  | Rondleiding gepauzeerd. Je kunt verder gaan via Wat is er nieuw.                                        |
| `tour.resumeAction`                            | Resume                                                                                  | Hervatten                                                                                               |
| `tour.completedTitle`                          | You're all set                                                                          | Je bent er klaar voor                                                                                   |
| `tour.completed`                               | Tour finished. Enjoy the new feature!                                                   | Rondleiding afgerond. Veel plezier met de nieuwe functie!                                               |
| `notifications.types.whats_new.title`          | New in JigSwap                                                                          | Nieuw in JigSwap                                                                                        |
| `notifications.categories.product.title`       | Product updates                                                                         | Productupdates                                                                                          |
| `notifications.categories.product.description` | New features and changes to JigSwap                                                     | Nieuwe functies en wijzigingen in JigSwap                                                               |

Step copy per tour: `tours.<tourId>.steps.<stepId>.title|body`. It lives with the tour
definitions, is authored per tour and is not listed here. `{page}` resolves from
`shell.pages.<key>.title`. The notification message is the entry title, which comes from
frontmatter, so it needs no key. Exact notification key paths must match the existing
`notificationCopy()` lookup, so check the shape there before adding.

---

## 10. Open items for the spec owner

- **O1 Image alt text.** **Resolved:** the frontmatter has an optional per-locale `imageAlt`
  (Part A §A1). Without it, images render `alt=""` and are treated as decorative. This is
  acceptable only because title and summary always carry the meaning.
- **O2 Animated media (still open, product).** This spec assumes static images. GIF/video would need a pause control
  (WCAG 2.2.2) and reduced-motion handling.
- **O3 Heading demotion** in the Markdown pipeline (§1.6). **Resolved:** the pipeline demotes
  two levels and rejects `h1` (Part A §A1).
- **O4 Notification category:** a new `product` row versus folding into an existing category
  (§6). **Resolved:** own `product` category (Part A §A6).
- **O5 `violet-300`** in dark chips and pills is a Tailwind palette colour, not a project token.
  If the team prefers tokens only, add `--jigsaw-primary-soft` (dark ≈ `oklch(0.81 0.11 294)`)
  in `globals.css`.

  **Resolved:** keep the palette colour. The codebase's status pills already use palette colours
  (`green-*`, `amber-*`), and a token for one shade in one feature is not worth it yet. Revisit if
  a second feature needs the same soft violet.

---

## 11. Out of scope

- Filtering or searching entries by category (the chips are labels only), and pagination.
- Per-entry "mark unread" or "mark all read" on the page (visiting the page marks all seen).
- Reactions, comments or feedback on entries.
- Showing the full Markdown body inside the modal; more than one modal per session; queueing
  modals.
- Interactive tour steps (requiring the member to click the target or fill a field), branching
  tours, auto-starting tours, swipe gestures on the mobile card, images or video inside tour
  steps.
- Tour authoring UI or an admin CMS for entries (they are Markdown in the repo).
- Public/marketing changelog page or RSS feed; email or push copy for `whats_new` beyond the
  in-app notification.
- A What's new dot on the avatar or in the desktop top bar; a dedicated tab-bar tab.
- Changes to the Badge, Dialog or Sidebar primitives (only the `PopoverArrow` re-export is added).
