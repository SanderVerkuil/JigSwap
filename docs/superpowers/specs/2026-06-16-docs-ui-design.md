# Public `/docs` Documentation Experience — Design

**Date:** 2026-06-16
**Branch:** `feature/docs-ui` (based on `analysis/docs-and-findings`)
**Status:** Design — awaiting implementation plan

## 1. Summary

Add a **public `/docs`** section to the JigSwap web app where end-users can **browse and search** the user documentation. The documentation stays authored in **Markdown** (the source of truth) and is compiled to **statically generated HTML** at build time. The single `docs/user-guide.md` is reorganized into a multi-file, task-oriented tree under `docs/user/<scope>/...`, and the architecture reserves a clearly-separated **Developers** section for later.

The experience is built **in-app** as TanStack Start routes — not via a standalone generator — reusing the existing marketing chrome, the `--mk-*` design-token system (with automatic dark mode), the `LegalDoc` reading-column/scroll-spy precedent, and the `cmdk` command palette. The only genuinely net-new pieces are a Markdown→HTML build pipeline and a static search index.

This design synthesizes parallel input from the UX Researcher (information architecture, journeys), UX Architect (build approach decision), Frontend Developer (feasibility, libraries), and UI Designer (visual spec).

## 2. Goals & Non-Goals

### Goals

- Public, no-sign-in `/docs` that helps both prospective and existing users.
- Browse by topic (sidebar nav) + full-text search.
- Markdown remains the editable source of truth; HTML generated statically (no per-request rendering, no backend search).
- Beautiful and fully on-brand (light + dark), reusing existing tokens/components.
- Deep-linkable to a specific page + heading anchor (for future in-app "Learn more" links).
- Mobile-first reading experience.
- Split the existing user guide into `docs/user/<scope>/...` **as part of this work, in this branch**.
- Capture "Was this page helpful?" feedback, persisted to Convex.

### Non-Goals (v1)

- The Developers section (architecture supports it; content comes later).
- Localized/translated docs (English only for v1; folder structure supports `docs/user/<locale>/...` later).
- Embedding live React components in docs (no MDX; plain CommonMark only).
- In-app contextual "Learn more" deep links (the docs make them _possible_; wiring call-sites is out of scope here).

## 3. Decision: In-app route vs. standalone generator

**Decision: in-app TanStack Start routes.** A standalone generator (Astro Starlight / VitePress) was evaluated and rejected **for this repo specifically**:

- JigSwap already owns the parts a generator would provide: a themed `--mk-*` token system with `.dark` inversion, the `_public` marketing chrome (header/footer), a `cmdk` palette, `use-intl` i18n, and `LegalDoc` — which is already a docs-style sticky-TOC reading layout.
- A generator would import a _second_ design system, _second_ toolchain, _second_ i18n model, and likely a _second_ deployment, then require ongoing work to make it match the brand. That is the opposite of "less to build" here.
- The only missing capabilities — parse Markdown, build a static search index — are small off-the-shelf libraries.

Starlight/VitePress remain a fallback if timelines collapse; notably their search engine (Pagefind) is the same one recommended below, so the search approach is portable.

## 4. Information Architecture (content split)

Reorganize `docs/user-guide.md` (16 flat sections) into **6 task-oriented groups** that mirror the app's own navigation grouping, so users transfer their mental model between app and docs. Each Markdown file carries frontmatter (`title`, `order`, optional `summary`).

```
docs/user/
  index.md                              → User Guide landing/overview hub

  getting-started/
    index.md
    accounts-and-sign-in.md             ← §1
    finding-your-way-around.md          ← §2 (dashboard, nav groups, command palette)
    language-and-region.md              ← §15

  your-library/
    index.md
    managing-your-puzzles.md            ← §3
    adding-and-importing.md             ← §4
    collections.md                      ← §5
    completions-and-goals.md            ← §6
    insights-and-stats.md               ← §7

  sharing-and-exchanges/
    index.md
    visibility-and-privacy.md           ← §8
    lend-swap-trade.md                  ← §9
    friend-circles.md                   ← §11

  discovering-and-community/
    index.md
    discovering-puzzles.md              ← §10
    people-and-following.md             ← §12
    your-profile-and-shelf.md           ← §13

  staying-informed/
    index.md
    notifications.md                    ← §14

  help/
    index.md
    faq-and-troubleshooting.md          ← §16
```

Rules during the split:

