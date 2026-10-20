# Chat photos: delivered at send time, shown "pending review" until checked — design spec

Status: DESIGN. Date: 2026-10-20. Supersedes the "deferred append" of
`2026-10-18-messaging-attachments-safety-design.md` (sections 2.2 Visibility, R.1 and the
photo-state table in section 3), which now point here.

## Problem

Today a chat photo becomes a thread message only once it is moderated, hash-checked and
re-encoded (`settleSendBatch` in `conversation/messageAttachments.ts`), in send order, and the
walk stops at the first photo still being checked. Two failures follow:

1. A photo stuck "unscored" before its re-encode is never deliverable, so it blocks the rest of
   its send batch forever.
2. A slow check (the Workpool retries run for about 30 minutes; an outage can take hours) makes a
   photo appear long after the conversation moved on, or merged into an earlier gallery, where
   the recipient scrolls past it and never sees it.

User decision (2026-10-20, verbatim): "all photos should be sent, and the other should see them,
though only as a blurhash with 'pending review' until it has been reviewed. If the image was
flagged, it should be displayed as being flagged to the receiver as well."

## Decisions

### D1. Append at send time

- `sendStagedImages` appends one image message per photo **immediately**, in send order, with
  the caption on the batch's last photo, through the domain `PostMessage` use case (participant
  rule, `MessagePosted`, unread counts, inbox summary). `sentAt` is the send time.
- Implementation: `settleSendBatch` keeps its walk but no longer stops at a photo that is still
  being checked. It appends every photo of the batch that has no message yet and is not stopped.
- A photo the check already **stopped before Send** (rejected or quarantined, both identical) is
  passed over as today. It stays in the sender's outbox with the refusal card, and the recipient
  never learns of it. Its caption, when it rode on that photo, is not delivered (as today).
- The pair-block rule is unchanged. `sendStagedImages` refuses in a blocked pair
  (`assertThreadNotBlocked`), and the settle still drops held photos when the pair is blocked.
  A photo message sent **before** a block stays in the history like a text message, and its
  state keeps updating (spec 2.6: history is kept).
- The 7-day "undelivered" purge is no longer scheduled at Send, because a sent photo is always a
  message now. The internal function stays for jobs that are already scheduled; those are no-ops
  once the photo has a message.

### D2. One read gate: nothing is served to a recipient before approval

The thread read model (`messageAttachmentViews`, used by `getThreadMessages` and
`listThreadMessages`, so DMs, exchange threads and circle threads alike) decides per viewer.

A photo is **servable** only when all of these hold (`isServable`):

- its status is `approved` or `blurred`;
- its CSAM hash check has passed (`hashCheckedAt`);
- its blob was swapped to the metadata-free re-encode (`reencodedAt`).

`revealMessageImage` and attachment reports use the same predicate. `unscored` is **not**
servable any more.

