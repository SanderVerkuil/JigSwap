# Message formatting and emoji: design spec

Status: DESIGN (no code). Date: 2026-10-19.
Code basis: `main` at 1b6376be08 (circle group chats, typing and presence G1–G10 shipped).
Applies to every member-authored text bubble: DMs, copy (exchange) conversations, circle group chats, and photo/location captions.

User request: Slack/Discord-like formatting in messages (bold, italic, underline, plus sensible extras), and emoji support.

## 0. What the code says today

- Bodies are plain strings, max `MAX_MESSAGE_LENGTH = 4000` characters (`packages/domain/src/conversation/domain/errors.ts:25`; duplicated on the web in `message-composer.tsx:42` and `new-copy-conversation.tsx:27`). The limit counts markers too. That stays.
- A bubble renders `{message.body}` as React text with `whitespace-pre-wrap break-words` (`apps/web/src/components/messaging/thread-view.tsx`, the `BUBBLE_CLASS` bubble near line 780 and the gallery caption near line 904). Nothing is linkified today.
- There is no message editing, no member-side deleting (only moderator removal via `removedAt`), and no message search index. Nothing to adapt there.
- `frimousse` is **already a dependency**. Wrappers live in `apps/web/src/components/ui/emoji-picker.tsx` and `emoji-picker-input.tsx` (the collection-icon picker), and the `emojiPicker` locale namespace exists. At runtime frimousse fetches `emojibase-data` from jsDelivr (see `apps/web/src/lib/emoji-label.ts`), so the emoji data is never in our bundle.
- **Architecture conflict:** `apps/web` may not import `@jigswap/domain`. The `.oxlintrc.json` boundaries policy only lets `app` import `contracts | backend-adapter | gateway | app`, and the web `package.json` has no domain dependency. `packages/contracts` can be imported by both the web and the backend, and it already holds shared pure functions (`packages/contracts/src/identity/display-name.ts`, "shared by the backend … and the web app"). Formatting is also not a Thread invariant: the domain keeps treating the body as an opaque string. **So the parser lives in `packages/contracts`, not `packages/domain`.**

## 1. Decisions

1. **Storage:** plain text with a small Discord-style markup subset. No schema change, no migration, no format flag.
2. **Rendering:** one linear-time parser to an AST, then to React elements. Never `dangerouslySetInnerHTML`, never HTML in the AST.
3. **Old messages:** they render with the new rules. There is no cutoff date (see §5).
4. **Composer:** stays a plain `<Textarea>`, plus Ctrl/Cmd+B/I/U and an emoji button that opens a lazy-loaded frimousse picker.
5. **Plain-text surfaces** (inbox previews, notifications, push, email, live-region announcements) use `stripFormatting`. The moderation evidence view shows the raw body.

## 2. Markup grammar (`packages/contracts/src/conversation/message-markup.ts`)

| Syntax                           | Node        | Element    |
| -------------------------------- | ----------- | ---------- |
| `**x**`                          | `strong`    | `<strong>` |
| `*x*` or `_x_`                   | `em`        | `<em>`     |
| `__x__`                          | `underline` | `<u>`      |
| `~~x~~`                          | `strike`    | `<s>`      |
| `` `x` ``                        | `code`      | `<code>`   |
| `https://…`, `http://…`, `www.…` | `link`      | `<a>`      |

Rules, applied in this order:

