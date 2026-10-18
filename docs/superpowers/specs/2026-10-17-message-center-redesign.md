# Message center redesign — UI spec

Status: design, ready for implementation (3 stacked PRs). Replaces the "PROVISIONAL" layout from
`2026-07-02-conversation-messaging-design.md` § Web. Presentation-first; backend changes are
scoped to PR2/PR3 below.

## 1. Audit findings (why "the lines appear a bit random")

1. **Variable-width time column steals the text width.** `thread-list.tsx:155-161` renders
   `formatDistanceToNow(..., { addSuffix: true })` ("less than a minute ago" / "minder dan een
   minuut geleden", 10–30 chars) in a `shrink-0` column. Every row's name and snippet truncate at
   a different x, so ellipses land in random places ("esth…", "Deze …") in a `w-80` pane.
2. **Name and time are not on one baseline.** The time column is `self-start pt-0.5` +
   `text-xs` (`:155-156`) while the name is `text-sm` in an `items-center` row (`:131`), so time
   floats ~2px off the name, and the unread pill under it (`:164-169`) makes the right column
   taller than the text block in some rows.
3. **Dividers don't match highlights.** `border-b` on all but the last row (`:132`) runs the
   full pane width while content is inset `px-2`; the selected `bg-muted/60` (`:133`) sits on top
   of the divider; the list has no header but the thread pane has a `border-b` header
   (`thread-view.tsx:109`), so horizontal rules in the two panes sit at unrelated heights.
4. **Weak unread signal.** Read rows are already `font-semibold`, unread `font-bold`
   (`thread-list.tsx:140-141`) — barely different, and the width shift changes truncation.
5. **Skeleton ≠ row.** `thread-list.tsx:63-77` (3 rows, `space-y-3`, no time column) jumps on
   load.
6. **Pane geometry.** All three routes hard-code `h-[calc(100dvh-14rem)]`
   (`index.tsx:21`, `$threadId.tsx:41`, `new.tsx:24`): ~30px dead band on desktop, wrong on mobile
   (shell bars are ~9.5rem). `index.tsx:25` uses `border-l pl-6`, `$threadId.tsx:45` uses
   `md:border-l md:pl-6` with `gap-6` — the divider is offset from the list edge.
7. **Thread noise.** Every bubble prints full `dateStyle/timeStyle: short` (`thread-view.tsx:197-200`);
   uniform `space-y-4` (`:142`) with no grouping or day breaks; `max-w-xs` / `rounded-lg`
   bubbles; the copy card (`bg-background`) is nested inside the purple own-bubble (`:183-184`).
8. **Composer misalignment / small targets.** Textarea `min-h-9` (36px) beside a `size="sm"`
   button (32px) (`message-composer.tsx:109-114`); back buttons are `size-9`
   (`thread-view.tsx:113`, `new-copy-conversation.tsx:90`) — all below 44px.
9. **Mobile chrome.** No code currently hides the mobile tab bar while typing
   (`mobile-tab-bar.tsx` is unconditional `sticky bottom-0`); with
   `interactive-widget=resizes-content` the 56px tab bar rides above the keyboard, and the mobile
   top bar's back chevron (to Community) stacks above the thread's own back chevron.

## 2. Layout

**Desktop (≥ md, designed at 1280).** One framed two-pane surface inside the content card:
`flex md:h-[calc(100svh-12.25rem)] md:min-h-[480px] overflow-hidden rounded-xl border bg-card`.
List pane `w-[340px] xl:w-[360px] shrink-0 border-r flex flex-col`; thread pane `min-w-0 flex-1
flex flex-col`. Both panes start with a `h-14 border-b` header so the rules align.

```
┌──────────────────────────────┬──────────────────────────────────────────────┐
│ Conversations             h14│ (av) Esther de Vries      [Profile][Puzzle] │ h14
├──────────────────────────────┼──────────────────────────────────────────────┤
│▌(av) Esther de Vries     2h  │                 ── Today ──                  │
│     🧩 Ravensburger… · Deze… ●2│ ┌──────────────┐                            │
│ (av) Mara                Mon │ │ Hoi! Is deze │                            │
│     You: Thanks!             │ └──────────────┘ 14:02                      │
│ (⇄)  Trade: Starry Night 12 Oct│                    ┌───────────────────┐   │
│     Exchange accepted        │                    │ Ja, nog steeds!   │   │
│                              │                    └───────────────────┘ 14:05│
│                              ├──────────────────────────────────────────────┤
│                              │ [🧩] [ Message Esther…              ] (➤)   │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

`/messages` (no thread): thread pane shows the empty state (§8). `/messages/new` uses the same
frame with `NewCopyConversation` in the thread pane.

**Mobile (< md, designed at 390).** `/messages` = list only, full width, no frame (shell top bar
"Messages" + tab bar stay). `/messages/$threadId` and `/messages/new` are **immersive**: hide
`MobileTopBar` and `MobileTabBar` (one helper `isImmersiveMobileRoute(pathname)` in
`route-meta.ts`, true for `/messages/<anything>`; both bars `return null` when it is true). The page
becomes `-mx-4 -mt-[18px] -mb-6 flex h-dvh flex-col md:m-0 md:h-auto`; the thread header is
`sticky top-0` with `pt-[env(safe-area-inset-top)]`, the message list `flex-1 overflow-y-auto`,
the composer last with `pb-[max(0.625rem,env(safe-area-inset-bottom))]`. Because the viewport is
`resizes-content`, `h-dvh` shrinks with the keyboard and the composer stays glued above it.

```
┌────────────────────────────┐
│ ‹  (av) Esther de Vries  ⋮ │ h14, sticky
├────────────────────────────┤
│        ── Today ──         │
│ ┌────────────┐             │
│ │ Hoi! Is …  │             │  flex-1, scrolls
│ └────────────┘ 14:02       │
│            ┌─────────────┐ │
│            │ Ja!         │ │
│            └─────────────┘ │
├────────────────────────────┤
│ [🧩] [Message Esther… ] (➤) │ sticky above keyboard
└────────────────────────────┘
```

## 3. Conversation row spec

Markup: `<nav aria-label={t("conversationsLabel")}><ul role="list" class="flex flex-col gap-0.5 p-2">`
(mobile: `-mx-2`), one `<li>` per thread, no dividers. Row = `Link`:

| Part               | Classes                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row                | `group flex h-[68px] items-center gap-3 rounded-lg px-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring`                                                                                          |
| Selected           | `aria-current="page"` + `bg-jigsaw-primary-tint hover:bg-jigsaw-primary-tint` and a `absolute left-0 inset-y-3 w-[3px] rounded-full bg-primary` bar (row `relative`)                                                                            |
| Avatar             | existing `ThreadSubjectAvatar`, fixed `size-10` (avatar, anon `User`, exchange `ArrowLeftRight` chip)                                                                                                                                           |
| Text column        | `min-w-0 flex-1` with two lines, each `flex items-baseline gap-2`                                                                                                                                                                               |
| Line 1 name        | `min-w-0 flex-1 truncate text-sm leading-5 font-medium text-foreground`; unread → `font-bold`                                                                                                                                                   |
| Line 1 time        | `shrink-0 text-xs leading-5 tabular-nums text-muted-foreground`; unread → `font-semibold text-primary-text`. `<time dateTime={iso} title={full}>`                                                                                               |
| Line 2             | `mt-0.5 flex items-center gap-2 text-[13px] leading-5`                                                                                                                                                                                          |
| Snippet            | `min-w-0 flex-1 truncate text-muted-foreground`; unread & not system → `text-foreground font-medium`. Own last message prefixed `t("youPrefix")`. System → `italic`. Empty thread → `t("noMessages")`                                           |
| Context chip (PR2) | before the snippet: `inline-flex max-w-[45%] shrink-0 items-center gap-1 font-medium text-primary-text` + `Puzzle size-3.5` + truncated title, then `<span aria-hidden>·</span>`                                                                |
| Unread badge       | line 2 right, `shrink-0 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground` with `formatUnreadCount`; `aria-hidden`, keep the existing sr-only `unreadCount` text |

Rules: name gets all width left of a time label that is ≤ ~11 chars ("12 okt 2025"); snippet is
always one line (`truncate`, newlines collapsed with `.replace(/\s+/g, " ")`); exchange rows keep
the `threadSubjectTitle` "Trade: <title>" and get no context chip. List header (md+ only):
`h-14 border-b px-4 flex items-center`, `h2 font-heading text-base font-bold` "Conversations".

## 4. Compact timestamp (list rows)

Pure helper `formatCompactTime(at, now, locale, t)` in `format.ts` (unit-tested with fixed `now`).
Full form for `title`/accessible label: `Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" })`.

| Age        | Rule                                  | en                                  | nl                               |
| ---------- | ------------------------------------- | ----------------------------------- | -------------------------------- |
| < 1 min    | `t("time.now")`                       | now                                 | nu                               |
| < 60 min   | `t("time.minutes", {count})`          | 5m                                  | 5 min                            |
| < 24 h     | `t("time.hours", {count})`            | 2h                                  | 2 u                              |
| < 7 days   | `{weekday:"short"}`                   | Mon                                 | ma                               |
| same year  | `{day:"numeric", month:"short"}`      | Oct 12                              | 12 okt                           |
| older      | `+ year:"numeric"`                    | Oct 12, 2025                        | 12 okt 2025                      |
| title/aria | `dateStyle:"full", timeStyle:"short"` | Monday, October 12, 2026 at 2:05 PM | maandag 12 oktober 2026 om 14:05 |

(en follows Intl's `en` month-first order; we don't force en-GB.) Re-render the list every 60s
via a shared `useNow(60_000)` so "now"/"5m" stay fresh.

## 5. Thread header

`flex h-14 shrink-0 items-center gap-3 border-b bg-card px-2 md:px-4`.

- Mobile back: `Link` to `/messages`, `size-11 -ml-1 rounded-lg hover:bg-accent`, `ChevronLeft size-5`, `aria-label={t("backToInbox")}`, `md:hidden`.
- `ThreadSubjectAvatar` at `size-9` (add a `className` prop).
- Title `<h2 tabIndex={-1} class="min-w-0 flex-1 truncate font-heading text-base font-bold outline-none">`.
- Quick links (PR2, server-gated: render only when the field is non-null):
  - Desktop (`hidden md:flex gap-1`): `Button asChild variant="ghost" size="sm"` → `Link`
    with `User` icon + `t("goToProfile")` (`/members/<profileHandle>`) and `Puzzle` icon +
    `t("goToPuzzle")` (`/copies/<contextCopy.copyId>`).
  - Mobile (`md:hidden`): `DropdownMenu` (ui/dropdown-menu) trigger `Button variant="ghost"
size="icon" class="size-11"` with `MoreVertical`, `aria-label={t("threadActions")}`; items
    `DropdownMenuItem asChild` → same two links. Trigger is omitted when both links are absent.
- Exchange threads: title as today; puzzle link when the exchange's copy is viewable; no profile link.

## 6. Bubbles, grouping, day separators

Pure helper `groupThreadMessages(messages, me, now, locale, t)` → items
`{ type: "day", label } | { type: "system", message } | { type: "group", own, messages[] }`.
A group = consecutive non-system messages by the same author, same calendar day, each ≤ 5 min
after the previous one.

- Scroller: `<ol aria-label={title} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 md:px-6">`.
- **Day separator** before the first message of each local day: `flex items-center gap-3 py-1`,
  hairlines `h-px flex-1 bg-border` (`aria-hidden`), label `text-xs font-semibold text-muted-foreground`.
  Labels: Today → `t("dayToday")`, Yesterday → `t("dayYesterday")`, < 7 days → `{weekday:"long"}`
  ("Monday" / "maandag"), this year → `{weekday:"short", day:"numeric", month:"short"}`
  ("Mon, Oct 12" / "ma 12 okt"), older → `{day:"numeric", month:"short", year:"numeric"}`.
- **Group**: `flex flex-col gap-0.5`, `items-end` (own) / `items-start` (other). No avatars.
- **Bubble**: `max-w-[min(80%,30rem)] rounded-2xl px-3.5 py-2 text-sm leading-5 break-words whitespace-pre-wrap`;
  own `bg-primary text-primary-foreground`, other `bg-muted text-foreground`. Corner tightening on
  the inner side: own first `rounded-br-md`, middle `rounded-r-md`, last `rounded-tr-md`; other
  mirrored (`bl`/`l`/`tl`). Single bubble = no tightening. Each bubble `title={full datetime}`.
- **Time**: once per group under the last bubble, `<time class="px-1 pt-0.5 text-[11px] tabular-nums text-muted-foreground">`
  `{timeStyle:"short"}` ("2:05 PM" / "14:05"). Pending optimistic messages (`id` starts with
  `pending-`) show `opacity-70` and no time.
- **System message**: own row, `mx-auto max-w-sm text-center text-xs text-muted-foreground`
  with leading `Info size-3.5` inline; it breaks groups.
- **Copy card in a message**: rendered as a sibling _before_ the text bubble in the group (never
  inside the purple bubble): `MessageCopyCard className="w-72 max-w-full"`.
- **Unavailable copy** (PR2, `copyUnavailable`): same `w-72` geometry, not a link:
  `flex items-center gap-3 rounded-lg border border-dashed p-2 text-muted-foreground`, `size-12
rounded-md bg-muted` tile with `PuzzleIcon size-5`, text `text-sm` `t("copyUnavailable")`.

## 7. Composer & attach picker

Composer: `border-t bg-card px-3 pt-2.5 md:px-4 md:pb-3` (+ mobile safe-area pb, §2).

- Staged attachment (PR3) above the row: `mb-2 flex w-fit max-w-full items-center gap-2 rounded-lg
border bg-background p-1.5 pr-1`, thumb `size-8 rounded-md`, title `truncate text-sm font-medium`,
  remove `Button variant="ghost" size="icon" class="size-8"` `X` with `aria-label={t("removeAttachment",{title})}`.
- Row `flex items-end gap-2`:
  - Attach (PR3): `Button variant="ghost" size="icon" class="size-11 md:size-10 rounded-full text-muted-foreground"`, `Puzzle` icon, `aria-label={t("attachPuzzle")}`.
  - `Textarea rows={1} class="min-h-11 md:min-h-10 max-h-40 flex-1 resize-none rounded-[20px] px-4 py-2.5"`,
    `aria-label={t("messageName",{name})}`, placeholder `t("typeMessage")`.
  - Send: `Button size="icon" class="size-11 md:size-10 rounded-full"`, `Send size-4`; enabled when text trimmed or attachment staged.
- Error: unchanged `role="alert" text-destructive text-xs mt-1.5`.
- `NewCopyConversation` adopts the same composer + staged-attachment chip (copy pre-staged, not
  removable) instead of the "About this puzzle" card block — one visual model.

Picker (PR3): `Dialog` (`DialogContent class="max-w-md p-0 gap-0"`) at md+, `Sheet side="bottom"`
(`h-[85dvh] rounded-t-[20px] p-0`, styled like `mobile-quick-sheet.tsx`) below md, chosen with `useIsMobile()`.
Content: title `t("attachTitle")`; `Tabs` with `UNDERLINE_TABS_LIST_CLASS`/`TAB_TRIGGER_CLASS`
("My puzzles" / "<Name>'s puzzles"; anonymous partner → only "My puzzles"); `Input` with `Search`
icon, `placeholder={t("searchPuzzles")}`, autofocus on desktop only; scroll list `ul role="listbox"`
of rows `flex h-16 items-center gap-3 rounded-lg px-3 hover:bg-muted/60 aria-selected:bg-jigsaw-primary-tint`:
cover `size-12 rounded-md` (Puzzle fallback, as `MessageCopyCard`), title `truncate text-sm font-semibold`,
meta `truncate text-xs text-muted-foreground` "brand · N pieces" (`copyConversation.pieces`).
Selecting stages the copy, closes the picker and focuses the textarea. One attachment per message.

## 8. States

- **List loading**: 6 skeleton rows with the exact row box (`h-[68px] px-3 gap-3`): `Skeleton size-10 rounded-full`,
  line 1 `h-3.5 w-32` + `ml-auto h-3 w-8`, line 2 `h-3 w-48`. Header loading: `Skeleton size-9 rounded-full` + `h-4 w-36`.
- **Thread loading**: 4 bubbles `Skeleton h-9 rounded-2xl` alternating `w-[55%]` left / `w-[40%]` right.
- **List empty**: existing icon + `empty`/`emptyHint`, centered in the list pane with `py-16`.
- **No thread selected (desktop)**: thread pane `flex flex-1 flex-col items-center justify-center gap-2`,
  `MessageSquare size-6` in a `size-12 rounded-full bg-muted` tile (replace the 🧩 emoji for consistency
  with the list empty state), `h2 font-heading text-lg font-bold` `selectConversation`, hint `text-sm text-muted-foreground`.
- **Thread empty**: existing `noMessages`/`noMessagesHint` block.
- **Inbox error**: `p-6 text-center text-sm` `t("inboxError")` + `Button variant="outline" size="sm"` `t("retry")` (refetch).
- **Thread not found**: unchanged (`AppNotFound`).
- **Copy unavailable**: §6 placeholder.

## 9. Accessibility

- List: `nav[aria-label]` > `ul` > `li` > `a[aria-current="page"]` on the open thread. Link
  accessible name = name + snippet + unread count + full time (visible spans are fine; the
  `title` is not relied on). Context chip text is part of the link text.
- Thread switch: after navigation (thread id change), focus the header `h2` (`tabIndex=-1`)
  with `preventScroll`. On `/messages/new` focus the textarea (desktop only; never auto-open the mobile keyboard).
- Composer: `aria-label` = "Message {name}"; send/attach/remove have `aria-label`s; Enter sends, Shift+Enter newline.
- Live region: one `div aria-live="polite" aria-atomic="true" class="sr-only"` in `ThreadView`;
  when a new message from someone else (not first load, not own) arrives, set
  `t("newMessageAnnouncement",{name, body})` (body truncated to 140 chars).
- Focus rings: rows/buttons use `focus-visible:ring-2 focus-visible:ring-ring` (no `outline-none` without a ring).
- Contrast: purple text on dark surfaces uses `text-primary-text` (time when unread, context chip),
  never `text-primary`. Own bubble `bg-primary`/`text-primary-foreground` passes AA in both themes;
  muted text only on `bg-card`/`bg-background`, never on `bg-muted` bubbles (timestamps live outside bubbles).
- Touch: every control ≥ 44px below md (`size-11`); rows are 68px.
- `prefers-reduced-motion`: replace the smooth auto-scroll with instant (`behavior: "auto"`).

## 10. New i18n keys (`messages.*`, add to en.json, source.json (= en), nl.json)

| Key                      | en                                 | nl                                        |
| ------------------------ | ---------------------------------- | ----------------------------------------- |
| `conversationsLabel`     | Conversations                      | Gesprekken                                |
| `time.now`               | now                                | nu                                        |
| `time.minutes`           | {count}m                           | {count} min                               |
| `time.hours`             | {count}h                           | {count} u                                 |
| `dayToday`               | Today                              | Vandaag                                   |
| `dayYesterday`           | Yesterday                          | Gisteren                                  |
| `youPrefix`              | You: {body}                        | Jij: {body}                               |
| `newMessageAnnouncement` | New message from {name}: {body}    | Nieuw bericht van {name}: {body}          |
| `inboxError`             | Couldn't load your conversations.  | Je gesprekken konden niet worden geladen. |
| `retry`                  | Try again                          | Opnieuw proberen                          |
| `threadActions`          | Conversation options               | Gespreksopties                            |
| `goToProfile`            | View profile                       | Profiel bekijken                          |
| `goToPuzzle`             | View puzzle                        | Puzzel bekijken                           |
| `copyUnavailable`        | This puzzle is no longer available | Deze puzzel is niet meer beschikbaar      |
| `attachPuzzle`           | Attach a puzzle                    | Puzzel bijvoegen                          |
| `attachTitle`            | Attach a puzzle                    | Puzzel bijvoegen                          |
| `tabMine`                | My puzzles                         | Mijn puzzels                              |
| `tabTheirs`              | {name}'s puzzles                   | Puzzels van {name}                        |
| `searchPuzzles`          | Search puzzles                     | Zoek puzzels                              |
| `noPuzzles`              | No puzzles to show                 | Geen puzzels om te tonen                  |
| `noPuzzleResults`        | No puzzles match "{query}"         | Geen puzzels gevonden voor "{query}"      |
| `removeAttachment`       | Remove {title}                     | {title} verwijderen                       |

Also fix casing of existing `sendMessage`: "Send message" / "Bericht versturen".

## 11. PR split

**PR1 — layout, list, thread, composer visuals (web only, no backend).**
`format.ts`: `formatCompactTime`, `formatDayLabel`, `groupThreadMessages` + `format.test.ts`
cases (en+nl, each table row, group boundaries at 5 min / day / system). Frame + heights (§2),
`isImmersiveMobileRoute` in both mobile bars, row spec (§3, without context chip), list header,
skeletons, thread header (§5 without quick links), bubbles/day separators/system/copy-card
placement (§6), composer restyle (§7 without attach), states, a11y (§9), PR1 i18n keys.
`trades.tsx` embed (`hideHeader`) must still render — check it in a 320px-tall box.

**PR2 — header quick links + inbox puzzle context (backend view changes).**
`InboxThreadView` gains `contextCopy: { copyId, title } | null` (DM: the most recent message's
copy the viewer can still view; exchange: the exchange's requested copy when viewable) and the DM
subject gains `profileHandle: string | null` (null when anonymised or not viewable — server decides).
`ThreadMessageView` gains `copyUnavailable?: true` when a message references a copy the reader can
no longer view. Web: context chip (§3), quick links + mobile dropdown (§5), unavailable card (§6).

**PR3 — in-thread attach picker (backend + web).**
`postMessage` accepts optional `copyId` (same visibility gate as `startCopyConversation`); a query
listing attachable copies for `{ threadId, side: "mine" | "theirs", search }` returning
`MessageCopyView[]`. Web: attach button, picker (§7), staged chip, optimistic append carries the
copy, `NewCopyConversation` composer unification.
