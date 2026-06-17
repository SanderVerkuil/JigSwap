# JigSwap Landing-Page Redesign — Content & UX Strategy Briefs

**For:** UI designers + frontend developers building three landing-page variants.
**Author:** UX Researcher
**Date:** 2026-06-17

---

## 0. Shared context (read first)

These facts are grounded in the real product and codebase, not assumptions. Copy below is meant to be pasted near-verbatim; where it differs from current strings, it is an intentional rewrite.

**Product in one breath:** A personal puzzle library + community exchange for jigsaw enthusiasts. You shelve your puzzles, then lend / swap / share them, and always see who currently holds your lent-out boxes (custody tracking). Sustainability angle: give a finished puzzle a second, third, fourth life instead of leaving it in the attic. A warm Dutch family side-project, born 2025, now open to the wider community.

**Real assets that exist today (use these, don't invent):**

- **Live Convex metrics** — three real numbers, surfaced via `gateway.insights.globalStats`: puzzlers signed up (`totalUsers`), puzzles in catalog, puzzles on shelves. These are the single strongest credibility lever and they are REAL. Never fabricate counts (e.g. the old prototype's "4.200+" was removed for this reason).
- **Live community avatars** — `gateway.insights.communityAvatars` returns real member initials/photos; decorative fallbacks exist for empty/loading states.
- **Live plank puzzles** — `gateway.insights.plankPuzzles` feeds the 3D shelf with real catalog covers (falls back to themed Dutch placeholder boxes: "Boslicht", "Amsterdam", "De Nachtwacht", etc.).
- **Founders' quote** — honest family note, already written: *"We built JigSwap because our finished puzzles deserved better than the attic — and because puzzling is more fun when you share it."* — *The family behind JigSwap, puzzling at the kitchen table since 2025.*
- **One real cover photo** — `assets/cover-sand.webp` ("Zandsculpturen"). **There are NO real lifestyle photos** (no rainy-day, coffee, family-table photography). The Cozy variant MUST treat this as a constraint, not assume a photo library exists.

**Design tokens already in the system** (`marketing.css`, all `--mk-*`):

- Three brand seeds: violet `#6048e8` ("Jig" / signature), green `#19c316` ("Swap" / go), pink `#ec4899` (playful highlight). Full 50–900 ramps derived from these.
- Surfaces are faintly violet-tinted cool neutrals (`--mk-bg`, `--mk-card`, `--mk-muted`). Light + dark via `.dark` class.
- Type: **Baloo 2** rounded for headings (warm, friendly), system-sans for body.
- Motion easings: `--ease-mk-out` (quick), `--ease-mk-spring` (bouncy). Brand glow helper `.mk-hero-glow`. Brand CTA shadow `--shadow-mk-brand` (violet glow).

**Baseline section list we're moving away from (generic SaaS):** sticky header → 3D puzzle-plank hero w/ frosted callout + CTAs + trust row → stats strip → 3-step "how it works" teaser → three alternating feature rows (Library / Lend & Track / Discover) → sustainability band → founders' quote → final gradient CTA → footer. Primary CTA "Start trading", secondary "See the features".

**The non-negotiable:** the three variants must end up DRASTICALLY different — different emotional target, different section lists (not the same sections reskinned), different copy voice, different visual logic. A reviewer should never confuse a screenshot of one for another.

**Accessibility baseline (applies to all three — default requirement):**

- Brand violet `#6048e8` on white passes AA for large text but is borderline for body; never set body copy in raw violet on light surfaces — use `--mk-text-body` / `--mk-text-strong`.
- Every "one delightful moment" / animation must respect `prefers-reduced-motion` and degrade to a static, fully legible state.
- The 3D plank and all motif art are decorative (`aria-hidden`), so headline + CTA + stats must carry the full meaning for screen-reader and no-JS users.
- Live stats need an accessible loading state (don't announce empty/zero); avatars are decorative and already `aria-hidden`.
- Target AA contrast minimum on all text over imagery/gradients via scrims, exactly as the current hero does.

---

# VARIANT 1 — Playful-Premium

> Reference energy: Duolingo, Notion, Headspace. Friendly puzzle-piece personality on a clean, confident, whitespace-rich structure, with ONE delightful interactive moment in the hero.

## Emotional target & positioning
**Feel in 3 seconds:** "Oh, this is friendly *and* trustworthy — and that was fun." Warmth of community + safety of lending something you value + one memorable hook.
**One-line positioning:** *The friendly home for your puzzles — shelve them, share them, and always know where they are.*

## Messaging hierarchy
Value-prop order: **(1) delight/personality hook → (2) the core loop (shelve → share → track) → (3) trust (custody + live community) → (4) sustainability as the warm "why".**

Headline options (pick one, real copy):
1. **"Your puzzles, but make them social."** / Subhead: *Shelve every box, lend to fellow puzzlers, and always see who's got it. Free to start.*
2. **"Give every puzzle a second life — and a few new friends."** / Subhead: *Build your shelf, swap with the community, track every box you lend out.*
3. **"Puzzles are better passed around."** / Subhead: *A friendly library for your jigsaws: lend, swap, and never lose track of a box.*

(Recommended: #1 for the playful-but-clear hook; #3 if the team wants maximum warmth.)

## The ONE delightful interactive moment (hero)
A single **draggable puzzle piece** that snaps into a piece-shaped notch in the headline lockup (the missing piece in "puzzles"). On drop it snaps with `--ease-mk-spring`, emits a tiny confetti of 3–4 brand-colored mini-pieces, and the live stat counter ticks up once. One moment only — do not gamify the whole page.
- **Reduced-motion / no-JS fallback:** the piece is already snapped in place; no drag affordance shown.
- Reuse `PieceMotif` + spring easing already in the codebase. Keep the rest of the hero calm and whitespace-rich so this moment stands out.

## Section list & order
1. Sticky header (keep — minimal, add a subtle piece-dot logo flourish)
2. **Hero** — clean, generous whitespace, the draggable-piece moment, headline + subhead + CTAs + live trust row (KEEP 3D plank but dial it back to a softer, smaller supporting element so the hero feels calmer than baseline)
3. **Live stats strip** — KEEP, but restyle as three friendly "stat pills" with a gentle count-up on scroll
4. **"How it works" — 3 steps** KEEP (Fill your shelf → Discover & request → Lend & track), as playful illustrated cards
5. **Custody/peace-of-mind spotlight** ADD — a small, focused module: "Always know who has your box." This is the trust differentiator and deserves its own beat in this variant.
6. Sustainability band KEEP — warm, light
7. Founders' quote KEEP — the human anchor
8. Final CTA KEEP — friendly, confident
9. Footer

**CUT from baseline:** the three heavy alternating feature rows (Library / Lend & Track / Discover) — they read as generic SaaS and fight the whitespace goal. Fold their essence into the 3-step "how it works" + the custody spotlight instead.
**Why:** Duolingo/Notion energy = one clear loop, lots of air, one delight — not a feature wall.

## CTAs
- Primary: **"Start your shelf"** (warmer + more concrete than "Start trading"; implies zero-friction ownership)
- Secondary: **"See how it works"**

## Trust & credibility signals
Lead on **live community avatars + the live count** ("{count} puzzlers are already swapping") right under the CTAs — real people, real numbers, friendly framing. Reinforce with the **custody spotlight** (you'll always know who has your box = safe to lend). Founders' story as the warm closer. Keep sustainability as the feel-good "why", not the lead.

## Microcopy voice notes
- Drag hint caption: *"Pop the last piece in →"*
- Stat pill label: *"puzzles on shelves right now"*
- Empty-shelf-style delight (for a future product hook, sets tone): *"Your shelf's a little quiet. Add your first box and let the swapping begin."*
- Button on hover / success microcopy: *"Nice — that's the spirit 🧩"*

## Differentiation risk to avoid
**Don't let "playful" tip into childish or gimmicky.** The audience lends valuables; the page must still feel premium and safe. One delight moment, restrained color, lots of whitespace. If the confetti or the piece-snapping shows up more than once on the page, you've broken the brief.

---

# VARIANT 2 — Bold / Editorial

> A design-magazine cover for a puzzle community. Big expressive typography, asymmetric magazine layouts, high visual personality.

## Emotional target & positioning
**Feel in 3 seconds:** "Whoa — this puzzle thing has *taste* and a point of view." Confident, characterful, culturally aware. Puzzling as a craft and a community worth belonging to.
**One-line positioning:** *Puzzling, redrawn — a bold home for the people who love finishing them and passing them on.*

## Messaging hierarchy
Value-prop order: **(1) a strong editorial statement / manifesto line → (2) the live numbers as the "issue stats" → (3) the loop told as a narrative → (4) sustainability as the conviction → (5) community as the masthead.**

Headline options (real copy, set HUGE):
1. **"LEND. SWAP. SHARE."** as three stacked oversized words, each a different brand seed color, with subhead: *A library for jigsaw people. Build your shelf, pass your puzzles on, never lose a box.*
2. **"The attic was a terrible place to keep a masterpiece."** / Subhead: *JigSwap is where finished puzzles get a second life — and a community to share them with.*
3. **"1,000 pieces. One shelf. A whole community."** / Subhead: *Catalogue your jigsaws, lend them out, swap for new ones, and track every box.*

(Recommended: #1 for pure editorial impact — it weaponizes the existing "Lend • Swap • Share" tagline as typographic art; #2 if the team wants a sharper, opinionated voice.)

## Section list & order (asymmetric, magazine grid)
1. **Editorial masthead header** — wordmark left, a thin "Issue No. / est. 2025 / Netherlands" rule, nav right. Sets the magazine frame immediately.
2. **Hero / cover** — oversized stacked type, asymmetric: type hard-left, the 3D plank bleeding off the right edge as the "cover image". KEEP the 3D plank but crop/bleed it editorially rather than centering it.
3. **Big-number band** ADD/REFRAME — the three live stats rendered as enormous editorial figures ("4 ⁄ 312 ⁄ 89" treatment), each with a one-word caption. This replaces the polite baseline stats strip.
4. **Manifesto block** ADD — a single large pull-quote stating the conviction: puzzles deserve a second life, sharing beats hoarding. Sets JigSwap apart from a generic tool.
5. **The loop, as numbered editorial spreads** — Fill your shelf / Discover & request / Lend & track, but as three asymmetric full-bleed-ish "articles" with big numerals 01 / 02 / 03, alternating left/right.
6. **Custody feature, editorial** — "Who has your box?" as a confident standalone spread with a typographic diagram (box → person → back to you).
7. Founders' quote KEEP — reframed as an editorial "letter from the founders".
8. **Closing cover / CTA** — big-type sign-off.
9. Editorial footer (colophon style).

**CUT from baseline:** the soft frosted-glass hero callout (too gentle for editorial — let raw type carry it) and the three polite alternating feature rows (replaced by the numbered editorial spreads). The sustainability band becomes the manifesto block rather than a quiet side section.
**ADD:** big-number band, manifesto pull-quote, colophon footer.
**Why each variant differs:** this one is structurally type-led and asymmetric where Playful-Premium is centered and calm.

## CTAs
- Primary: **"Get on the shelf"** (confident, a little cheeky, on-brand for editorial voice)
- Secondary: **"Read how it works"** (the "read" verb reinforces the magazine frame)

## Trust & credibility signals
Lead on the **live numbers rendered as bold editorial figures** — credibility through scale and confidence, not badges. The **founders' "letter"** carries authenticity (real family, est. 2025, Netherlands — lean into the place and the date as editorial detail). Community avatars become a small "contributors" row in the colophon. Sustainability = stated conviction, not a soft band.

## Microcopy voice notes
- Eyebrow / kicker: *"Est. 2025 · Made at a Dutch kitchen table"*
- Big-number caption: *"puzzles in circulation"*
- Section kicker: *"No. 03 — Lend & Track"*
- Sign-off line above CTA: *"Stop hoarding masterpieces. Start a shelf."*

## Differentiation risk to avoid
**Don't let editorial become unreadable or cold.** Huge type + asymmetry can wreck mobile legibility and hierarchy. Enforce a real reading order on small screens (stack, don't shrink), keep body copy on `--mk-text-body` at readable sizes, and keep the *warmth* — the family/kitchen-table soul must survive the bold treatment, or it reads as a cold agency template, not a puzzle community.

---

# VARIANT 3 — Cozy / Hygge (lifestyle)

> Photography-led, warm tones, the FEELING of puzzling: rainy day, coffee, family table. Emotionally resonant, easy to trust.

## Emotional target & positioning
**Feel in 3 seconds:** "This feels like home — a calm, warm corner where puzzling and people live." Belonging, comfort, gentle trust.
**One-line positioning:** *A warm little corner for your puzzles and the people you share them with.*

## CRITICAL constraint — no real lifestyle photos exist
There is exactly one cover photo (`cover-sand.webp`) and NO rainy-day/coffee/family-table photography. The variant must look intentional **without** real photos:

- **Mark every photographic slot explicitly** as `[PHOTO PLACEHOLDER: warm rainy-window puzzling scene]` so devs and a future photographer know exactly what goes where.
- **CSS-driven warm fallbacks** so it ships looking deliberate today:
  - Warm gradient grounds — shift the cool violet `--mk-bg` toward amber/terracotta for this variant only (e.g. `color-mix` of `--mk-warning` / a warm sand tone into the ground), so surfaces read like lamplight, not screen-blue.
  - **Grain / paper texture overlay** (subtle CSS noise or an SVG `feTurbulence` layer at low opacity) to kill the flat-digital feel.
  - **Soft duotone treatment spec** for whenever a real photo lands: warm-shadow / cream-highlight duotone so future photography auto-matches the mood.
  - Generous rounded corners (`rounded-3xl`+), soft long shadows, layered translucency = the "blanket" feeling.
  - The existing `cover-sand.webp` can anchor one hero corner as the single real photographic touch.

## Messaging hierarchy
Value-prop order: **(1) the feeling / belonging → (2) the gentle promise (shelve + share + always know where it is) → (3) trust through warmth + real community → (4) sustainability as the cozy, values-led close.**

Headline options (real copy, warm + soft):
1. **"Slow afternoons, shared puzzles."** / Subhead: *Keep your jigsaws in one cozy place, lend them to fellow puzzlers, and always know where each box is.*
2. **"Every puzzle deserves another rainy afternoon."** / Subhead: *Shelve your boxes, share them with the community, and give finished puzzles a second life.*
3. **"Pull up a chair. Bring your puzzles."** / Subhead: *A warm home for your jigsaw collection — lend, swap, and share with people who love them as much as you do.*

(Recommended: #2 — it fuses the cozy feeling with the real sustainability angle in one line; #1 for the softest, most lifestyle read.)

## Section list & order
1. Header — soft, warm, low-contrast, no sticky urgency
2. **Hero** — `[PHOTO PLACEHOLDER: hands placing a puzzle piece, warm window light, coffee mug]` with the warm gradient + grain fallback; soft headline lockup overlaid bottom-left. CUT the 3D plank here — it's cool and techy and fights the hygge feeling; replace with photo/treatment. (This is a deliberate, visible divergence from the other two variants, which both keep the plank.)
3. **A warm "moment" strip** ADD — a single soft line + small live count: *"{count} puzzlers gathered round the table."* Stats stay, but de-emphasized and humanized (no big SaaS numbers).
4. **"How sharing feels" — the loop as gentle vignettes** — Fill your shelf / Share & borrow / Always know where it is, each a small `[PHOTO PLACEHOLDER]` + warm caption, soft and unhurried.
5. **Sustainability — promoted to a hero-weight emotional section** ADD emphasis — "second life" is the heart of cozy/values storytelling here, not a side band. `[PHOTO PLACEHOLDER: a puzzle being handed from one person to another]`.
6. Founders' quote KEEP — perfect fit; render as a handwritten-feeling note on a card with grain.
7. **Gentle final CTA** — warm, no pressure.
8. Soft footer.

**CUT from baseline:** the 3D plank hero (replaced by photo/treatment), the polite stats strip as a numbers-forward block (humanized into the "moment" strip), and the three alternating feature rows (replaced by warm vignettes).
**ADD:** photo-placeholder system + CSS warm/grain treatment, promoted sustainability section, humanized count line.
**Why:** this is the only photography-led, plank-free, warm-toned variant — structurally and tonally it cannot be confused with the other two.

## CTAs
- Primary: **"Find your puzzle people"** (belonging-led; warmer than transactional "trade")
- Secondary: **"Take a look around"** (gentle, low-commitment)

(Alt primary if a more direct ask is wanted: **"Start your cozy shelf"**.)

## Trust & credibility signals
Lead on **warmth + the real founders' story** (a real family, kitchen table, 2025 — this IS the trust in a cozy frame). Soften the live stats into a human sentence rather than big figures. Real community avatars shown small and warm ("the people round the table"). Custody/"always know where your box is" framed as *reassurance and care*, not security/tracking — comfort, not surveillance. Sustainability framed as shared values you belong to.

## Microcopy voice notes
- Hero caption / kicker: *"Rainy-day approved · since 2025"*
- Count line: *"{count} puzzlers gathered round the table"*
- Custody reassurance: *"Lent it out? You'll always know whose table it's on."*
- Cozy empty-state-style delight (tone-setter): *"Kettle's on. Add your first puzzle whenever you're ready."*

## Differentiation risk to avoid
**Don't let cozy feel stocky, fake, or saccharine** — and specifically don't let the missing photos make it look unfinished. Because there are no real lifestyle photos, sloppy stock-style placeholders or flat gray boxes will instantly read as "broken/unstyled". The grain + warm-gradient + duotone fallback system is what keeps it intentional. Also avoid over-sweet copy that undercuts the lending-valuables trust — keep one or two concrete, grounded lines (piece counts, "always know where your box is") so it stays believable, not greeting-card.

---

## Cross-variant differentiation summary (at a glance)

| | Playful-Premium | Bold/Editorial | Cozy/Hygge |
|---|---|---|---|
| Feeling | friendly + premium + a hook | confident, characterful, taste | belonging, warmth, calm |
| Layout logic | centered, whitespace-rich | asymmetric magazine grid | photo-led, layered, soft |
| 3D plank | kept, dialed back | kept, cropped/bleeding | CUT (photo/treatment instead) |
| Type | rounded Baloo, calm | oversized, expressive | soft, warm, handwritten accents |
| Color | brand violet/green/pink, airy | high-contrast brand seeds as art | warm amber/terracotta shift + grain |
| Hero hook | ONE draggable piece moment | huge stacked "LEND. SWAP. SHARE." | warm photo placeholder + light |
| Stats | friendly count-up pills | enormous editorial figures | humanized one-line sentence |
| Primary CTA | "Start your shelf" | "Get on the shelf" | "Find your puzzle people" |
| Trust lead | avatars + live count + custody | big numbers + founders' letter | founders' story + warmth |
| Top risk | childish/gimmicky | unreadable/cold | stocky/fake/unfinished |