- **Stable, task-named slugs** (`visibility-and-privacy`, never `section-8`) — they are the future deep-link contract.
- Every existing internal anchor in `user-guide.md` (e.g. `#11-friend-circles`) is **re-mapped** to a valid new `page#anchor` target. No dead in-doc links is a release gate.
- Do not pad short pages (Notifications, Language) to balance length; single-purpose pages deep-link and search better.
- Add `docs/developer/...` later as a sibling tree behind a `User guide | Developers` switcher — no restructuring required.
- `docs/developer-guide.md` stays as-is for now (the future Developers source); it is **not** surfaced in v1.

## 5. Architecture & build pipeline

Single deployment, same `apps/web` Nitro build. No second project.

### 5.1 Markdown → HTML (build time)

A Vite plugin / build-time transform globs `docs/user/**/*.md` and, for each file, produces `{ slug, frontmatter, html, headings[] }` via a `unified` pipeline:

`remark-parse` → `remark-gfm` (tables/lists) → `remark-rehype` → `rehype-slug` (stable heading ids) → `rehype-autolink-headings` (clickable `#` anchors) → `@shikijs/rehype` (build-time syntax highlighting; zero client JS — wired now for the future Developers section) → `rehype-stringify`.

- Frontmatter via `gray-matter`.
- **No MDX** — content stays pure CommonMark, editable by non-developers and translation tooling. (If a future page needs an embedded component, add `@mdx-js/rollup` scoped to that file only.)
- Compiled HTML is rendered into the branded reading column via `dangerouslySetInnerHTML`. Content is **first-party only**; keep rehype's default sanitization posture.
- Async highlighting happens in the build step, never in a synchronous render path.

### 5.2 Routing & navigation tree

- Routes live under `_public/docs/` so they inherit `mk-root` + `MarketingHeader`/`MarketingFooter` for free.
- `/docs` index route → renders `docs/user/index.md` as a landing hub (see §6, §7).
- A splat route `_public/docs/$.tsx` resolves `/docs/<scope>/<page>` against the compiled manifest by slug; unknown slug → existing `_public` `notFoundComponent`.
- The **sidebar nav tree is derived from the folder structure** (directory = group, file = page; order/title from frontmatter). Adding a `.md` file makes it appear automatically — no registration.
- A top-level `User guide | Developers` switcher is rendered (Developers disabled/empty in v1) to lock in the structure.

### 5.3 Static generation

TanStack Start's built-in prerender (`tanstackStart({ prerender: { enabled: true, crawlLinks: true } })`), seeded from `/docs` so it crawls the sidebar/TOC links and emits static HTML per page. Scope with `filter` to `/docs/*` so the authed app isn't prerendered.

**Build sequence:** (1) compile Markdown → manifest module, (2) `vite build` prerenders `/docs/*` to static HTML, (3) post-build `pagefind` step indexes the prerendered HTML into public assets.

**Nx caching (load-bearing detail):** declare `docs/user/**` as an input to the `web` build target in `nx.json` so doc edits bust the cache (the existing `ANALYZE` note in `vite.config.ts` shows Nx caching is sensitive to non-keyed inputs). Otherwise stale docs ship. Add generated/Pagefind output dirs to build `outputs`.

**Prerender risk to verify early:** `__root.tsx`'s `beforeLoad` calls `fetchClerkAuth` (a `createServerFn`). It returns `{ userId: null, ... }` when unauthenticated, so prerender should tolerate the no-session path — confirm during implementation.

### 5.4 Search

**Pagefind.** Runs post-build over the prerendered `/docs` HTML, producing a fragmented, lazy-loaded WASM index served as static assets — no backend, scales as docs grow.

- Loaded dynamically on first search-open (`await import('/pagefind/pagefind.js')`), so it's not in the initial route bundle.
- Surfaced through a **`cmdk` dialog** (reuse `components/ui/command.tsx`) so it feels identical to the in-app `⌘K`. This is a **separate, auth-free instance** scoped to `/docs` — do not overload the dashboard's auth-gated palette.
- Index by page title, headings (sub-results/anchors), and body; results show page title + breadcrumb path + snippet.
- Bind to `⌘K`/`Ctrl+K` on `/docs/*`, plus `/` to focus, plus a sidebar search pill.
- **Fallback:** if prerender enumeration proves awkward, a build-time MiniSearch JSON index built from the parsed Markdown (acceptable at current size). Lead with Pagefind.

### 5.5 "Was this page helpful?" feedback (Convex)

