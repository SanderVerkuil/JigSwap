# Network member card redesign — design spec

**Date:** 2026-10-17
**Status:** Design only. No code has changed yet.
**Scope:** `MemberTile` (the member card on `/people`) plus an opt-in compact mode for `FollowButton` and `MessageButton`.
**Depends on (soft):** the separate display-name ticket, which adds a shared helper (full name → visible email → username → localized "Puzzler"/"Puzzelaar") and an initials fallback. This card only uses the already-resolved `displayName` and `initials`. It does not compute them. See §4.4.
**Amended (implementation):** the display-name ticket (PR #74) has landed underneath this work, so §4.4 now names its concrete helpers instead of the interim `member.name` + TODO.

---

## 1. Problem

On `/people` (tabs "Jouw netwerk / Mensen vinden / Activiteit") the member cards are cramped:

- The name truncates to "Hans-Pa…" or even "e.".
- Two stacked labelled buttons (Ontvolgen / Bericht) and the "Volgt jou" badge take most of the row width.
- When a member has no reviews, the rating reads as "★–", which looks like a clipped or broken value.

## 2. Current state

### 2.1 Where the card lives and who uses it

| File                                                | Lines           | Role                                                                                                                                       |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/social/member-tile.tsx`    | 23–33           | `MemberTileSkeleton`                                                                                                                       |
| same                                                | 35–125          | `MemberTile({ memberId, followsYou, hideLocation })`. It fetches `gateway.identity.byId` and `gateway.identity.userStats` itself.          |
| `apps/web/src/routes/_dashboard/people.tsx`         | 114–147         | `NetworkTab`: grid of `MemberTile`. `followsYou` is computed at 180–192. Location is shown.                                                |
| `apps/web/src/components/social/find-people.tsx`    | 82–108, 113–135 | Find tab: search results and the "Recently joined" seed. Both pass `followsYou={false}` and `hideLocation`.                                |
| `apps/web/src/components/social/activity-feed.tsx`  | —               | Activity tab. It does **not** use `MemberTile` and is out of scope.                                                                        |
| `apps/web/src/components/social/follow-button.tsx`  | 26–148          | Follow, Unfollow, Request and Requested (dropdown) states. Also used **at default size** by `components/members/profile-body.tsx:237,607`. |
| `apps/web/src/components/social/message-button.tsx` | 24–91           | Connection-gated DM button. When disabled it wraps in a `span tabIndex=0` with a tooltip. Also used by `profile-body.tsx:238`.             |

All grids use `grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]` (`people.tsx:127,135`, `find-people.tsx:83,96,114,126`). So the **narrowest card is 280px**. At a 360px viewport the dashboard gutter is `px-4` (`dashboard-layout/shell.tsx:95`), so the card is 328px.

### 2.2 Why it's cramped (`member-tile.tsx:61–123`)

- The layout is one flex row: `[avatar 48] gap 14 [content flex-1] gap 14 [actions column]`, inside `p-3.5`.
- The actions column (`:119–122`) is `shrink-0 flex-col items-stretch`. It holds two `size="sm"` labelled buttons with icon + `mr-2`. "Ontvolgen" renders at about 110px, so the content column gets about 300 − 48 − 14 − 14 − 110 ≈ **114px** at 360px and about **66px** at 280px.
- In that content column the name `Link` is `truncate` (`:73`) and shares a flex row with a `shrink-0` "Volgt jou" badge (`:77–81`, about 70px plus an 8px gap). That leaves the name **about 36px at 360px**, which is how "e." appears.
- The rating (`:106–113`) always renders a filled amber star, then `"–"` when `totalReviews === 0`. The result is "★–". It also uses `toFixed(1)`, so Dutch users see "4.8" instead of "4,8".
- The whole card is not clickable. Only the name text links to `/members/$handle` (`:70–76`).
- The avatar image `alt={member.name}` (`:64`) repeats the adjacent name to screen readers.
- The initials are `member.name.charAt(0)` (`:65`). That breaks for empty or email-ish names, which is what the display-name ticket fixes.

### 2.3 Design-system pieces available (existing only, nothing new)

- **Tokens** (`apps/web/src/styles/globals.css`, light `:root` and `.dark`, mapped to `--color-*` at about line 129): `bg-card`, `text-card-foreground`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `border`, `ring-ring`, `bg-secondary` / `text-secondary-foreground`. Dark mode uses the `.dark` class (`@custom-variant dark`). Every token flips automatically.
- **Rating star colour:** `fill-amber-400 text-amber-400` is the established pattern (`member-tile.tsx:107`, `puzzles/definition-card.tsx:25`). Keep it.
- **`Button`** (`ui/button.tsx`): `variant` default, outline or ghost. `size="icon"` = `size-9` (36px). The focus style is `focus-visible:ring-ring/50 focus-visible:ring-[3px]`.
- **`Badge`** (`ui/badge.tsx`): `variant="secondary"`, `shrink-0 whitespace-nowrap`.
- **`Tooltip` / `TooltipTrigger` / `TooltipContent`** (`ui/tooltip.tsx`): each `Tooltip` brings its own provider with `delayDuration=0`.
- **`DropdownMenu*`** (`ui/dropdown-menu.tsx`): already used by FollowButton's Requested state.
- **`Avatar` / `AvatarImage` / `AvatarFallback`** (`ui/avatar.tsx`), **`Card`** (`ui/card.tsx`, `rounded-xl border shadow-sm`; it is a `div`), **`Skeleton`**.
- **Icons:** `lucide-react` ^1.23. `UserPlus`, `UserMinus`, `Clock`, `MessageCircle`, `Star`, `MapPin` and `Loader2` all exist. Loader2 is used in `ui/loading.tsx`. **Use `Ellipsis`, not `MoreHorizontal`**; `MoreHorizontal` is not exported in 1.x.
- **Stretched-link precedent:** `components/puzzles/puzzle-card-shell.tsx:136–144` puts the link on the title with `after:absolute after:inset-0 after:z-[1] after:content-['']`. Its actions sit in a `relative z-10` wrapper (`:191–197`) on a `relative` Card (`:226`). This spec reuses that pattern exactly.
- **Tailwind 4.3.2**, so `has-[…]:`, `pointer-coarse:` and `line-clamp-*` are all available.
- **i18n:** `use-intl`. Catalogs are `apps/web/locales/source.json` (English source used in dev, `lib/i18n.ts:68–83`), `en.json` and `nl.json`. **All three** must get new keys. `useFormatter()` is used in `social/activity-feed.tsx:18`.

## 3. Design decisions

### 3.1 Layout: two-row card

**Row 1** is the identity: avatar and name. The name gets the whole width right of the avatar.
**Row 2** is stats on the left and icon actions on the right, separated by a hairline.

Moving the actions off the identity row is what fixes truncation. At the narrowest card (280px) the name column is 280 − 28 (padding) − 48 (avatar) − 12 (gap) = **192px**. At 360px it is **240px**. The current figures are about 36px and about 66px.

### 3.2 Actions: icon buttons with tooltips (not primary + overflow)

**Decision:** icon-only buttons (`size="icon"`) with a visible tooltip label and a name-qualified `aria-label`.

Why not "primary action + overflow menu":

1. **The Message button is often disabled** for unconnected members, and its explanation lives in a tooltip (`message-button.tsx:77–88`). A disabled item inside a dropdown can't show that explanation well, and hiding Message behind "…" also hides why it isn't available.
2. **The card only ever has two actions.** An overflow menu for one hidden item costs an extra click and adds menu-state code for no space gain. One icon button and one "…" trigger take the same width as two icon buttons.
3. **It keeps the shared components intact.** It is an opt-in `iconOnly` prop on `FollowButton` and `MessageButton`. The labelled variants on `profile-body.tsx` stay byte-for-byte the same. The Requested state already is a dropdown, and it keeps working as one.

Discoverability safeguards:

- The follow button keeps **variant semantics**. Follow is `default` (filled primary), so it is visually the CTA on the Find tab. Unfollow, Requested and Message are `outline`.
- Each icon has a tooltip on hover and keyboard focus.
- `aria-label` includes the member's name, so a list of 12 cards doesn't announce 12 identical "Unfollow" buttons.

**Touch target:** `size-9` (36px) by default and `pointer-coarse:size-11` (44px) on touch devices. With `gap-1.5` between buttons this meets WCAG 2.2 AA 2.5.8 everywhere and the 44px guideline on touch.

### 3.3 "Follows you" badge

It moves **off the name line** to a meta line under the name, as the first item before the location: `[Volgt jou] · 📍 Utrecht`. The meta line is `flex flex-wrap`, so the badge never squeezes the name. It stays `Badge variant="secondary"`, which keeps its existing token colours in both themes.

### 3.4 Name truncation and wrapping rules

- The name wraps to **at most 2 lines**: `line-clamp-2`. It is never truncated to a single line.
- `[overflow-wrap:anywhere]` lets long unbroken strings break inside the box instead of overflowing. This matters because email and username are display-name fallbacks.
- A `title={displayName}` on the link shows the full name on hover when clamped. The link's accessible name is always the full name, so screen readers never get the clamp.
- Location (Network tab only): one line, `truncate`.

At 192px with `text-base font-semibold` that is about 2 × 21 characters, which is enough for "Hans-Peter van den Berg".

### 3.5 Stats and the empty rating

Stats row: `owned · swaps · rating`, `text-xs text-muted-foreground`, numbers in `font-semibold text-foreground tabular-nums`, `flex flex-wrap gap-x-3 gap-y-1`.

| Case                              | Visible                                                                                                                                                                       | Screen reader                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `stats === undefined` (loading)   | `Skeleton h-3 w-28`                                                                                                                                                           | —                                    |
| `stats === null` (private member) | stats row omitted; actions stay right-aligned (`ml-auto`)                                                                                                                     | —                                    |
| `totalReviews === 0`              | **no star**, muted text "No reviews yet" / "Nog geen reviews" (reuses `reputation.noReviewsYet`)                                                                              | same text                            |
| `totalReviews > 0`                | filled amber `Star` (`aria-hidden`) and the rating formatted with `useFormatter().number(r, { minimumFractionDigits: 1, maximumFractionDigits: 1 })`, which gives "4,8" in nl | `sr-only` `people.ratingSr` (see §6) |

"★–" is therefore impossible. A star only appears next to a real number.

## 4. Component and DOM structure

### 4.1 Exact DOM (rendered)

```html
<div data-slot="card" class="Card … group relative …">
  <!-- Card (div), position context -->
  <!-- ROW 1: identity -->
  <div class="flex items-start gap-3">
    <span data-slot="avatar" aria-hidden="true">…initials / img alt=""…</span>
    <div class="min-w-0 flex-1">
      <h3 class="…">
        <a
          href="/members/hans"
          data-card-link
          title="Hans-Peter van den Berg"
          aria-describedby=":r1:-meta :r1:-stats"
          class="after:absolute after:inset-0 after:z-[1] …"
          >Hans-Peter van den Berg</a
        >
      </h3>
      <div id=":r1:-meta" class="…">
        <!-- only if badge or location -->
        <span data-slot="badge">Volgt jou</span>
        <span><svg aria-hidden />Utrecht</span>
      </div>
    </div>
  </div>
  <!-- ROW 2: stats + actions -->
  <div class="flex items-center gap-3 border-t pt-3">
    <p id=":r1:-stats" class="…">…owned · swaps · rating…</p>
    <!-- non-interactive, under the overlay -->
    <div class="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
      <!-- ABOVE the overlay -->
      <button aria-label="Hans-Peter van den Berg ontvolgen">…</button>
      <!-- FollowButton iconOnly -->
      <button aria-label="Bericht sturen aan Hans-Peter van den Berg">…</button>
      <!-- MessageButton iconOnly -->
    </div>
  </div>
