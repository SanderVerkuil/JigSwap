# Puzzle Definition Change Proposals — Design

**Date:** 2026-07-08
**Status:** Approved

## Problem

Approved puzzle definitions are effectively immutable today. A backend `updatePuzzleDefinition`
mutation exists (submitter-or-admin gated) but nothing in the web app calls it. The community
has no way to correct catalogue mistakes (wrong piece count, missing brand, bad image), and
admins have no edit surface in the console.

## Goals

- Any signed-in member can **propose changes** to any **approved** puzzle definition.
- Admins **approve or reject** proposals from a review queue; approval applies the change.
- Admins can also **edit definitions directly** from the admin console.
- Everything stays audit-logged (durable `domainEvents` log + `moderationActions`) and follows
  the existing hexagonal architecture in `packages/domain/src/catalog`.

## Non-goals

- Per-field partial approval of a proposal (approve/reject is whole-proposal).
- Proposals against pending, rejected, or disabled definitions (pending/rejected stay editable
  by their submitter via the existing update path).
- Auto-rejecting stale proposals; conflicts are surfaced to the admin, who decides.

## Key decisions (from brainstorming)

| Decision            | Choice                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Proposers / targets | Any member, approved definitions only                                                               |
| Proposal shape      | Field-level diff (subset of `PuzzleDefinitionChanges`)                                              |
| Staleness           | Store baseline per changed field; review UI derives "changed since proposed" markers; admin decides |
| Proposer lifecycle  | Full in-place editing of a pending proposal, plus withdraw; outcome notifications                   |
| Notes               | Optional proposer comment; optional admin rejection reason                                          |
| Field scope         | All fields **including image** (storage ref)                                                        |

## Architecture

`PuzzleChangeProposal` is a **second aggregate inside the Catalog bounded context**, next to
`PuzzleDefinition`.

- **Domain layer:** the aggregates are fully independent. The proposal references the
  definition **by identity only** (`PuzzleDefinitionId`); `puzzle-change-proposal.ts` never
  imports `puzzle-definition.ts`.
- **Application layer:** the approve use case **orchestrates both aggregates in one
  transaction** (one Convex mutation): load proposal + definition, `proposal.approve(now)`,
  `definition.update(changes, now)`, save both, publish both event batches. No event
  choreography between the two aggregates — the admin's click means "approve AND apply"
  atomically, and the staleness check only holds if the patch is applied against the exact
  state the admin reviewed.
- **Events remain the cross-context integration:** proposal events go to the durable
  `domainEvents` log in the same transaction; Notifications (and any future subscriber)
  reacts via the existing `dispatch` fan-out. Choreography between contexts, orchestration
  within one.

## Domain model

New aggregate `PuzzleChangeProposal`
(`packages/domain/src/catalog/domain/puzzle-change-proposal.ts`), mirroring the
`PuzzleDefinition` implementation style (private state, static factory, `rehydrate`/`toState`,
`pullEvents`, transition allow-list).

**State**