1. **Lines are independent.** The body is split on `\n` and each line is parsed alone. No span crosses a newline, and the `\n`s stay in text nodes, so `pre-wrap` keeps the line breaks. The trade-off: `**line1\nline2**` shows the markers literally. In return, a stray `*` on one line can never format a later line.
2. **Escapes:** `\` followed by one of `` \ * _ ~ ` `` gives that character as literal text. Any other backslash is a normal character.
3. **Code spans:** a single `` ` `` opens a span that runs to the next single `` ` `` on the same line. Its content is fully literal: no formatting, no escapes, no links. A run of two or more backticks is plain text, so ` ``` ` blocks are not supported and show as typed. An unclosed `` ` `` is literal.
4. **Links** are atomic tokens, found before any delimiter matching, so `https://x.nl/a_b_c` never gets formatted.
   - A link starts at `http://`, `https://` or `www.` (case-insensitive), only at the start of the line or after a character that is not a letter or digit.
   - It runs to the next whitespace. Trailing `.,:;!?'"` are then trimmed, plus any trailing `)` that has no opening `(` inside the URL (the GFM rule).
   - `www.` gets the href `https://www.…`.
   - The href must pass `new URL()` with `protocol` equal to `http:` or `https:`. Otherwise the text stays literal.
   - Only those literal prefixes are ever matched, so `javascript:`, `data:` and the like are never links. There is no `[text](url)` syntax (that is a phishing vector), and the text shown is always the URL itself.
5. **Delimiters:** a run of `*` or `_` of length 1 means `em`; length 2 means `strong` (`*`) or `underline` (`_`); length 3 means both (on open: outer strong/underline, then em; on close: the reverse). A length of 4 or more is literal. Only a `~~` run of exactly 2 is a delimiter; a single `~` is literal.
6. **Flanking and word boundaries.** These rules are what keep `snake_case`, `2*3*4`, `5 * 3`, `a**b**c` and `~~` in prose literal.
   - An opener must be followed by a non-whitespace character and must not be preceded by a Unicode letter or digit (`\p{L}\p{N}`).
   - A closer must be preceded by a non-whitespace character and must not be followed by a letter or digit.
   - Punctuation is fine on either side: `(**x**),` works.
7. **Matching** works per line, with a stack of open delimiters. A kind never nests inside itself, so the stack holds at most 5 entries and the scan stays O(n).
   - A delimiter whose kind is already open and that can close, closes it. Any openers above it on the stack turn back into literal text.
   - Otherwise, if it can open, it is pushed.
   - Otherwise it is literal.
   - Openers left on the stack at the end of the line are literal.
   - Empty content (`****`, `~~~~`) is literal.
   - The nesting depth is therefore bounded by construction, and no explicit limit is needed.
8. **No regex with nested quantifiers.** The scan is a single index loop, and only one-character class tests use regex. Performance target: 40,000 characters of pathological input parse in under 50 ms in the vitest run.

API (pure, zero dependencies, exported from `@jigswap/contracts`):

```ts
export type MarkupNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; text: string }
  | { type: "strong" | "em" | "underline" | "strike"; children: MarkupNode[] };
export function parseMessageMarkup(body: string): MarkupNode[];
export function stripFormatting(body: string): string; // = toPlainText(parseMessageMarkup(body))
```

What `stripFormatting` does:

- It removes exactly the markers that would have formatted.
- Literal (unmatched) markers stay.
- Escapes are unescaped.
- A code span becomes its content, without the backticks.
- A link becomes its visible text.
- Whitespace and newlines are left unchanged; callers still collapse them as they do today.

Because the parser and `stripFormatting` share one pass, the rendered text and the stripped text can never disagree.

## 3. Rendering (web)

- New file `apps/web/src/components/messaging/message-text.tsx`: `<MessageText body={…} />` calls `useMemo(parseMessageMarkup)` and maps the nodes to `<strong> <em> <u> <s> <code> <a>`.
  - `<code>`: `rounded px-1 font-mono text-[0.9em]`, with a background tint that reads on both `bg-primary` (own) and `bg-muted` bubbles (`bg-black/10 dark:bg-white/15`).
  - `<a>`: `href` from the node, `target="_blank"`, `rel="noopener noreferrer nofollow ugc"`, `underline break-all`, and the colour inherited from the bubble.