</div>
```

Invariants (the implementer must keep all of them):

- **There is exactly one `<a>` per card**, the name link. Its `::after` covers the card, so clicking the avatar, stats, badge or empty space navigates.
- **No interactive element is nested inside another.** The `<a>` contains only text. The buttons are **siblings** of the link's ancestors, not descendants. Never `<a>` inside `<button>` or the reverse, and never `<Link>` wrapping the Card.
- The actions wrapper is `relative z-10`. The overlay is `z-[1]`, so buttons, dropdown and tooltip triggers are above it and get their own clicks.
- **The Card itself has no `onClick`.** Navigation comes only from the real link, so middle-click, ⌘-click, "copy link" and prefetch all work.
- Link target: `to="/members/$handle" params={{ handle: member.username ?? member._id }}`. This is unchanged from `member-tile.tsx:71–72`.

### 4.2 React shape (small diff, same public API)

Keep `MemberTile({ memberId, followsYou, hideLocation })` exactly as it is, so `people.tsx` and `find-people.tsx` need **no changes**.

Inside `member-tile.tsx`:

```tsx
// Pure, unit-testable view-model for the stats row (new file: member-stats.ts)
export type RatingView =
  { kind: "none" } | { kind: "rated"; value: number; count: number };
export function ratingView(stats: {
  averageRating: number;
  totalReviews: number;
}): RatingView;
```

`MemberTile` renders the DOM in §4.1 directly. Do not add a separate presentational component, because only one caller exists. It also passes `iconOnly` and `memberName={displayName}` to both buttons.

### 4.3 `FollowButton` / `MessageButton`: opt-in `iconOnly`

Add `iconOnly?: boolean` (default `false`) to both. `MessageButton` also gets `memberName?: string`. When `iconOnly` is `false`, render exactly what renders today.

When `iconOnly` is true:

| Component and state                  | Variant                                                  | Icon                                              | Tooltip text (visible)                           | `aria-label`                                                                         |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Follow: loading relation             | outline, disabled                                        | `UserPlus`                                        | —                                                | `follow.followName`                                                                  |
| Follow: not following                | **default**                                              | `UserPlus`                                        | `follow.follow`                                  | `follow.followName`                                                                  |
| Follow: private target               | **default**                                              | `UserPlus`                                        | `follow.requestToFollow`                         | `follow.requestToFollowName`                                                         |
| Follow: following                    | outline                                                  | `UserMinus`                                       | `follow.unfollow`                                | `follow.unfollowName`                                                                |
| Follow: requested (dropdown trigger) | outline                                                  | `Clock` (drop the `ChevronDown`)                  | existing label (`requested` / `requestedStale…`) | `follow.requestedName`, or the existing `requestedStale` (already includes the name) |
| Follow: mutation pending             | same as the state above, `disabled`, `aria-busy="true"`  | `Loader2 animate-spin motion-reduce:animate-none` | —                                                | unchanged                                                                            |
| Message: loading gate                | outline, disabled                                        | `MessageCircle`                                   | —                                                | `messages.messageName`                                                               |
| Message: can message                 | outline                                                  | `MessageCircle`                                   | `messages.messageButton`                         | `messages.messageName`                                                               |
| Message: not connected               | outline, disabled, inside the existing `span tabIndex=0` | `MessageCircle`                                   | existing `messages.notConnected`                 | `messages.messageName` on the button                                                 |

Button classes in icon mode:
`<Button variant=… size="icon" className="pointer-coarse:size-11" …>`. The icon gets no `mr-2`; Button's `[&_svg]:size-4` applies.

Tooltip wiring:
`<Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>`.

- **Requested state:** nest the triggers as `TooltipTrigger asChild` → `DropdownMenuTrigger asChild` → `Button`. Radix composes both `asChild` slots on one element.
- **Not-connected state:** it already has its tooltip. Don't double-wrap it.
- **Fallback label:** if `memberName` is absent, `aria-label` falls back to the short label (`follow.unfollow`, etc.).

### 4.4 Display name and initials (consumed, not computed)

The display-name ticket (PR #74) provides the helpers; this card only consumes them:

- `const displayName = useMemberDisplayName()(member)` (`apps/web/src/lib/member-display-name.ts`, built on `resolveMemberDisplayName` from `@jigswap/contracts`): full name → visible email → username → localized "Puzzler"/"Puzzelaar".
- Initials: `<MemberInitial source={member} />` (`apps/web/src/components/members/member-initial.tsx`, built on `memberInitials`) inside `AvatarFallback`. It renders a generic person icon when no name resolves.
- Use `displayName` for:
  - the link text
  - `title`
  - `memberName` on both buttons
- Do not use the old `AvatarImage alt`; it becomes `""` (decorative).

## 5. Exact Tailwind classes

| Element                               | Classes                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Card (override defaults `gap-6 py-6`) | `group relative gap-3 p-3.5 transition-colors has-[[data-card-link]:hover]:bg-accent/40`                                                                                                                                                   |
| Row 1                                 | `flex items-start gap-3`                                                                                                                                                                                                                   |
| Avatar                                | `size-12 shrink-0`, plus `aria-hidden` on the Root                                                                                                                                                                                         |
| AvatarFallback                        | `text-sm font-semibold` (it already provides `bg-muted`)                                                                                                                                                                                   |
| Name column                           | `min-w-0 flex-1`                                                                                                                                                                                                                           |
| `h3`                                  | `text-base leading-snug font-semibold`                                                                                                                                                                                                     |
| Link                                  | `line-clamp-2 [overflow-wrap:anywhere] rounded-sm hover:underline focus-visible:outline-none after:absolute after:inset-0 after:z-[1] after:rounded-xl after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50` |
| Meta line                             | `text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs`                                                                                                                                                           |
| Badge                                 | `Badge variant="secondary"` (no extra classes)                                                                                                                                                                                             |
| Location                              | `flex min-w-0 items-center gap-1` > `MapPin className="size-3 shrink-0" aria-hidden` + `span.truncate`                                                                                                                                     |
| Row 2                                 | `flex items-center gap-3 border-t pt-3`                                                                                                                                                                                                    |
| Stats `p`                             | `text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs`                                                                                                                                                        |
| Stat number                           | `text-foreground font-semibold tabular-nums`                                                                                                                                                                                               |
| Rated                                 | `inline-flex items-center gap-1` > `Star className="size-3 fill-amber-400 text-amber-400" aria-hidden` + number + `span.sr-only`                                                                                                           |
| No rating                             | plain `span` (inherits muted)                                                                                                                                                                                                              |
| Actions                               | `relative z-10 ml-auto flex shrink-0 items-center gap-1.5`                                                                                                                                                                                 |
| Skeleton (keep the API)               | Same two rows: row 1 `Skeleton size-12 rounded-full`, plus `h-4 w-2/3` and `h-3 w-1/3`. Row 2 is `border-t pt-3 flex justify-between`, with `h-3 w-28` and `size-9 rounded-md ×2`, so loading doesn't shift layout.                        |

Notes:

- Dark mode needs nothing extra. Every class is a token (`bg-accent`, `ring-ring`, `border`, `muted-foreground`, `secondary`) or the existing amber star.
- `has-[…:hover]` highlights the card only when the pointer is over the link overlay, not over the action buttons. Hovering a button gets the button's own hover.

## 6. New i18n keys

Add each key to **`source.json`, `en.json` (identical English) and `nl.json`**.

| Key                          | en                                                                                        | nl                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `follow.followName`          | `Follow {name}`                                                                           | `{name} volgen`                                                                               |
| `follow.requestToFollowName` | `Request to follow {name}`                                                                | `Volgverzoek sturen naar {name}`                                                              |
| `follow.unfollowName`        | `Unfollow {name}`                                                                         | `{name} ontvolgen`                                                                            |
| `follow.requestedName`       | `Follow request to {name} pending`                                                        | `Volgverzoek aan {name} in afwachting`                                                        |
| `messages.messageName`       | `Message {name}`                                                                          | `Bericht sturen aan {name}`                                                                   |
| `people.ratingSr`            | `Average rating {rating} out of 5 from {count, plural, one {# review} other {# reviews}}` | `Gemiddelde beoordeling {rating} van 5 uit {count, plural, one {# review} other {# reviews}}` |

Reused without changes: `people.followsYou`, `people.ownedLabel`, `people.swapsLabel`, `reputation.noReviewsYet`, and all existing `follow.*` and `messages.*` labels. Pass `rating` to `ratingSr` already formatted (string), so the decimal comma is right.

## 7. States

- **Hover (card):** `bg-accent/40` while the pointer is over the link overlay, and the name underlines. Buttons use their own `hover:bg-accent`.
- **Focus:**
  - Tab to the link and a 3px `ring-ring/50` ring draws around the **whole card**, through `::after`, matching Button focus.
  - Tab to the buttons and they get the standard Button focus ring.
  - Tooltips open on focus.
- **Follow pending:** the button is disabled with `aria-busy` and the spinner icon (respecting reduced motion). The existing toasts still announce the result. The Card does not change.
- **Message pending (`openDmThread`):** the button is disabled, as today.
- **Loading member:** `MemberTileSkeleton` with the new two-row shape.
- **Member null:** render nothing, as today.

## 8. Per-tab variants

| Tab                                             | Source                             | Meta line                                                              | Actions                                                                                                                      |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Jouw netwerk**                                | `people.tsx:135–142`               | "Volgt jou" badge (when true) and location                             | Follow (state from `followRelation`: Unfollow for people you follow, Follow for followers you don't follow back) and Message |
| **Mensen vinden** (results and Recently joined) | `find-people.tsx:100–107, 127–133` | no location (`hideLocation`); badge never shows (callers pass `false`) | Follow (filled CTA in most cases) and Message (usually disabled with the not-connected tooltip)                              |
| **Activiteit**                                  | `activity-feed.tsx`                | — not a member card; unchanged                                         | —                                                                                                                            |
| `/members/$handle`                              | `profile-body.tsx:237–238, 607`    | —                                                                      | **Unchanged:** labelled buttons; `iconOnly` is not passed                                                                    |

## 9. Responsive check (wireframes)

### 360px viewport (card is 328px, one column)

```
┌──────────────────────────────────────────┐
│ ╭────╮  Hans-Peter van den Berg          │
│ │ HB │  [Volgt jou] · ⌖ Utrecht           │
│ ╰────╯                                   │
│──────────────────────────────────────────│
│ 12 in bezit  3 ruilen  ★ 4,8   [⊖] [💬] │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ ╭────╮  marieke.de.vries.puzzels@exampl  │
│ │ M  │  e.nl                             │
│ ╰────╯                                   │
│──────────────────────────────────────────│
│ 4 in bezit  0 ruilen          [⊕]  [💬] │
│ Nog geen reviews                (dimmed) │
└──────────────────────────────────────────┘
```

On touch, the buttons are 44px (`pointer-coarse:size-11`). The stats row wraps before it crowds the actions, because stats are `min-w-0 flex-wrap` and actions are `shrink-0`.

### Desktop (e.g. a 1024px content area gives 3 columns of about 330px; the minimum column is 280px)

```
┌───────────────────────────────┐ ┌───────────────────────────────┐ ┌───────────────────────────────┐
│ ╭──╮ Hans-Peter van den Berg  │ │ ╭──╮ Anouk                    │ │ ╭──╮ Puzzelaar                │
│ │HB│ [Volgt jou] · ⌖ Utrecht  │ │ │A │ ⌖ Amersfoort             │ │ │P │ [Volgt jou]              │
│ ╰──╯                          │ │ ╰──╯                          │ │ ╰──╯                          │
│───────────────────────────────│ │───────────────────────────────│ │───────────────────────────────│
│ 12 in bezit 3 ruilen ★ 4,8 ⊖ 💬│ │ 30 in bezit 11 ruilen ★ 5,0 ⊖ 💬│ │ 0 in bezit 0 ruilen  Nog… ⊕ 💬│
└───────────────────────────────┘ └───────────────────────────────┘ └───────────────────────────────┘
```

Key: ⊕ = Follow (filled primary), ⊖ = Unfollow (outline), 💬 = Message (outline, or disabled with tooltip), ⌖ = MapPin.

## 10. Accessibility summary

- **Keyboard order per card:** name link → follow button (→ dropdown items when Requested) → message button (or its focusable span when disabled). DOM order matches visual order, and there is no positive `tabindex`.
- **Link name and description:**
  - The link's name is the display name, through the visible text.
  - `aria-describedby` points to the meta line and the stats paragraph, so a screen reader hears, for example: "Hans-Peter van den Berg, link, heading level 3. Follows you, Utrecht. 12 owned, 3 swaps, Average rating 4,8 out of 5 from 12 reviews".
  - Generate both ids with `useId()`. Omit an id from the attribute when its element isn't rendered.
- **Decorative elements:** the avatar is `aria-hidden` with `alt=""`, and all icons are `aria-hidden`.
- **Buttons:** every icon button has a name-qualified `aria-label`, and the tooltip duplicates it visually. The disabled Message case keeps today's focusable span and tooltip pattern.
- **Contrast:** all text uses existing `foreground` / `muted-foreground` on `card`. These are the same pairs already shipped, so the token pairs themselves are not re-evaluated here.

## 11. Test plan

The web vitest config is `environment: "node"` with only pure `*.test.ts` tests (`apps/web/vitest.config.ts`). There is no jsdom or testing-library, and adding them is out of scope.

**Automated (write these):**

1. `apps/web/src/components/social/member-stats.test.ts` for `ratingView`:
   - `totalReviews: 0` (any `averageRating`, including 0) → `{ kind: "none" }`
   - `totalReviews: 3, averageRating: 4.8` → `{ kind: "rated", value: 4.8, count: 3 }`
   - `averageRating: 5` → rated, value 5. Formatting to "5,0" or "5.0" is the formatter's job and is asserted only by the manual check below.
2. Locale parity: a quick script or assertion in the PR checking that the 6 new keys exist in `source.json`, `en.json` and `nl.json` and that the ICU syntax parses.
   - Optional: add one test in `src/lib/i18n.test.ts` style that imports the three JSONs and checks the key paths.

**Commands:**

- Run tests with `pnpm nx run @jigswap/web:test --skip-nx-cache`.
- Run typecheck, lint and `format:check`. Ignore the known `routeTree.gen` tsc noise.

**Manual or browser-only (can't be verified headlessly here; per project memory, Playwright Chrome is unavailable, but the dev server runs on :3001):**

- Name wraps to 2 lines and doesn't truncate at 280px and at a 360px viewport. Long email fallback breaks inside the box.
- Clicking the avatar, stats or blank area navigates to `/members/$handle`. Clicking each button does **not** navigate. ⌘- and middle-click open a new tab.
- Requested dropdown opens and its tooltip shows. Disabled Message shows the not-connected tooltip on hover and focus.
- Focus ring draws around the whole card on link focus, in light and dark themes.
- Card hover tint appears over the card body but not over the buttons.
- `pointer-coarse` 44px buttons in DevTools device emulation.
- nl locale shows "4,8" and "Nog geen reviews". No "★–" anywhere.
- Screen reader (VoiceOver or NVDA) announces link name and description, and the button labels include the member name.
- Profile page buttons look unchanged (regression check for the `iconOnly` default).

## 12. Out of scope

- The display-name and initials helper itself. That is the separate display-name ticket (PR #74); this card only consumes its output (§4.4).
- `ActivityFeed` and the Activity tab.
- The grid layout and `minmax(280px)` in `people.tsx` / `find-people.tsx`. The call sites do not change.
- Profile page (`profile-body.tsx`) button styling.
- Unfollow confirmation dialog. Unfollow stays one click, as today.
- Showing "Follows you" on the Find tab. The callers hard-code `followsYou={false}`, although `followRelation.followsYou` exists. _Noted, not fixed._
- `find-people.tsx:95–98` declares `role="list"` but its children are not `listitem`s, which is an existing a11y defect. _Noted, not fixed;_ a follow-up could make each card's wrapper `role="listitem"`.
- Hiding actions on the viewer's own card, if self can appear in search results. Not verified; unchanged.
- New tokens, new dependencies (jsdom or testing-library), and new design-system components.