| Field                                    | Notes                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id: ChangeProposalId`                   | New branded id in `ids.ts`                                                                                                             |
| `puzzleDefinitionId: PuzzleDefinitionId` | Reference by identity                                                                                                                  |
| `proposedBy: SubmitterId`                | Reuses the existing member-identity brand                                                                                              |
| `status: ProposalStatus`                 | `pending → approved \| rejected \| withdrawn` via `ALLOWED_PROPOSAL_TRANSITIONS`                                                       |
| `changes: PuzzleDefinitionChanges`       | Reused verbatim — the exact patch `definition.update()` receives; includes `image`                                                     |
| `baseline`                               | Partial snapshot (same field shape) of only the changed fields, captured at file/edit time; used solely for read-time conflict markers |
| `comment?`                               | Proposer rationale                                                                                                                     |
| `rejectionReason?`                       | Set by `reject()`                                                                                                                      |
| `createdAt`, `updatedAt`, `decidedAt?`   | Dates                                                                                                                                  |

**Methods**

- `static file(props): Result<PuzzleChangeProposal, CatalogError>` — requires at least one
  changed field; runs the same invariant validation the definition runs (non-blank title,
  `PieceCount.create`, `validateBarcodes`) so invalid proposals can't enter the queue.
  Records `ChangeProposalFiled`.
- `edit(changes, baseline, comment, now)` — pending only; replaces changes/baseline/comment in
  place (same validation as `file`). Records `ChangeProposalEdited`.
- `withdraw(now)` — pending only. Records `ChangeProposalWithdrawn`.
- `approve(now)` — pending only. Records `ChangeProposalApproved`.
- `reject(reason, now)` — pending only. Records `ChangeProposalRejected`.

**Events** (`events.ts`): `ChangeProposalFiled`, `ChangeProposalEdited`,
`ChangeProposalWithdrawn`, `ChangeProposalApproved`, `ChangeProposalRejected`. Approve/reject
events carry `puzzleDefinitionId` and `proposedBy` so Notifications needs no extra lookup. Per
existing convention, no actor on events — the acting admin is stamped into `moderationActions`
at the composition root.

**Rules placed in the application layer** (cross-aggregate, like barcode uniqueness):

- Proposals only against definitions with status `approved`.
- One open proposal per (definition, proposer) — repository lookup; members edit their pending
  proposal instead of filing a second.
- Actor ACLs (only the proposer edits/withdraws; only admins decide) in the use case /
  composition root.

`PuzzleDefinition` itself is unchanged — approval calls its existing `update()`.

## Application layer

New out-port `ChangeProposalRepository`
(`application/ports/out/change-proposal.repository.ts`) with
`findById`, `findPendingByDefinitionAndProposer`, `save`; in-memory test double in
`application/testing/`.

Use cases (`application/use-cases/`), each with an in-port under `application/ports/in/`:

- `file-change-proposal` — definition exists & approved; no open proposal by this proposer;
  `PuzzleChangeProposal.file(...)`; save; publish.
- `edit-change-proposal` — load; actor must be proposer; `proposal.edit(...)`; save; publish.
- `withdraw-change-proposal` — load; actor must be proposer; `proposal.withdraw(now)`; save;
  publish.
- `approve-change-proposal` — load proposal + definition; `proposal.approve(now)`;
  `definition.update(proposal.changes, now)`; save both; publish both event batches.
- `reject-change-proposal` — load; `proposal.reject(reason, now)`; save; publish.

## Backend (Convex)

**Schema:** one new table `puzzleChangeProposals` with typed columns (no `v.any()`):
`aggregateId`, `puzzleDefinitionId` (aggregate id string), `proposedBy: v.id("users")`,
`status`, typed `changes` and `baseline` objects mirroring the `updatePuzzleDefinition` arg
shapes, `comment`, `rejectionReason`, `createdAt`, `updatedAt`, `decidedAt`. Indexes:
`by_status`, `by_definition`, `by_proposer_status`.

**Adapter:** `catalog/adapters/convexChangeProposalRepository.ts`, mirroring
`convexPuzzleDefinitionRepository`.

**Composition roots** (`packages/backend/convex/catalog/`):

- Mutations — `proposeDefinitionChange`, `editChangeProposal`, `withdrawChangeProposal`
  (`requireMember` + proposer ACL); `approveChangeProposal`, `rejectChangeProposal`
  (admin-gated, write `moderationActions` rows with new kinds `proposal_approved` /
  `proposal_rejected`).
- Queries — `listPendingChangeProposals` (admin queue, joined with definition title + proposer
  name, derived conflict flags), `listProposalsForDefinition` (admin detail page),
  `listMyChangeProposals` (member's own, all statuses).

**Direct admin edit:** expose the existing `updatePuzzleDefinition` mutation in the admin
console; extend it to write a `definition_edited` moderation action when the actor is an admin
editing someone else's definition (submitter self-edits stay un-audited, as today).

**Notifications:** `events/dispatch.ts` subscribes the Notifications context to
`ChangeProposalApproved` / `ChangeProposalRejected` → in-app notification to the proposer (new
notification types alongside `puzzle_approved` / `puzzle_rejected`), rejection reason included.

## Web UI

**Member-facing:**

- **"Suggest an edit"** on the puzzle detail page (signed-in members, approved definitions).
  Form pre-filled with current values, reusing the submit-flow field components including the
  image picker. Client computes the diff and submits only changed fields + optional comment.
  If the member already has an open proposal, the button becomes "Edit your suggestion" and
  opens it pre-filled.
- **My suggestions** list alongside the existing contributed-puzzles view: status, rejection
  reason, edit + withdraw on pending.
- Outcome notifications link back to the puzzle.

**Admin console:**

- **Proposals queue** tab on `/admin/puzzles`: definition title, proposer, changed-field
  count, filed date, conflict badge when any baseline no longer matches current state.
- **Proposal review:** per-field _current → proposed_ view with "changed since proposed"
  markers (showing the baseline value) on conflicting fields; images side-by-side; proposer
  comment on top. Approve applies immediately; Reject uses the existing AlertDialog pattern
  with an optional reason field.
- **Proposals section** on `/admin/puzzles/$puzzleId` (open + decided).
- **Direct edit** action on the definition detail page, same form, submitting to
  `updatePuzzleDefinition`.
- All admin UI i18n'd EN/NL like the existing console.

## Error handling

- Domain `CatalogError`: `illegalProposalTransition`, `emptyProposal`.
- `CatalogApplicationError`: `proposalNotFound`, `openProposalAlreadyExists`,
  `definitionNotProposable`.
- Actor ACL failures stay `ConvexError("Forbidden")` at the composition root.
- All mapped through the existing `toConvexError`.

## Testing

- **Domain:** `puzzle-change-proposal.spec.ts` colocated — transitions, validation, event
  recording.
- **Application:** use-case specs against in-memory repositories — approve orchestration (both
  aggregates saved, both event batches published), duplicate-open-proposal rule, proposer ACL,
  not-approved rule.
- **Backend:** `.test.ts` at `convex/` root with convex-test — composition-root auth gating,
  `moderationActions` writes, atomic approve mutation end-to-end against the schema.
