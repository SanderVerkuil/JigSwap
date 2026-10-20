# Messaging attachments (image / GIF / location), reporting and blocking — design spec

Status: DESIGN (no code). Date: 2026-10-18. Shepherd: Project Shepherd.
Consulted (read-only): UX Architect + UI Designer, Backend Architect, Data Privacy Officer (with Security Architect and DSA/legal hats).
Code basis: origin/main + open message-center stack #138 → #139 → #140 (worktree `.claude/worktrees/msg-attach`).
Not legal advice: items marked **[LAWYER]** need counsel confirmation.

User request: "In the messages, ideally it should also be possible (similar to whatsapp) to add attachments like location/gif/image. Uploaded images would still be scanned, and the other may flag it as inappropriate. Users should also be able to report abuse and/or block users."

---

## R. Resolved decisions (user, 2026-10-18). These supersede anything below that conflicts.

1. **Checker unavailable:** retry for about 10 minutes, then deliver blurred and labelled "not checked". Never approve silently.
   **Superseded 2026-10-20** (`2026-10-20-chat-photo-immediate-delivery.md`): an unscored photo is never served to the recipient; it stays "Pending review" and goes to the admin "Unchecked photos" queue.
2. **Non-mutual sender:** their images arrive blurred (tap to show). Yes.
3. **Photos:** up to 4 per send. Each is its own message; the thread groups them into a gallery.
4. **GIFs:** out of v1 (PR 15 dropped).
5. **Location:**
   - a pin you place is sent exactly;
   - "use my current location" is snapped to an approximate ~1 km grid;
   - exact current location is never offered to non-mutual followers.
6. **Map tiles:** MapTiler, rendered server-side once at send time, with the preview stored in Convex storage.
   - Env var `MAPTILER_API_KEY`. When it is unset, the location feature is inert: the composer hides "Location", and the mutation refuses with `LocationUnavailable`.
   - MapTiler is listed on the privacy page.
   - The sender's interactive picker uses MapTiler tiles via the same key, delivered to the client through a member-gated query. It is restricted by domain in the MapTiler dashboard.