- New Convex module `packages/backend/convex/docs/` with a public mutation `submitDocFeedback({ slug, helpful: boolean, comment?: string })`, modeled on the existing `contact` module's unauthenticated-submission pattern.
- New `docFeedback` table in `schema.ts`: `{ slug, helpful, comment?, createdAt, locale? }`, indexed by `slug`. No PII; `/docs` is public so submissions are anonymous (optionally attach `userId` when a session happens to exist, but never required).
- Light rate-limiting / validation consistent with `contactMutations`. Client uses the existing Convex react-query wiring.

## 6. Visual design

The docs experience extends `LegalDoc` into a full three-pane shell, styled entirely with existing `--mk-*` tokens (dark mode inherited). **No new palette.** A single new scoped stylesheet `apps/web/src/styles/docs.css` (`.docs-prose` layer) handles long-form typography and content elements.

### 6.1 Layout

Three zones inside the `_public` `<Outlet>`:

- **Left sidebar (≈280px):** sticky (`top` clears the 70px header), independent scroll, `border-r border-mk-border`. Contains: `User guide | Developers` switcher, search pill, collapsible section → page nav.
- **Center reading column:** `minmax(0,1fr)` track, inner content capped at `max-w-[720px]` (~70–75 char measure). Contains breadcrumb → H1 → prose → prev/next pager → helpful footer.
- **Right on-page TOC (≈220px):** sticky, scroll-spy (port the `LegalDoc` `IntersectionObserver` with `rootMargin: "-30% 0px -60% 0px"`); hidden below ~1280px.

Responsive:

- **Tablet (768–1099px):** drop right TOC; it becomes a collapsed `<details>` "On this page" at the top of the article. Grid → `[260px_1fr]`.
- **Mobile (<768px):** single column; sidebar becomes a slide-in `Sheet` triggered from a sticky secondary docs bar under the header (back-drop-blurred), with current page title + search icon.

### 6.2 Typography (`.docs-prose`)

Tuned for sustained reading: body **17px / 1.75 line-height**, `max-width: 72ch`, `text-wrap: pretty`, `font-mk-sans`, `--mk-text-body`.

- Headings: `font-mk-heading`, `--mk-text-strong`, `tracking-tight`; H2 gets a hairline top rule (`border-top: 1px solid var(--mk-border)`) for clear chaptering; `scroll-mt-[96px]` on every id'd heading (clears sticky header on anchor jump).
- Ordered lists rendered as **violet numbered chips** (`counter` + `--mk-violet-50` / `--mk-violet-600`) — the guide is step-heavy; this echoes the brand.
- Unordered list markers tinted `--mk-violet-400`.
- Links: `--mk-violet-600`, subtle underline, hover/focus states; external links get a trailing `↗`.
- Inline code: `--mk-muted` bg + `--mk-border`, `--mk-violet-700` (light) / `--mk-violet-300` (dark).

### 6.3 Content components

- **Callouts/admonitions:** single `Callout` component, 4 tones mapped to status tokens — info (`--mk-violet-*`), tip (`--mk-success-*`), warning (`--mk-warning-*`), danger (`--mk-danger-*`); left accent bar + soft fill + lucide icon. The guide's `> **Note:**` blockquotes map to **info**.
- **Code blocks:** `--mk-card-base` bg, rounded, `shadow-mk-xs`, copy button (always visible for mobile), optional lang chip; Shiki token theme keyed to `--mk-*` with `.dark` variants.
- **Tables:** bordered, rounded, `--mk-muted` header, row hover; horizontally scrollable on mobile.
- **Figures/images:** rounded, `--mk-border` frame, `shadow-mk-sm`, centered `figcaption`; explicit dimensions + lazy-load to avoid CLS.
- **Heading anchor affordance:** hover-revealed `#` link that smooth-scrolls and copies the URL (toast via `sonner`).
- **Breadcrumb:** `Docs › Group › Page` at top of column (critical for deep-link arrivals).
- **Prev/next pager:** two cards filling the measure, violet hover lift.
- **Helpful footer:** thumbs up / "Not really" (+ reveal optional comment textarea on negative) wired to the Convex mutation; "Suggest an edit" link; confirmation toast; replaced by a thank-you line after voting.

### 6.4 Landing page (`/docs`)

Reuse marketing `PageHero` + `Eyebrow` ("Documentation" / "JigSwap User Guide" / lead), a prominent centered search pill beneath the lead, then a **category card grid** (one card per top-level group: violet icon tile + `font-mk-heading` title + summary + hover lift), mirroring the about-page grid vocabulary. Optional single `mk-hero-glow`.

