# Completion photos: display with pending-review badges

**Date:** 2026-07-28
**Status:** Approved
**Lands on:** `feat/in-progress-solves` (PR #66).

## Problem

Completion photos upload, attach, and moderate — but nothing displays them.
The uploader expects to see their own photos on their completion, with
pending ones labeled "pending review" (copy-gallery precedent:
pending-visible-to-uploader).

## Design (approved, with one user amendment)

### Backend

- `photoUrls` is **REMOVED** (user decision: no deprecated leftovers) and
  replaced by `photoItems: { url: string; pending: boolean }[]` in BOTH
  photo-resolving reads (`listMyCompletions`, `getCompletionHistory`):
  rejected photos excluded (as today), `pending: true` when the sidecar says
  pending, legacy/absent-sidecar and approved → `pending: false`. Null URLs
  (unresolvable storage ids) dropped. The shared `excludeRejectedPhotos`
  helper evolves into (or is replaced by) a `resolvePhotoItems` helper
  returning the new shape — one implementation, both reads.
- Backend tests asserting `photoUrls` are updated to `photoItems`
  (same scenarios: rejected excluded, pending included + flagged, legacy
  included).

### Web (completions page rows)

- Under the notes/review lines in `renderCompletionRow`: when
  `completion.photoItems` is non-empty, a thumbnail strip — 44px
  `rounded-md border bg-muted object-contain` thumbs (matching the row's
  cover-thumb style), each wrapped in the existing Tooltip hover-expand
  pattern (large `object-contain` preview). Not links (no nav target);
  triggers need `relative z-10` to sit above the stretched row link, and a
  focusable element for keyboard (button with aria-label, no-op click or
  same tooltip).
- Pending photos get a "Pending review" indicator: a small overlay `Badge`
  (or corner chip) on the thumb + the same note in the tooltip content.
- Locale ×3: `solving.completions.pendingReview` ("Pending review" /
  nl "Wacht op controle"), plus an aria-label key if needed.

## Testing

Backend: updated filter tests assert the `{url, pending}` shapes (pending
true for pending sidecar; false for legacy/approved; rejected absent).
Web: tsc/lint/meta; visuals via PR preview.

## Out of scope

Photos on the copy page's completion history UI or any friend-facing
surface; a lightbox; admin surfaces.