| Row state                                                                     | Recipient sees                                                                       | Sender sees                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pending` / `unscored`, or a servable status whose gates have not all passed  | `pending`: blurhash once hash-cleared and re-encoded, else neutral; "Pending review" | `pending`: own image once its hash check passed (as the outbox did), else blurhash; "Checking photo…"                                     |
| `approved` / `blurred`, servable                                              | as today (blur bands, non-mutual blur, reveal, open-report blur)                     | as today (own photo, unblurred)                                                                                                           |
| `rejected` / `quarantined`                                                    | `removed`: "Removed by moderation", no image, no blurhash, no caption                | `rejected`: the refusal card ("This photo was removed: our automated check flagged it", Ask for a review, review state), own caption kept |
| `hiddenFromSender` (quarantined or rejected at the 30-day point), row missing | `removed`, no caption                                                                | `removed`, own caption kept                                                                                                               |
| `removed` by a moderator (unchecked-queue reject, D5)                         | `removed`, no caption                                                                | `removed`, own caption kept                                                                                                               |
| `removed`, `account_deleted`                                                  | `removed` + `unavailable` + blurhash (as today)                                      | n/a                                                                                                                                       |

- **No URL** (`url`/`thumbUrl`) for a recipient in any state but servable. The contract allows a
  URL on `pending` only for the uploader's own photo.
- **No caption of a stopped photo** for a recipient (`isCaptionWithheld`, added 2026-10-20 after
  review): when the photo carrying the caption is rejected, quarantined, removed by a moderator,
  hidden at the 30-day point or gone, the recipient's message has an empty body. Rejected and
  quarantined alike. A caption is shown while the photo is pending (it is text, like a text
  message), and disappears in place when the check stops the photo. The sender keeps their own
  caption under the refusal card: it is their own text, and hiding it would only confuse them.
  A deleted sender's photo ("no longer available") keeps its caption like their text messages;
  account deletion marks a rejected photo `hiddenFromSender`, so it stays "Removed by
  moderation" with its caption withheld, exactly like a quarantined one (left whole).
- A report removal tombstones the whole message ("Message removed") as before.
- **Other read paths:**
  - Inbox snippets (`threads.lastMessage`) carry no URL. The stored summary holds the caption as
    its body; `getMyInbox` blanks it for a reader other than the sender once the photo is stopped
    (`isCaptionWithheld`), so the snippet falls back to "… sent a photo".
  - Notification and push previews carry no URL and no caption. A photo is described by its kind
    ("… sent a photo"), unchanged.
  - Report evidence snapshots hold attachment ids and the caption. The reporter is never served
    a URL or the snapshot, and `admin/getReport` is admin-only (the admin view keeps the caption).
  - Circle threads use the same read model and inbox path.

### D3. No tip-off (CSAM quarantine): unchanged guarantees

- The recipient sees **the same** `removed` state for rejected and quarantined photos.
- The recipient loses the caption of both alike.
- The sender sees **the same** refusal card, the same `message_image_rejected` notice, the same
  "Ask for a review" with the randomised "upheld" flip for quarantine, and the same disappearance
  at the 30-day point.
- **The 30-day point:**
  - A rejected photo whose message exists now keeps its row (the message references it). Its
    blobs and reveals are deleted and it is marked `hiddenFromSender`, exactly as a quarantined
    one is hidden, so both then read `removed` for both sides.
  - A rejected photo without a message is deleted as before.
- A quarantined row is never shown to an admin (the unchecked queue skips it: it is never
  `unscored`).

### D4. Blurhash from an unreviewed image: acceptable, after the hash check

- The blurhash is produced only server-side, by the pipeline's re-encode of the metadata-stripped
  image (`reencodeImage`). The client never sends one, and strict browsers scramble canvases.
- It is a 4×3-component DCT. It encodes a handful of average colours and no shapes, so nothing
  in an image can be recognised from it.
- **Showing it to the recipient before the classifier decides is acceptable.** One extra rule
  applies: it is shown only once the CSAM hash check has passed (`hashCheckedAt`). No derivative
  of a hash-matched image ever reaches a third party, and a quarantined photo never had one shown.
- Until a blurhash exists, the tile is a neutral placeholder with the same "Pending review" label.
- A rejected, quarantined or moderator-removed photo never shows its blurhash.
- **Account deletion** keeps the blurhash only for a photo that was servable. Otherwise it is
  cleared.

### D5. "Unscored" chat photos go to the admin queue

- `admin/listUncheckedPhotos` lists message photos (`source: "message"`) that are `unscored` and
  **sent** (have a message). They are listed oldest first, with the same per-source cap, labelled
  "Message photo", with the uploader and no conversation, thread or recipient.
- The URL is given only once the photo is hash-cleared and re-encoded.
- `pending` message photos are **not** listed. They are in flight for seconds, and the stalled
  sweep turns a stuck one `unscored`. This keeps admins from browsing private photos during
  normal operation.
- **This changes the earlier rule** "unscored images are not held for an admin" (old spec 2.2).
  Privacy page and user docs say so.
- **Admin actions:**
  - `admin/recheckPhoto({source: "message"})`: back to `pending`, enqueued on the moderation
    Workpool. The verdict lands through the store as usual.
  - `admin/decideUncheckedPhoto({source: "message"})`:
    - **approve**: `approved` + `moderatedBy`. It needs the hash check passed and the re-encode
      done; otherwise "Check again" first. Audit `photo_manually_approved`.
    - **reject**: a moderator removal. Status `removed`, blobs deleted unless held as evidence,
      reveals deleted, the message and caption kept. The uploader gets `content_removed`
      (`restricted: "photo"`, `ground: "other"`, `automated: "false"`, redress). Audit
      `photo_manually_rejected`. Both sides then see "Removed by moderation".

### D6. Notifications

- Notifications are unchanged in code. `MessagePosted` now fires at Send, so a photo notifies like
  a text message (presence-suppressed, muted threads excluded).
- The copy and push body is "{name} sent a photo". It never carries the image or the caption.

### D7. Realtime

The thread queries read the attachment row, so a verdict, a hash-check clear, an admin decision
or a removal re-renders the message in place through Convex reactivity. The message's position
never moves.

### D8. Transition at deploy

- Photos that were sent but are still held (`sendRequestedAt` set, no message) at deploy are
  appended by the new settle at their next state change (verdict, hash-check clear).
- The ones with no further event (the stuck "unscored before re-encode" case, and the photos
  queued behind it) need a one-off run.
- `conversation/backfillHeldPhotos` (internal mutation, **`dryRun` defaults to true**, paginated
  by cursor) finds held batches and settles each. Every non-stopped photo is appended as a
  message at the run's time (its true send time can't be backdated through the domain clock).
  The dry run reports counts only.
- **Not run by this work**: the operator runs it once after deploy.
- Already-delivered `unscored` photos (delivered blurred as "Not checked" before this change) now
  read as "Pending review" for the recipient and appear in the admin queue. That is intended.

## UI

- The existing `MessagePhotos` tile gains:
  - **pending**: own image with a "Checking photo…" badge; else blurhash or neutral with a
    "Pending review" (recipient) or "Checking photo…" (sender) pill, no Show, no Report;
  - **rejected** (own only): the outbox's refusal card, rendered below the gallery and out of the
    grid.
- `removed` reads "Removed by moderation".
- **Sender copy (2026-10-20, after review)**: since a sent photo is now a message, the refusal card
  says the photo was **removed**, not "wasn't sent": "This photo was removed: our automated check
  flagged it." (nl "Deze foto is verwijderd: onze automatische controle heeft hem afgekeurd."),
  and "This photo was removed: it couldn't be read." for an unreadable one. The same text for
  rejected and quarantined, and for a photo stopped before Send (still in the outbox). The
  `message_image_rejected` notice follows: "Photo removed" / "…so it was removed", category
  "Automatically removed photos". The moderator variant (`content_removed`) already says
  "removed".
- A recipient can report the image message (its caption) but not a photo that is not servable.
- The outbox now holds only photos stopped before Send.
- Locale strings for en/nl/source, What's new, the user docs messages page, and the privacy
  page's messaging items.

## Stack

1. `docs`: this spec, plus pointers in the old spec.
2. `feat(conversation)`: append at send, the read gate, contracts, backend tests, and the
   backfill with dryRun. The web build compiles against the new contract, but the new states
   render only with PR 4. Merge as a stack.
3. `feat(admin)`: chat photos in the unchecked queue (backend, admin console source label, tests).
4. `feat(web)`: the pending and refusal states in the thread, strings, docs, What's new, privacy
   text, and screenshots.