7. **Block and exchanges:** pending proposals are cancelled. Accepted trades and loans can still finish (confirm, cancel, dispute), but the chat closes.
8. **Unblock:** does not restore follows, and the confirmation says so.
9. **Account deletion:**
   - text stays, with the author shown as "deleted member";
   - photo blobs are removed, but a stored **blurhash** stays as the placeholder;
   - the blurhash is reused from the urgent-fixes server-side blurhash helper (stacked on #146), not built twice. It is computed in the moderation pass and stored on the attachment row.
10. **Auto-rejected photos:** admins see one only after the sender requests a review.
11. **CSAM hash matching (Offlimits / EOKM HashCheckService) is in scope now**, not later.
    - It is an adapter behind config (`CSAM_HASHCHECK_PROVIDER=offlimits|none`, plus credentials) and is inert without them.
    - It runs in the shared moderation pass before classification.
    - On a hit: quarantine (no admin view), never deliver, record only the hash, the match and timestamps, and raise an escalation record for the operator to report to Offlimits Meldpunt or police.
12. **Screening provider:** use an EU provider to minimise legal overhead.
    - Message images go through the same `PhotoModerationPort`, which the urgent-fixes agent extends with a Sightengine (Paris) adapter behind `MODERATION_PROVIDER` (stacked on #146). No separate classifier.
    - The DSA notice / statement-of-reasons flows stay as designed, scaled to a micro/small platform.
    - **What the Art. 19 exemption removes**, so we do NOT build these as obligations:
      - Art. 20 internal complaint-handling system: replaced by a voluntary "ask for a review";
      - Art. 21 out-of-court dispute bodies;
      - Art. 22 trusted flaggers;
      - Art. 23 statutory misuse measures: replaced by a light voluntary reporter-abuse rule;
      - Art. 24(1)/(2)/(5) reporting, user numbers and submissions to the statement-of-reasons database;
      - Art. 25 dark-pattern rules (still good practice);
      - Art. 26–28 ads, recommender and minors obligations.
        Art. 15 transparency reports are also exempt for micro/small enterprises.
    - **What remains:**
      - Art. 11/12 points of contact;
      - Art. 14 terms describing moderation and automated tools;
      - Art. 16 notice mechanism;
      - Art. 17 statement of reasons;
      - Art. 18 notifying authorities of threats to life or safety;
      - Art. 24(3), user numbers on request.

**PR mapping update:** PR 0 = #146 (HF router + unscored), and its follow-ups (Sightengine adapter, blurhash) come from the urgent-fixes agent. PR 1 = #145 (text-only postMessage). PR 14 (CSAM) moves into the image track, right after the pipeline extraction (8). PR 15 (GIF) is dropped.

**Milestone A** (no screening dependency), one linear gh stack on `main`:

1. A1 rate limiter
2. A2 blocks core + messaging gates (including the ConnectionPolicy revocation)
3. A3 block visibility gates
4. A4 reports backend + admin queries
5. A5 web: block UI + "Privacy & safety" settings page
6. A6 web: report flows + admin Reports tab

The messaging gates touch `conversation/postMessage.ts`, which #140 and #145 also modify, so each gate is a one-line call to `assertPairNotBlocked` to keep conflicts small. The PR bodies say so.

---

## 0. Urgent findings (act before / independent of this feature)

1. **Photo screening is most likely silently OFF in every deployment.**
   `packages/backend/convex/library/adapters/photoModeration.ts` posts to `https://api-inference.huggingface.co/models/Falconsai/nsfw_image_detection`. That host no longer resolves (verified locally: `getent hosts api-inference.huggingface.co` → nothing; `router.huggingface.co/hf-inference/models/Falconsai/nsfw_image_detection` → 401 without token). HF retired the old serverless domain in favour of Inference Providers. The adapter **fails open on every error**, so all copy and completion photos are being auto-approved, and nothing in the stored row can distinguish "screened clean" from "never screened" (both are `approved`, score null).
   → PR 0: point at the router URL, verify with a real token that the `hf-inference` provider still serves the model, add an `unscored` outcome, and alert on a high `fail_open` rate in Axiom. Confirm the current fail_open rate in Axiom.
2. **Tenor API is gone** (keys stopped 13 Jan 2026, shut down 30 Jun 2026). Do not design around it.
3. **Latent hole: `postMessage` accepts `kind: "image"` with an arbitrary `body`.** The domain says the body of an image message is a "storage reference". Nothing checks ownership or moderation, and `toThreadMessageView` returns the body verbatim. The web client never sends it (composer is text-only), so expected prod rows = 0, but the public mutation accepts it today.
4. **GDPR gap:** `apps/web/src/routes/_public/privacy.tsx` names Clerk, Convex and Vercel only. Hugging Face (images) and Axiom (logs) are processors already. They must be listed, with DPAs, before DM images ship.
5. **Account deletion does not cascade:** the Clerk `user.deleted` webhook → `users.deleteUser` deletes only the `users` row. Messages, photos, follows and so on dangle. Attachments make this worse (orphaned blobs).
6. **The ConnectionPolicy can never be revoked:** `conversation/adapters/connectionPolicy.ts` grants messaging for "any existing pair thread", and exchange threads open on any proposal. So proposing an exchange to a stranger unlocks DMs with them permanently. Blocking must short-circuit this policy before every other clause.

---

## 1. Inventory: what exists today

| Area              | What exists                                                                                                                                                                                                                                                                              | Files                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threads           | `threads` (dm \| exchange, pair participants, `participantsKey`, `readReceipts`, `lastMessageAt`), `threadParticipants` projection                                                                                                                                                       | `convex/schema.ts`, `conversation/*`                                                                                                                        |
| Messages          | `threadMessages` {kind text\|image\|system, body, sentAt, authorId?, copyId? (#140)}. The repository loads the full history on every post (`.collect()`) but only ever inserts new rows.                                                                                                 | `conversation/postMessage.ts`, `conversation/adapters/convexThreadRepository.ts`, domain `conversation/domain/{thread,message}.ts` (body ≤ 4000, non-empty) |
| Copy attachment   | `isAttachable`: copy owned by a participant AND `canViewCopy` for every participant. `CopyNotFound` otherwise.                                                                                                                                                                           | `conversation/postMessage.ts`, `listAttachableCopies.ts`, `copyCard.ts`                                                                                     |
| Reads             | `getThreadMessages` (participants only; copy card / `copyUnavailable`), `getMyInbox`, `getUnreadTotal`                                                                                                                                                                                   | `conversation/*`                                                                                                                                            |
| Who may message   | ConnectionPolicy: mutual follow OR existing pair thread OR shared circle                                                                                                                                                                                                                 | `conversation/adapters/connectionPolicy.ts`, `canMessage.ts`, `openDmThread.ts`                                                                             |
| Notifications     | `MessagePosted` → `message_received` (presence-suppressed, no body preview)                                                                                                                                                                                                              | `notifications/subscriber.ts`, `presenceGate.ts`                                                                                                            |
| Upload            | `generateUploadUrl` (member-gated). Client compressorjs (q 0.6, max 1024², strips EXIF). Storage ids are not bound to an uploader.                                                                                                                                                       | `convex/puzzles.ts`, web `solving/completion-follow-up-provider.tsx`                                                                                        |
| Screening         | Row inserted `pending` → Node action: jimp re-encode (strips EXIF/GPS; PNG when the image has alpha, else JPEG q90), swap blob, delete original, HF NSFW classify (threshold 0.85), first verdict wins, stamp `photo_auto_rejected`. **Fail-open.** Cloned once already for completions. | `library/moderatePhoto.ts`, `library/moderationStore.ts`, `library/adapters/photoModeration.ts`, `solving/moderateCompletionPhoto.ts`                       |
| Moderation admin  | `moderationActions` audit trail; rejected-photo queue; restore / confirm removal (notifies the uploader with `photo_removed`, moderator never exposed)                                                                                                                                   | `admin/{listRejectedPhotos,restorePhoto,confirmPhotoRemoval,stampModerationAction}.ts`, web `_dashboard/admin/moderation.tsx`                               |
| Reporting         | **None.** Closest: public contact form (`contactMessages`), and `exchange/raiseDispute.ts` (sets status "disputed"; no admin handling)                                                                                                                                                   |                                                                                                                                                             |
| Blocking          | **None**                                                                                                                                                                                                                                                                                 |                                                                                                                                                             |
| Infrastructure    | No rate limiter (`convex.config.ts` mounts only `@convex-dev/presence`), no `crons.ts`                                                                                                                                                                                                   |                                                                                                                                                             |
| Authz chokepoints | `social/privacy.ts` (`projectMemberIdentity`, `canSeeProfileContent`, `areMutualFollowers`), `library/canViewCopy.ts` (`canViewCopy`, `canViewCopyWithContext`), `identity/isAdmin.ts` (JWT claim)                                                                                       |                                                                                                                                                             |

---

## 2. Decisions (recommended defaults)

### 2.1 Attachment model (backend)

- **Side table `messageAttachments`** (discriminated on `kind`) plus `threadMessages.attachmentId?` (immutable ref) and moderator tombstone fields `removedAt?`/`removedReason?`. `threadMessages.kind` gains `gif` and `location`.
  - Why: moderation and map-render state changes over time and must stay out of the history the aggregate loads on every post. It also gives a `by_moderation_status` queue like `completionImages`, and lets an image be staged and screened before the message is sent.
  - The table also gives reports, evidence holds and deletion jobs one id to reference.
- Common fields: `threadAggregateId`, `messageId?` (absent = staged), `uploaderId`, `createdAt`, `updatedAt`, `evidenceHold?`.
  - **image:** `fileId`, `thumbFileId?`, `width`, `height`, `byteSize`, `contentType`, `moderationStatus: pending|approved|unscored|blurred|rejected|removed`, `moderationScore?`, `moderationAttempts`.
  - **gif:** `provider`, `providerId`, `title?`, `rating`, rendition dims (no URLs stored; derived at read time).
  - **location:** `lat`, `lng` (stored already rounded), `precision: approximate|exact`, `label?` (≤ 80), `mapFileId?`, `mapStatus`.
  - Indexes: `by_message`, `by_moderation_status [status, createdAt]`, `by_file` (claim dedupe), `by_uploader_created`.
- **Domain:** `MessageKind = text|image|gif|location|system`. For `text`: non-empty body, no attachment. For media: an `attachmentRef` is required and the body is an optional caption (≤ 1000 characters for media, 4000 for text). Add a pure `SharedLocation` value object (range checks, rounding by precision). `body` stays `v.string()` with `""` allowed, so no migration.
- **One attachment per message row.** The composer may stage up to **4 photos**, sent as 4 consecutive image messages; the thread view groups consecutive image messages from one author within 60 s into a gallery (WhatsApp works this way). One puzzle copy may ride on the caption message (existing `copyId`). GIF and location are exclusive: staging one clears other staged items, after a confirm.
- **Contracts:** add `attachment?: AttachmentView` to `ThreadMessageView`:
  - image: `{status: processing|ready|blurred|rejected|removed, url?, thumbUrl?, w, h}`
  - gif: `{provider, providerId, w, h, title}` (see 2.3)
  - location: `{lat, lng, precision, label?, mapUrl?, openUrl}`
- **Closing the hole (PR 1):** `postMessage` args become `kind: v.literal("text")`. `toThreadMessageView` blanks the body of any image row without an `attachmentId`. Count legacy image rows with a one-off internal query. Media goes only through new, server-verified mutations. The legacy `messages` table is left alone.

### 2.2 Images

- **Client:** `accept="image/jpeg,image/png"` (jimp 1.x has no WebP decoder; on mobile `image/*` with conversion to JPEG in the browser via canvas or compressorjs). Compress with compressorjs to a long edge of 1600 px at q 0.75 (slightly more than completions; chat photos get zoomed). This drops EXIF client-side as data minimisation. Uploads start when a photo is picked; Send is enabled once every upload has finished.
- **Upload claim:** `conversation/generateMessageUploadUrl` (rate-limited) → client uploads → `stageMessageImage({threadId, storageId})`:
  - the caller is a participant and the pair is not blocked either way;
  - `ctx.db.system.get(storageId)` shows size ≤ **5 MB**, an allowed contentType, and creation less than 15 minutes ago;
  - the blob is not already claimed (`by_file`), so the first claimer within the window wins;
  - insert the row as pending, schedule moderation, and schedule `expireStagedAttachment` in 24 h (deletes an unlinked row plus its blobs; no cron needed).
- **Posting:** `postAttachmentMessage({threadId, attachmentId, caption?})` checks uploader = caller, the thread matches, and the attachment is unlinked, then links it.
- **Server pipeline:** generalise the moderation action into `lib/imageModeration/pipeline.ts` (third use, so extract first; a separate PR with no behaviour change), with thin per-table store modules. In one jimp pass:
  1. check the magic bytes against the claimed type;
  2. check the pixel count from the header before decoding (≤ 25 MP; protects against decompression bombs);
  3. re-encode, which strips EXIF/GPS and fixes the content-type;
  4. make a ~320 px JPEG q70 thumbnail;
  5. delete the original;
  6. classify.
     The original upload is never served.
- **Visibility (superseded 2026-10-20, see `2026-10-20-chat-photo-immediate-delivery.md`):** every photo is now a message at send time; the recipient sees a "Pending review" placeholder (server-side blurhash once hash-cleared) until it is approved, and "Removed by moderation" when it is rejected or quarantined. The original rule was: **screen before the recipient sees it.**
  - The sender sees their own image at full colour with a "Checking photo…" badge.
  - The recipient's query hides a message whose image is `pending`: no row, no unread count, no notification. The `MessagePosted` notification fires when the image reaches a deliverable state (the posting use case emits on link; the subscriber defers media messages until approved). Normally this takes seconds.
- **Verdict bands** (threshold env-configurable):
  - score ≥ 0.85 → `rejected`. Never shown to the recipient. The sender sees "This photo wasn't sent: our automated check flagged it" plus "Ask for a review". That text is the DSA Art. 17 statement of reasons and must name automation.
  - 0.5 ≤ score < 0.85 → `blurred`: delivered blurred with "Sensitive content · Show" and a Report button. This band exists because fine-art puzzles (classical nudes, Klimt) will produce false positives on a puzzle site.
  - < 0.5 → `approved`.
  - Images from someone who is not a mutual follower are also delivered blurred-by-default (tap to show) whatever their score. This is the cheap cyberflashing control, since exchange threads let strangers in.
- **Classifier unavailable: fail closed to a delay, then blurred.** Retry 3× with backoff (as built: 4 attempts on the moderation Workpool, about 1, 5 and 25 minutes apart; a check that never completes is stamped `unscored` too, see `docs/deployment/photo-moderation.md`). After that, deliver as `unscored`, rendered like `blurred` ("Not checked · Show"), and log it. Never silently approve. Unscored images are not held for an admin (that would mean admins browsing private DMs). **Superseded 2026-10-20:** unscored chat photos stay "Pending review" for the recipient and are listed (sent ones only, no conversation context) in the admin "Unchecked photos" queue to approve, remove or check again. **Feature-level fail-closed:** if `MODERATION_PROVIDER=none` or the token is unset, `stageMessageImage` refuses and the composer hides "Photo". Copy and completion photos keep failing open, but now record `unscored`, and alerting is added.
- **Positive screen follow-up:**
  - Stamp `moderationActions` kind `message_image_auto_rejected` (no actor).
  - The image enters the admin queue **only if the sender asks for a review**. An admin can restore it (`message_image_restored`).
  - After 3 rejections in 24 h, image sending is rate-limited and the account is flagged for human review. Account sanctions are only ever decided by a human (GDPR Art. 22).
- **CSAM:** the NSFW classifier is **not** a CSAM control; never describe it as one. Recommended, as its own later PR: hash matching via the Dutch Offlimits/EOKM **HashCheckService** (free for European hosts), run in the same pipeline step. On a hit or a credible report: quarantine the blob with no admin able to view it, never forward it, report to the Offlimits Meldpunt or police (DSA Art. 18), and keep only the hash plus metadata **[LAWYER: Dutch possession and preservation rules]**. Publish a DSA Art. 11/12 point of contact.
- **Serving:** `ctx.storage.getUrl` URLs are stable bearer links. The read model returns URLs only to participants and only for deliverable states. A removed or rejected blob is deleted (after its retention window), which kills the URL. Verify whether `getUrl` exposes the storage id; the 15-minute claim window covers reuse either way.

### 2.3 GIFs: recommendation is to defer (not in v1)

- **Tenor:** shut down.
- **GIPHY:**
  - Its terms require the browser to call GIPHY directly and forbid caching, proxying or rewriting media (developers.giphy.com best practices), so the privacy-preserving proxy design is **not allowed** without written approval.
  - "Powered by GIPHY" attribution is required.
  - API access reportedly costs money now; verify pricing.
  - The recipient's IP and user-agent would reach GIPHY (Shutterstock, an independent controller).
- **KLIPY:** free but ad-funded, so a worse privacy profile.
- **Uploaded animated GIFs:** jimp decodes only the first frame, so they would lose their animation through the mandatory re-encode. Supporting them would need ffmpeg or another animation-aware codec that can't run in Convex Node. Not worth it.
- **If GIFs are wanted later:**
  - GIPHY with `rating=g`, searched through a member-gated, rate-limited Convex action (key in env). Searching is GIPHY's terms permitting; else client-side with a key restricted to the domain.
  - Store only `{provider, providerId}`.
  - Render a **tap-to-load placeholder** for the recipient ("GIF from GIPHY · tap to load"), so their IP reaches GIPHY only when they choose.
  - Autoplay only with `prefers-reduced-motion: no-preference`, using the MP4 rendition in a muted, looping `<video>` that pauses off-screen.
  - Name GIPHY in the privacy notice.
  - The Backend Architect's alternative (a Vercel `/api/media/gif/...` allowlisted streaming proxy with CDN caching) is technically better for privacy, but it needs GIPHY's written permission.

### 2.4 Location: one-shot meeting place only

- **No live location, ever.** The UX is "Pick a meeting place": a map picker where device GPS only centres the map (with explicit browser permission), and the user drops or moves the pin. Optionally, search for a public place.
- **Precision:**
  - A pin the user placed deliberately is sent at 5 decimals (it's a chosen public spot).
  - "Use my current location" without moving the pin is snapped to an approximate ~1 km grid by default. Exact needs a per-send toggle with a warning, and that toggle is hidden for non-mutual followers.
  - Store only the shared coordinates plus the precision class. No location history.
- **Consent copy** (en): "Share this spot with {name} only. They'll see it on a map until you delete the message. Pick a public meet-up place rather than your home address." (nl): "Deel deze plek alleen met {name}. Diegene ziet hem op een kaart tot je het bericht verwijdert. Kies liever een openbare ontmoetingsplek dan je huisadres."
- **Maps, no third party for the recipient:**
  - The **preview image is rendered once at send time** by a Node action: about 4 tiles at z15, composed into a 600×300 PNG with a pin and attribution, stored as `mapFileId` in Convex storage. Recipients load it from Convex, so no map vendor sees their IP. On failure → `mapStatus=failed` → a text card with a link.
  - **Tile source:** do not use `tile.openstreetmap.org` (its usage policy discourages app use and proxies). v1: a commercial EU/CH provider (MapTiler, Swiss; or Stadia), key in env, listed as a processor. The sender's interactive picker also loads those tiles client-side (the sender's own choice, disclosed in the consent). Later/alternative: a self-hosted Protomaps PMTiles extract (NL/BE/DE) on EU object storage, rendered with MapLibre, with no third party at all. Keep the tile URL configurable.
  - "Open in maps" is a plain link to `openstreetmap.org/?mlat&mlon` (geo: on Android), loaded only when tapped.
  - Attribution "© OpenStreetMap contributors" (plus provider) appears on the preview.

### 2.5 Reporting and flagging (DSA notice-and-action)

- **Entry points:**
  - "Report message" or "Report photo" on the other person's messages: desktop hover/focus overflow; mobile long-press sheet plus a non-gesture path (WCAG 2.5.1); and in the lightbox.
  - "Report {name}" in the thread header overflow (make the existing mobile-only overflow menu in `thread-quick-links.tsx` show at every width), on the profile next to Follow/Message (`profile-body.tsx`), and on the exchange page (separate from "Raise dispute": disputes are about the trade, reports about behaviour).
- **Dialog** (Dialog on desktop / Sheet on mobile):
  - Reason radio: Spam or scam · Harassment or hate · Sexual or inappropriate content · Fake trade or no-show · Illegal content · Something else.
  - Optional details (≤ 1000 characters).
  - "Also block {name}" checkbox, pre-checked for harassment and sexual content.
  - The reported context is shown read-only.
  - For "Illegal content": also a good-faith statement checkbox, plus the reporter's name and email pre-filled from the account, as DSA Art. 16(2) requires (omitted for child sexual abuse).
  - After submitting, a confirmation screen: "{name} won't know who reported them".
- **Filing — `reports` table:**
  - Fields: `reporterId`, `targetKind: user|message|attachment|copy|photo|exchange`, `targetId`, `reportedUserId`, `reason`, `details?`, `evidence` {snapshot of the target message plus up to 10 preceding messages in the thread (body, author, sentAt, attachmentId), attachmentIds}, `status: open|actioned|dismissed`, `decision?`, `statementOfReasons?`, `decidedBy?`, `decidedAt?`, `createdAt`.
  - Indexes: `by_status_created`, `by_target`, `by_reporter_target` (dedupe), `by_reporter_created`, `by_reported_user`.
  - `reports/fileReport` is member-gated. The reporter must be able to see the target (thread participant, `canViewCopy`, exchange party, a visible profile). One open report per reporter and target (a repeat returns the existing one). Rate limit 10 per day.
  - Filing sets `evidenceHold` on the referenced attachments. The snapshot is taken at filing time, so the sender can't destroy evidence later.
  - Reports never remove content automatically. The reporter's own view blurs the reported image immediately.
- **Admin:**
  - New tab "Reports" in `_dashboard/admin/moderation.tsx`.
  - `admin/listReports` (paginated by status), `admin/getReport` (evidence plus short-lived image URLs), `admin/decideReport({decision: dismissed|content_removed|warned, statementOfReasons})`. "Content removed" sets the attachment to `removed` and deletes its blobs, or sets `threadMessages.removedAt` for text; both sides then see the "Message removed" placeholder.
  - `admin/restoreMessageImage` handles appeals of auto-rejection.
  - Account suspension is out of scope for v1. Repeat offenders are handled manually through Clerk ban.
  - New `moderationActions` kinds: `message_image_auto_rejected`, `message_image_restored`, `report_dismissed`, `report_content_removed`. Blocks are not audited (they're the user's private data).
- **Notifications:**
  - `report_decided` goes to the reporter. DSA Art. 16(5) requires telling the notifier the decision, so this is v1, not v2.
  - `content_removed` goes to the author and carries the Art. 17 statement of reasons: what, the ground (terms or law), facts, whether automated, and redress ("reply to request a review" or a contact address).
  - The actor is never exposed. No "report received" notification; the confirmation screen covers it.
  - The enum fan-out (memory: enum-literal sync points) touches: `schema.ts`, domain `notification-type.ts`, contracts `notifications/views.ts`, `notifications/{copy,viewRules,preferenceValidators}.ts`, web `notification-meta.ts` / `notification-sentence.tsx`, and the en/nl/source locale files.
- **DSA scope (summary):**
  - JigSwap is likely a micro/small online platform. Art. 19 exempts it from Arts. 20–28 (internal complaint system, trusted flaggers, Art. 23 misuse measures, statement-of-reasons database submissions) except Art. 24(3).
  - **Still applicable:** Arts. 11–12 (points of contact), 14 (terms must describe moderation including automated tools), 16 (notice mechanism), 17 (statement of reasons), 18 (notify authorities of threats to life or safety).
  - Private DMs aren't "dissemination to the public" (recital 14), but they are hosted, so Arts. 16–18 arguably still apply.
  - **Recommendation:** one pipeline for DMs and public content; voluntarily offer a lightweight "ask for a human review" (6 months); a light misuse policy (after a warning, deprioritise reporters whose notices are repeatedly manifestly unfounded).
  - Update the Terms (Art. 14) to describe automated screening, reporting and blocking. **[LAWYER]** Confirm micro/small status and whether a free hobby service is an "information society service".

### 2.6 Blocking

**Semantics** (silent; works both ways; reversible):

- The blocked member gets no notification. When they try to act, they see the same generic text as other "can't do this" states ("You can't reply to this conversation" / "You can't message this member"), so a block can't be told apart from a lost connection or a deleted account.
- Messages that will never be delivered are not stored.
- In both directions: no new DM, no message or attachment in any existing thread (DM or exchange), no follow or follow request, no exchange proposal or acceptance, no household invite, no circle add.
- The blocked member sees the blocker as anonymous/not found (`projectMemberIdentity`). The blocker drops out of their search, suggestions, followers-you-know and activity feed, and the blocker's copies become unviewable for them. Mirrored for the blocker (they don't see the blocked member in lists), but the blocker keeps a minimal profile stub so they can unblock.
- **History is kept** for both: the thread stays in the inbox, read-only.
  - Blocker: banner "You blocked {name}. [Unblock]" in the composer's slot, with the thread collapsed by default (evidence).
  - Blocked member: neutral "You can't reply to this conversation".
- Blocking never deletes anything. "Block and report" snapshots the evidence.
- **Side effects of `blockMember`:**
  - Delete follow edges both ways, through the existing unfollow use case so events stay consistent. Unblocking does **not** restore them, and the copy says so.
  - Pending follow requests both ways → declined.
  - Pending exchange **proposals** between the pair → cancelled with a system message.
  - **Accepted** exchanges and loans continue: the status actions (confirm, cancel, dispute) still work, chat is closed, and the UI suggests a dispute or contacting support.
  - Circles and households are unchanged (they can't be cleanly separated), but they no longer grant messaging or copy visibility between the pair. The block confirmation says this and suggests leaving or removing the member.
- **Settings:** a new Clerk `UserButton.UserProfilePage` "Privacy & safety" next to Preferences and Notifications (`dashboard-layout/shell-user-button.tsx`), with a "Blocked members" list (avatar, name, "Blocked {date}", Unblock with confirm). Also unblock from the thread banner. Cap of 1000 blocks per member; rate limit 30 block/unblock actions per day.
- **Block-evasion signals** (proportionate; no device fingerprinting): an account under 7 days old proposing an exchange to, or DMing, someone who recently blocked a young account; the same email-domain or plus-address variant. These only feed the admin view; nothing is automated.
- **Data:** `blocks {blockerId, blockedId, createdAt}`, indexes `by_blocker`, `by_blocked`, `by_pair`. Helpers in `social/blocks.ts`: `isBlockedEitherWay(ctx, a, b)` (two `by_pair` lookups) and `blockedEitherWaySet(ctx, viewer)` (for filtering lists). A block row is deleted on unblock (keep at most an anonymous 90-day counter for abuse signals). The block list is the blocker's personal data and is never exposed.

**Exact gates that change** (all server-side; blocked means either direction):

| Gate                                                                                                                                  | Change                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation/adapters/connectionPolicy.ts`                                                                                           | Return false when blocked, before the mutual-follow, pair-thread and circle clauses                                                                                             |
| `conversation/postMessage.ts`, new `postAttachmentMessage.ts`, `stageMessageImage.ts`, `generateMessageUploadUrl`                     | Refuse in a blocked pair (DM and exchange threads), generic error                                                                                                               |
| `conversation/openDmThread.ts`, `startCopyConversation.ts`                                                                            | Covered by the policy, plus an explicit check (idempotent-reopen path)                                                                                                          |
| `conversation/canMessage.ts`                                                                                                          | false                                                                                                                                                                           |
| `conversation/getMyInbox.ts`, `getThreadMessages.ts`                                                                                  | Keep the thread; add `blocked: "byMe" \| "byThem"` (byThem rendered as the generic "can't reply")                                                                               |
| `conversation/listAttachableCopies.ts`                                                                                                | Empty                                                                                                                                                                           |
| `social/followMember.ts`, `approveFollowRequest.ts`, `acceptQrFollow.ts`, `establishMutualFollow.ts`, `redeemInvite.ts`               | Refuse (`redeemInvite` still signs the user up, without the follow)                                                                                                             |
| `social/getPublicProfile.ts`, `getProfile.ts`, `getPublicMemberTeaser.ts`, `getFollowRelation.ts`                                     | Not found for the blocked side; minimal stub for the blocker                                                                                                                    |
| `social/listFollowers.ts`, `listFollowees.ts`, `followersYouKnow.ts`, `knownFollowers.ts`, `listIncomingFollowRequests.ts`            | Filter with `blockedEitherWaySet`                                                                                                                                               |
| `social/getActivityFeed.ts`                                                                                                           | Drop blocked actors                                                                                                                                                             |
| `social/listProfileCopies.ts`, `listProfileCompletions.ts`, `featuredShelf.ts`                                                        | Empty for the blocked side                                                                                                                                                      |
| `social/listPuzzleComments.ts`, `listPuzzleReviews.ts`, `listPublicPuzzleReviews.ts` (when signed in), `library/listPhotoComments.ts` | Filter authors                                                                                                                                                                  |
| `social/privacy.ts` `projectMemberIdentity`                                                                                           | Blocked → anonymous branch (this alone covers custody timelines and copy histories)                                                                                             |
| `library/canViewCopy.ts` (`canViewCopy` + `canViewCopyWithContext` + `buildCopyViewContext`)                                          | Add `blockedIds` to the context. Check after owner/holder (the holder keeps access: they physically have the copy) and **before** the household, public+open and circle clauses |
| `identity/searchUsers.ts`, `search/globalSearch.ts`, `identity/listRecentPublicMembers.ts`                                            | Exclude blocked members and their copies                                                                                                                                        |
| `exchange/propose.ts`, `exchange/accept.ts`                                                                                           | Refuse (status transitions on already-accepted exchanges stay allowed)                                                                                                          |
| `household/inviteToHousehold.ts`, `household/acceptHouseholdInvite.ts`, `social/acceptHouseholdLinkInvite.ts`                         | Refuse                                                                                                                                                                          |
| `sharing/addMember.ts`                                                                                                                | Refuse when the caller or the added member is blocked either way with the other                                                                                                 |
| `notifications/subscriber.ts` (`handleDomainEvent`)                                                                                   | Drop any command whose actor is blocked either way with the recipient (one place covers every event type)                                                                       |
| `reports/fileReport`                                                                                                                  | Still allowed after a block (block-and-report)                                                                                                                                  |

### 2.7 Rate limits

Add `@convex-dev/rate-limiter` (second component), with a shared `lib/rateLimits.ts`. Limits are keyed by member, and each refusal is logged as a wide event. The numbers are starting defaults:

| Action                | Limit            |
| --------------------- | ---------------- |
| Messages              | 30/min           |
| Image stages          | 20/h and 100/day |
| Location sends        | 20/day           |
| Reports               | 10/day           |
| Block/unblock         | 30/day           |
| GIF search (if built) | 60/min           |

### 2.8 Retention and deletion

| Data                        | Retention                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Staged, never-sent uploads  | 24 h (scheduled expiry)                                                                                            |
| Messages and attachments    | Life of the account. Deleted when a moderator removes them, and on account deletion                                |
| Auto-rejected DM image blob | 30 days (admin-only, for appeals), then purged unless `evidenceHold`. Metadata (score, hash, timestamps) 12 months |
| Content removed via report  | Evidence 6 months after the decision, then purged                                                                  |
| Reports                     | 12 months after closing, then the reporter is anonymised. Longer only when escalated to law enforcement            |
| Blocks                      | While active; deleted on unblock                                                                                   |
| CSAM hit                    | Hash only, per law-enforcement instructions [LAWYER]                                                               |
| Logs (Axiom)                | 30 days. Never log message bodies, captions, coordinates, storage ids or report text                               |

- **Account deletion:** extend `users.deleteUser` to schedule `purgeMemberMessagingData`:
  - delete the attachments they authored (blobs, thumbnails, maps) → shown as "removed";
  - delete their blocks both ways;
  - anonymise the reports they filed;
  - keep reports about them until the retention window ends.
  - Text messages: see R.9.
  - The general missing cascade across the rest of the app is a separate, larger ticket.
- **GDPR:**
  - Lawful bases: messaging and attachments are Art. 6(1)(b) (contract); screening, reports and abuse signals are 6(1)(f) (legitimate interest, backed by a written assessment); DSA handling is 6(1)(c) (legal obligation).
  - Run a **light DPIA**: scanning private communications, an AI classifier, location data, possible special-category inferences from images.
  - Access requests: a reported member's export includes reports and decisions about them, with the **reporter's identity withheld** (Art. 15(4) and UAVG Art. 41; DSA Art. 17(3)(b)). A block list is not disclosed to the blocked member **[LAWYER]**.
  - Privacy page: add Hugging Face (US: confirm DPA plus DPF/SCCs, and that the hf-inference provider is HF itself), Axiom, the map tile provider, GIPHY if used, and Offlimits/police as recipients under legal obligation.

---

## 3. UX summary (for the implementing PRs)

- **Composer:** the Puzzle button becomes a `+` (rotates to an X while open; `aria-haspopup="menu"`).
  - Desktop: a Radix DropdownMenu opening upward with Puzzle / Photo / Location (GIF later).
  - Mobile: a short bottom Sheet with a 4-tile grid; a second-level picker replaces the sheet rather than stacking on it.
  - The hidden file input lives in the composer, outside the menu, so iOS keeps the user gesture.
  - Staged chips sit in one horizontally scrollable row (photo thumbnails with a progress ring and Retry). The textarea's `aria-describedby` summarises them ("Attached: 2 photos, Ravensburger 1000").
  - Send is enabled when there is text OR an attachment.
- **Media bubbles** sit next to the bubble, like the copy card (never inside the purple bubble). The caption bubble follows below. Media is `max-w-[min(80%,20rem)]`.
  - **Photos:** aspect ratio reserved from the stored w/h (clamped between 3:4 and 16:9), so the thread doesn't jump on load. Grouped messages use a 2×2 grid. Each photo is a `<button>` that opens a lightbox (focus trap, arrows and swipe, a Report button inside).
  - **Location:** the static map preview, then the label, then an "Open in maps" link.
  - **Placeholders:** one shared component for removed, rejected and unavailable.
  - **States:**

    | State                           | Rendering                                                        |
    | ------------------------------- | ---------------------------------------------------------------- |
    | Sender, pending                 | "Checking photo…"                                                |
    | Sender, rejected                | Dashed frame: "This photo wasn't sent…", plus "Ask for a review" |
    | Recipient, pending              | Nothing (2026-10-20: "Pending review" placeholder)               |
    | Blurred / unscored / non-mutual | Blurred, with "Show" (2026-10-20: unscored is "Pending review")  |
    | Removed                         | "Photo removed" for both sides                                   |
- **a11y:**
  - Long-press is never the only path.
  - Alt text: "Photo from {author}", plus the caption.
  - The thread live region must announce media as "{name} sent a photo / a location", not the empty body.
  - Destructive menu items carry text, not colour alone.
  - Every target below md is at least 44 px.
  - `prefers-reduced-motion` is respected.
- **Copy strings** (en/nl) for the block confirm, report submitted, photo rejected, can't reply and the blocked banner are in the UX consult and are reproduced here:
  - Block confirm: "{name} won't be able to message you, follow you or propose trades. They won't be notified, but they'll see they can't reply. Accepted trades can still be completed. Shared circles or households aren't changed." / "{name} kan je geen berichten meer sturen, je niet volgen en geen ruil voorstellen. Diegene krijgt geen melding, maar ziet wel dat reageren niet meer kan. Geaccepteerde ruilen kunnen nog worden afgerond. Gedeelde kringen of huishoudens veranderen niet."
  - Report submitted: "Thanks — we've received your report. {name} won't know who reported them. We'll review it and let you know what we decided." / "Bedankt, we hebben je melding ontvangen. {name} weet niet wie de melding heeft gedaan. We bekijken het en laten je weten wat we besluiten."
  - Photo rejected: "This photo wasn't sent: our automated check flagged it." / "Deze foto is niet verstuurd: onze automatische controle heeft hem tegengehouden."
  - Can't reply: "You can't reply to this conversation." / "Je kunt niet meer reageren in dit gesprek."
  - Blocked banner: "You blocked {name}." [Unblock] / "Je hebt {name} geblokkeerd." [Deblokkeren]

---

## 4. PR plan (small, each verified with `pnpm format:check` + `turbo run lint type-check test build arch:check --force`)

**Ordering rationale:**

- **Block before attachments, reports right after block, both before any media ships.** Blocking is self-service with no admin dependency, closes the "proposal unlocks DMs forever" hole, and every media gate needs `isBlockedEitherWay`.
- Reporting must exist on the day images ship, so recipients can flag.
- PRs 0 and 1 are independent fixes that can merge now.

| #   | PR                                                                                                                                                                                                                                                                                        | Depends on            | Verification                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **fix(moderation): HF router endpoint + `unscored` outcome + fail-open alert**; privacy page lists Hugging Face and Axiom                                                                                                                                                                 | —                     | `photoModeration` / `completionModeration` tests with fake fetch (router URL, unscored path); manual: real-token classify on a preview deployment; check the Axiom fail_open rate before and after |
| 1   | **fix(conversation): postMessage text-only; blank body of attachment-less image rows**; one-off count of legacy image rows                                                                                                                                                                | —                     | `conversationMutations.test.ts` (image kind rejected), `conversationReads.test.ts` (body blanked)                                                                                                  |
| 2   | **feat(social): blocks core**: table, `social/blocks.ts`, block/unblock/listMyBlocks, side effects (follows, requests, pending proposals), messaging gates (policy, post, open, canMessage, inbox `blocked` flag, attachable copies)                                                      | —                     | New `blocks.test.ts`: either direction refuses DM/post/follow/propose; existing exchange-thread pair blocked; side effects; unblock does not restore follows                                       |
| 3   | **feat(social): block visibility gates**: `projectMemberIdentity`, `canViewCopy`(+Context), profiles, lists, feed, search, comments/reviews, household/circle/exchange-accept refusals, notification filter                                                                               | 2                     | New `blockVisibility.test.ts` (one case per gate in the table), plus a notification-delivery case                                                                                                  |
| 4   | **feat(web): block UI**: thread header and profile menus, AlertDialog, banners, "Privacy & safety" settings page with the blocked list; en/nl                                                                                                                                             | 2 (3 for full effect) | Component tests; manual run on the :3001 dev server (no Playwright Chrome available)                                                                                                               |
| 5   | **feat(platform): rate-limiter component + limits** on postMessage, block                                                                                                                                                                                                                 | — (before 7)          | `rateLimits.test.ts`; convex-test component registration                                                                                                                                           |
| 6   | **feat(moderation): reports backend**: `reports` table, `fileReport` with evidence snapshot and dedupe, admin list/get/decide, moderationActions kinds, `report_decided`/`content_removed` notifications (full enum fan-out), message tombstones                                          | 2                     | New `reports.test.ts` (visibility of the target, dedupe, snapshot immutability, admin gating, decision notifies both sides without exposing the actor); view-rule tests                            |
| 7   | **feat(web): report flows + admin Reports tab**; en/nl                                                                                                                                                                                                                                    | 6                     | Component tests + manual                                                                                                                                                                           |
| 8   | **refactor(moderation): extract the shared image pipeline** (no behaviour change) + magic-byte and pixel-cap guards                                                                                                                                                                       | 0                     | Existing moderation tests green, plus guard unit tests                                                                                                                                             |
| 9   | **feat(conversation): domain media kinds + caption rules + `SharedLocation` VO**                                                                                                                                                                                                          | 1                     | `thread.spec.ts`, `message.spec.ts`, `shared-location.spec.ts`                                                                                                                                     |
| 10  | **feat(conversation): image attachments backend**: `messageAttachments`, upload URL, stage/claim (size, type, freshness, dedupe, block, participant), post, moderation store + thumbnail, verdict bands, non-mutual blur, deferred notification, 24 h expiry, sender appeal → admin queue | 5, 6, 8, 9            | New `messageImageAttachments.test.ts` (claim rules, recipient hidden while pending, rejected never visible, blurred flag, notification only once delivered, expiry)                                |
| 11  | **feat(web): photo composer + bubbles + lightbox + report photo**                                                                                                                                                                                                                         | 7, 10                 | Component tests (state matrix), manual on mobile width                                                                                                                                             |
| 12  | **feat(conversation): location sharing**: picker, consent, precision, server-side static map render, bubble                                                                                                                                                                               | 9, 5                  | VO specs, mutation tests (rounding, range, block), render-action unit test with fake tile fetch                                                                                                    |
| 13  | **feat(privacy): retention + account-deletion purge** for messaging data; privacy-page and Terms update (tile provider, DSA moderation text, point of contact)                                                                                                                            | 10, 6                 | Scheduled-function tests (expiry, purge respects `evidenceHold`)                                                                                                                                   |
| 14  | (optional, later) **CSAM hash-check** (Offlimits HashCheckService) in the pipeline + escalation runbook                                                                                                                                                                                   | 8                     | Fake-API tests; runbook in docs                                                                                                                                                                    |
| 15  | (deferred) **GIFs**, dropped from v1 (R.4)                                                                                                                                                                                                                                                | 9                     | —                                                                                                                                                                                                  |

**Stacks:**

- {2 → 3 → 4} and {6 → 7} are independent of each other once 2 exists.
- {8, 9} can run in parallel.
- 10 is the convergence point.
- Each stack is linear, per the gh-stack convention.

---

The product decisions that were open while this spec was drafted are resolved in section R.