- `thread-view.tsx` replaces `{message.body}` with `<MessageText>` in both bubble sites (text and captions). System rows (`systemEventText` and the system `body`) stay plain text.
- **Copy text** (`message-actions.tsx`, `navigator.clipboard.writeText(body)`) keeps copying the **raw** body, as Discord does. Pasted back into a composer, it renders the same.
- **Accessibility:** the elements carry semantic meaning. Screen readers read the text, and links are announced as links.
- **Plain-text call sites that change to `stripFormatting(…)`** before their existing whitespace collapse:
  - `format.ts` (the circle preview, around lines 155–166);
  - `thread-list.tsx` (around line 379, the DM/exchange preview with `youPrefix`);
  - `thread-view.tsx` (around line 342, the live-region announcement).
- **Inbox previews of long messages.** `toLastMessage` (`packages/backend/convex/conversation/adapters/threadMapper.ts:137`) truncates to 280 code points, which can cut a pair, for example `**long…`. The stripped preview then shows a literal `**`. That is accepted: it only happens for messages over 280 characters.
  - The alternative is to strip before truncating on write. It is **rejected**: older rows would keep raw text, and stripping an already-stripped `\*x\*` would format it a second time.

## 4. Backend plain text

There is one choke point: `messagePreviewOf` (`packages/backend/convex/notifications/viewRules.ts:346`) becomes `stripFormatting` → collapse → trim → truncate. It feeds:

- the in-app notification context (`resolveNotificationView.ts:553`, then `notification-item.tsx`);
- the `message_received` copy for push and email (`notifications/copy.ts`, `deliveryContent.ts`).

Circle messages never leave the app with their text (`resolveForDelivery.ts`), and that is unchanged.

**Admins:**

- `admin/reportViews.ts` `targetSummaryOf` also goes through `messagePreviewOf`, so the one-line summary in the report list is stripped, which is better for reading.
- The evidence detail (`apps/web/src/components/admin/moderation/report-detail.tsx:184`) keeps showing the **raw** body, unrendered and without clickable links. Moderators see exactly what was sent, and abuse hidden in markers stays visible.

The domain is unchanged: length and emptiness are checked on the raw body. A body of only markers, such as `****`, is non-empty and renders literally.

## 5. Existing messages: no cutoff

Rendering only messages sent after the rollout would mean a `sentAt` threshold in every renderer and in `messagePreviewOf`, which doubles the test surface. The rules in §2 make accidental formatting unlikely:

| Old text                           | Result       | Why                                                |
| ---------------------------------- | ------------ | -------------------------------------------------- |
| `snake_case_name`, `2*3*4`, `a**b` | literal      | boundary rule (letter or digit next to the marker) |
| `5 * 3 = 15`, `* note`             | literal      | whitespace after the opener                        |
| `*sigh*`, `_really_`               | italic       | intended emphasis anyway                           |
| `~ 20 min`, `~200 pieces`          | literal      | a single `~` is never a delimiter                  |
| `` `x` ``                          | code         | rare, and clearly intended                         |
| `C:\Users\x`                       | unchanged    | `\U` and `\x` are not escapes                      |
| `C:\\share`                        | `C:\share`   | `\\` unescapes (rare; accepted)                    |
| URLs                               | become links | links are new; nothing was linkified before        |