### 6.5 Accessibility

WCAG AA contrast (verify violet-600/violet-50 inline-code and Shiki tokens against actual oklch values); visible `focus-visible:ring-mk-ring` on all interactive elements; real `<nav>` + `<a>` sidebar; `<button aria-expanded>` collapsibles; skip-to-content link; one H1 per page with strict heading nesting; `aria-current` on active nav/TOC/breadcrumb; ≥40px touch targets; `prefers-reduced-motion` honored on reveals, hover-lifts, and smooth-scroll.

## 7. Key user journeys

- **A — Cold landing on `/docs`:** overview hub answers "what is this / where do I go" in <5s (category cards + search + "start here").
- **B — Browse by topic:** persistent left sidebar, active page highlighted, active group expanded.
- **C — Search:** always-available; instant client-side results matching page + heading level.
- **D — Deep-link from app (highest value, future):** lands on `page#anchor` with breadcrumb orientation; works unauthenticated since `/docs` is public.
- **E — Mobile reading:** drawer nav + single column + collapsible TOC.
- **F — Cross-topic follow-through:** inline cross-links + "Related pages" footer driven by the guide's existing cross-references.

## 8. New / changed artifacts (orientation, not exhaustive)

**Content**

- `docs/user/**/*.md` — split from `docs/user-guide.md` (§4); original removed or replaced by a redirect/index.

**Web app**

- `apps/web/vite.config.ts` — Markdown compile plugin + `prerender` config.
- `apps/web/src/routes/_public/docs/index.tsx`, `_public/docs/$.tsx` — routes.
- `apps/web/src/styles/docs.css` — `.docs-prose` + content element styles (tokens only).
- `apps/web/src/components/docs/` — `docs-shell`, `docs-sidebar`, `on-page-toc`, `callout`, `code-block`, `doc-pager`, `breadcrumb`, `helpful`, `docs-search`.
- Build wiring: Pagefind post-build step in the `web` build target; `nx.json` inputs/outputs.

**Backend**

- `packages/backend/convex/docs/` — `submitDocFeedback` mutation (modeled on `contact`).
- `packages/backend/convex/schema.ts` — `docFeedback` table + `by_slug` index.

## 9. Risks & mitigations

- **Build wiring (highest risk):** Markdown plugin + prerender enumeration + Pagefind + Nx inputs must align. Mitigation: ship a splat route rendering build-compiled HTML first (no prerender), then layer prerender + Pagefind; MiniSearch fallback if enumeration is fiddly.
- **Prerender vs. auth root:** verify `fetchClerkAuth` tolerates the no-session prerender path; scope with `filter`.
- **Tailwind v4 typography:** `@tailwindcss/typography` is **not** installed. Option (a) add `@plugin "@tailwindcss/typography"` and override `--tw-prose-*` to `--mk-*`; option (b, recommended) hand-write `.docs-prose` against `--mk-*` (~60 lines, generalizing what `LegalDoc` already does). Decide in the plan.
- **Bundle size:** keep prose as static HTML (not MDX/JS); lazy-load Pagefind; verify with `ANALYZE=1` visualizer that prose didn't leak into JS. If the tree grows large, switch the HTML glob to `{ eager: false }` per-route chunks.
- **Anchor re-mapping:** mechanical but must be complete; treat dead in-doc links as a release gate.
- **Browser verification:** Playwright/Chrome unavailable in this env; dev server on `:3001` allows manual visual checks only.

## 10. Effort (rough)

~4–6 focused dev-days for v1: Markdown pipeline + manifest (~1d), shell/sidebar/TOC/breadcrumb/pager mostly lifted from `LegalDoc` (~1.5d), splat route + prerender (~1d), Pagefind + `cmdk` search (~1d), typography/dark/mobile/a11y pass (~0.5–1d), plus content split and Convex feedback (~0.5–1d). The Developers section later is mostly content + the already-wired code-highlighting path.

## 11. Success criteria

- All 6 groups / ~18 pages render on-brand in light and dark, desktop/tablet/mobile.
- 100% of the guide's prior internal anchors resolve to valid new targets (no dead links).
- Search returns relevant page + heading-level results with zero backend.
- `/docs/*` is statically prerendered (verify static HTML in the Nitro output) and publicly reachable without sign-in.
- "Was this page helpful?" persists to Convex.
- Automated WCAG AA (axe) passes; keyboard-only walkthrough of nav, search, and a deep-linked page has no traps.
- `format:check`, lint, type-check, and tests pass.