**Recommendation:** no cutoff. Optional, before launch: the user runs a one-off read-only count on prod of message bodies that contain `*`, `_`, `~~`, `` ` `` or `\`, and then a sample of their `stripFormatting` diffs. This is not a blocker.

## 6. Composer shortcuts

Composers: `message-composer.tsx` (DM, exchange and circle threads) and `new-copy-conversation.tsx`. Both keep the plain `Textarea`.

**Why not contenteditable or WYSIWYG:**

- the stored format is text, and a textarea shows it exactly;
- it keeps `maxLength`, IME, mobile autocorrect, the typing indicator (`typing.onInput`), the Enter/Shift+Enter handling and the existing tests;
- a contenteditable editor (Lexical, TipTap) adds a large dependency plus its own sanitising and paste handling, for three styles.

**The edit function.** A pure `applyMarker(value, selStart, selEnd, marker)` in `apps/web/src/components/messaging/markup-shortcuts.ts` returns `{ replaceStart, replaceEnd, insert, selStart, selEnd }`:

- **Empty selection:** insert the pair and put the caret between the markers.
- **Selection:** trim leading and trailing whitespace out of the wrap, so the flanking rules still hold.
- **Selection spanning several lines:** wrap each non-empty line separately, because spans don't cross newlines.
- **Toggle:** if the selection is already wrapped by the same marker, the markers are removed instead.
- **Length:** if the result would exceed `MAX_MESSAGE_LENGTH`, nothing happens.

**The hook.** `useMarkupShortcuts(textareaRef)` is composed into each `onKeyDown`:

- Shortcuts:
  - `Mod+B` gives `**`;
  - `Mod+I` gives `*`;
  - `Mod+U` gives `__`;
  - `Mod` is Cmd on macOS and Ctrl elsewhere.
- Each shortcut calls `preventDefault`, which also stops Firefox's Ctrl+B sidebar and Ctrl+U view-source. Verify both in the browser.
- The hook applies the edit through `setSelectionRange` and `document.execCommand("insertText")`, which keeps native undo and fires `input` (so `onChange`, `setBody` and `typing.onInput` run). If that call returns `false`, it falls back to `setRangeText` plus a manual `setBody`.

There is no formatting toolbar in v1. The composer row is already full on mobile, and mobile users type the markers. The shortcuts are documented in the user docs and What's new, and the textarea gets `aria-keyshortcuts="Control+B Control+I Control+U Meta+B Meta+I Meta+U"`.

## 7. Emoji

- **Native Unicode emoji only.** Emoji are plain text in the body and need no parser support. There are no image sprites and no custom emoji.
- **The picker reuses frimousse.** It is already a dependency, it has shadcn-style wrappers, the `emojiPicker` locale namespace exists, and its data comes from the jsDelivr CDN at runtime.
  - **emoji-mart** with `@emoji-mart/data`: rejected. Its data ships in the bundle; I'm not confident of the exact size, but it is well over 100 kB.
  - **emoji-picker-element:** rejected. It is a web component, so it would be a second picker style.
  - **A hand-rolled curated set:** rejected. It is more code and gives a worse search.
- **The button:** a `Smile` icon button in the composer row, next to `AttachMenu`, shown at `md` and up (phones have an OS emoji keyboard). It has a localized `aria-label` and a tooltip, and opens a Radix `Popover`.
- **Lazy loading:** the popover content is `React.lazy(() => import("./message-emoji-picker"))`, so frimousse loads on the first open only and never sits in the messages route chunk.
- **Bundle cost:** frimousse's own gzip size is unknown to me (it is a small, dependency-free React component). Measure it with the build output before and after, and record the number in the PR.
- **Picking:** an emoji is inserted at the caret through the same `insertText` helper. The popover closes and focus returns to the textarea. If the insert would exceed the length limit, nothing happens.
- **`:shortcode:` autocomplete: deferred.** It needs the separate emojibase shortcode dataset and a caret-anchored combobox on a textarea. That isn't cheap.

## 8. i18n and docs

- **New keys**, added to `apps/web/locales/en.json`, `nl.json` and `source.json`:
  - `messages.emojiButton` ("Add emoji" / "Emoji toevoegen");
  - `messages.formattingHint`, used in the docs and, if wanted, as the emoji-button tooltip suffix ("Ctrl+B bold, Ctrl+I italic, Ctrl+U underline"). The modifier shows as "⌘" on macOS.
- **Docs:** `docs/user/en/staying-informed/messages.md` and the `nl` counterpart get a "Formatting" section that shows the syntax table, links and emoji.
- **What's new:** add one bullet (formatting, links, emoji) to the combined entry `docs/whats-new/2026-10-19-messages-improvements-2026-10-19.{en,nl}.md` ("Improvements to messages"), update its `summary`, and regenerate the manifest.

## 9. Test plan

- **`message-markup.spec.ts` (contracts):**
  - each style, and `***x***`;
  - mismatched nesting (`**a *b** c*`);
  - `snake_case`, `2*3*4`, `a**b**c`, `5 * 3`, `__init__`;
  - unmatched and empty markers (`****`);
  - escapes, including inside code;
  - code containing `*` and URLs;
  - spans broken by a newline, and `\n` kept;
  - link trimming (`(see https://x.nl/a).`), `www.`, `HTTPS://`;
  - `javascript:alert(1)`, `<script>` and `data:` staying text;
  - a URL with `_`;
  - non-Latin text (`é`, CJK) and emoji next to markers;
  - performance: 40,000 characters each of `*`, `**a`, `_a`, `` `a ``, `\\`, `http://` followed by `(`, and alternating `*_~`, each under 50 ms.
- **`stripFormatting` (same spec):**
  - a round-trip table: rendered text equals stripped text for every case above;
  - idempotence is **not** expected (escapes), and one test documents that.
- **Backend (`notificationViewRules.test.ts`):** `messagePreviewOf("**hi** _there_")` gives `"hi there"`, and truncation still applies after stripping.
- **Web:**
  - `markup-shortcuts.test.ts` (pure): wrap, toggle, empty selection, whitespace trim, multi-line, length cap;
  - a composer test: Ctrl+B on a selection produces `**sel**`, and Enter still sends;
  - `message-text.test.tsx`: the semantic elements and the link `rel` and `target`, with no `innerHTML` path;
  - `format.ts` and `thread-list` preview tests with markers;
  - an emoji test: opening loads the picker, and picking inserts at the caret.
- **Browser check** (the Docker CDP setup): send a formatted message in a DM and in a circle; check own and other bubbles, light and dark, the inbox preview and the notification.

## 10. Out of scope

- block quotes, lists, headings, code blocks, spoilers;
- `[text](url)` links and link previews;
- mentions;
- custom emoji, reactions, jumbo emoji-only messages;
- `:shortcode:` autocomplete;
- a formatting toolbar;
- message editing.

None of these exist in the code today.

## 11. Implementation plan (atomic commits, one stacked PR each or one PR)

1. `feat(contracts): message markup parser and stripFormatting`: `message-markup.ts`, its spec, and the export from `conversation/index.ts`. Verify with `pnpm turbo run test lint type-check --filter=@jigswap/contracts`.
2. `feat(notifications): strip message formatting from previews`: `messagePreviewOf` and its tests. Verify with the backend tests.
3. `feat(web): render formatted message text`: `message-text.tsx`, the bubble sites in `thread-view.tsx`, the previews in `format.ts`/`thread-list.tsx`, the live region, and tests.
4. `feat(web): Ctrl/Cmd+B/I/U formatting shortcuts in the composer`: `markup-shortcuts.ts`, the hook, both composers, and tests.
5. `feat(web): emoji picker in the message composer`: the lazy `message-emoji-picker.tsx`, the button, locale keys (en/nl/source), tests, and the bundle size noted in the PR.
6. `docs: message formatting (user docs + What's new)`.

Before each commit, run `pnpm format` and the CI mirror: `format:check` plus `turbo run lint type-check test build arch:check --force`.

## 12. Decided defaults (user may override)

These were open questions; the implementation uses the spec's defaults. Each can be changed later without a data migration, since the stored body is plain text.

1. **No cross-line spans.** Discord allows them; this spec does not, for predictability (a stray `*` can never format a later line).
2. **Emoji button at `md` and up only.** Phones have an OS emoji keyboard and the composer row is already full there. In the row it sits between the textarea and the paperclip (`AttachMenu`), so DOM order equals visual order: `[ Message ] [ emoji ] [ paperclip ] [ Send ]`.
3. **`_x_` is italic** as well as `*x*` (as in Discord). The word-boundary rule keeps `snake_case` literal.
