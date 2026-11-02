import { existsSync } from "node:fs";
import { EXPORT_SECTIONS, type ExportSection } from "@jigswap/contracts";
import type { GenericValidator } from "convex/values";
import { describe, expect, test } from "vitest";
import { PHASES } from "./conversation/purgeMemberMessagingData";
import schema from "./schema";

// SEC-95: the member-data coverage manifest. Every place the schema can hold a member's data must
// say what account deletion does to it (users.deleteUser, then the phases of
// conversation/purgeMemberMessagingData) and whether the member's data export carries it
// (insights/exportUserDataPage, @jigswap/contracts EXPORT_SECTIONS).
//
// The walker below finds, through objects, arrays, unions, optionals and records:
// - every v.id("users") field (a reference to a member);
// - every v.any() field (opaque: it may hold member ids, e.g. domainEvents.payload);
// - every string field named email/clerkId or ending in Email/ClerkId (a direct identifier);
// - every `side` beside an exchange id (it names a party of that exchange, with no users id).
// A v.string() that holds a users id cannot be seen; such paths are listed by hand with
// `declared`. A new member-linked field without an entry fails here, and so does an entry for a
// field the schema no longer has, a purge phase or export section no entry accounts for, or a
// module a reason cites that no longer exists.
//
// The export column answers for the member the field names: does THEIR export carry the row?

type Phase = (typeof PHASES)[number];

/** What account deletion does to the value. */
type Erasure =
  /** The row, or the value, is removed. */
  | { readonly deleted: string }
  /** The row stays, but no longer points at the member (cleared or handed to someone else). */
  | { readonly anonymised: string }
  /** It stays, for the reason given. */
  | { readonly kept: string };

/** Whether the export of the member the field names carries it. */
type ExportDisposition =
  | { readonly exported: readonly ExportSection[] }
  | { readonly excluded: string };

interface Disposition {
  readonly erasure: Erasure;
  /** The purge phases that act on it. */
  readonly phases?: readonly Phase[];
  readonly export: ExportDisposition;
  /** Only for a path the walker cannot see: what the field holds. */
  readonly declared?: string;
  /** A known open gap, and the finding that owns it. */
  readonly gap?: string;
}

// Shared by every field that records which admin made a moderation decision.
const ADMIN_ATTRIBUTION: Disposition = {
  erasure: {
    kept: "the admin who made a moderation decision, by id only: the decision's attribution, which reads as a deleted member once their account is gone",
  },
  export: {
    excluded:
      "moderation bookkeeping; the admin audit trail (moderationActions) is the record",
  },
};

// A CSAM escalation keeps its uploader on purpose (users.deleteUser tombstones the row while one
// is open). [LAWYER] notes in users.deleteUser.
const CSAM_PRESERVATION: Disposition = {
  erasure: {
    kept: "the uploader of a CSAM hash match and who they were at match time, kept deliberately for the legal preservation and the report to the authorities; while an escalation is open the users row is tombstoned, not deleted",
  },
  export: {
    excluded: "a preservation record, never disclosed to the uploader",
  },
};

const FOLLOW_NOTICE_PHASES = [
  "followsOut",
  "requestsOut",
  "requestsIn",
  "staleNewFollower",
  "staleRequestReceived",
  "staleRequestApproved",
] as const satisfies readonly Phase[];

const TRANSIENT_INVITE =
  "a workflow step (invitation, offer or join request) the member answers or withdraws in the app";

const MANIFEST: Record<string, Disposition> = {
  "users.clerkId": {
    erasure: {
      deleted:
        "users.deleteUser deletes the row; a tombstoned row (open CSAM escalation) keeps it so the escalation's uploader reference resolves",
    },
    export: { excluded: "the sign-in provider's internal account id" },
  },
  "users.email": {
    erasure: {
      deleted:
        "users.deleteUser deletes the row, or clears the address when it tombstones it",
    },
    export: { exported: ["account"] },
  },

  "boxArtUploads.uploaderId": {
    erasure: {
      kept: "box art belongs to the catalogue entry it illustrates; the row names its uploader by id only",
    },
    export: {
      excluded:
        "the art itself is exported as imageUrl on submittedPuzzles and changeProposals; the upload row is moderation bookkeeping",
    },
  },
  "boxArtUploads.moderatedBy": ADMIN_ATTRIBUTION,
  "boxArtUploads.hashCheckWaivedBy": ADMIN_ATTRIBUTION,

  "puzzles.submittedBy": {
    erasure: {
      kept: "a catalogue entry is shared reference data and stays; it names its submitter by id only",
    },
    export: { exported: ["submittedPuzzles"] },
  },

  "ownedPuzzles.ownerId": {
    erasure: {
      deleted:
        "the copies they own now, with memberships, copy reviews, circle shares, copy comments, photos and their own completions on them",
    },
    phases: ["copies"],
    export: { exported: ["copies"] },
  },
  "ownedPuzzles.heldBy": {
    erasure: {
      anonymised:
        "a copy they borrow goes back to its owner: the open loan is closed and heldBy cleared",
    },
    phases: ["loansOpenIn"],
    export: { exported: ["copies", "loansBorrowed"] },
  },

  "ownedPuzzleImages.uploaderId": {
    erasure: {
      deleted:
        "their copy photos, on their own copies and on others', with blobs and the photos' comments; a quarantined photo (CSAM hash match) stays whole",
    },
    phases: ["copies", "copyPhotos"],
    export: { exported: ["copyPhotos"] },
    gap: "SEC-67: library/moderationStore deletes an auto-rejected copy photo 30 days after the rejection only once RETENTION_ENFORCE names copyPhotos; the policy says it is kept so the member can ask for a review, but copy photos have no such request yet (owner decision before enabling)",
  },
  "ownedPuzzleImages.moderatedBy": ADMIN_ATTRIBUTION,
  "ownedPuzzleImages.hashCheckWaivedBy": ADMIN_ATTRIBUTION,

  "collections.userId": {
    erasure: { deleted: "their collections and wishlists, with memberships" },
    phases: ["collections"],
    export: { exported: ["collections"] },
  },

  "completions.userId": {
    erasure: {
      kept: "a solve on a copy another member owns stays in that copy's History without its photos and notes (SEC-69), shown as a deleted member; every other completion is deleted with its photos",
    },
    phases: ["copies", "completions"],
    export: { exported: ["completions"] },
  },
  "completions.copySnapshot.ownerId": {
    erasure: {
      kept: "the solver's own History records whose copy it was, by id only; it reads as a deleted member",
    },
    export: {
      excluded:
        "the solver's completion row carries copyId; whose copy it was is not repeated",
    },
  },

  "completionImages.uploaderId": {
    erasure: {
      deleted:
        "with their completions' photos, blobs included; a quarantined photo stays whole",
    },
    phases: ["copies", "completions"],
    export: { exported: ["completions"] },
  },
  "completionImages.moderatedBy": ADMIN_ATTRIBUTION,
  "completionImages.hashCheckWaivedBy": ADMIN_ATTRIBUTION,

  "puzzleReviews.userId": {
    erasure: {
      kept: "a puzzle review is public catalogue content and stays; the member deletes their own in the app (social/deletePuzzleReview) and the operator tool removes all of them on request (social/removeMemberContent)",
    },
    export: { exported: ["puzzleReviews"] },
  },
  "copyReviews.userId": {
    erasure: {
      kept: "a rating they gave another member's copy stays (ratings of their own copies go with the copies); the member deletes their own in the app (solving/deleteCopyReview) and the operator tool removes all of them on request (social/removeMemberContent)",
    },
    phases: ["copies"],
    export: { exported: ["copyReviews"] },
  },

  "categories.userId": {
    erasure: { deleted: "their personal categories" },
    phases: ["categories"],
    export: { exported: ["categories"] },
  },

  "moderationActions.actorId": ADMIN_ATTRIBUTION,
  "moderationActions.targetMemberId": {
    erasure: {
      kept: "the admin audit trail names the member a role change or report decision was about by id only, never by name or email, and reads 'Deleted member' once the account is gone (SEC-57)",
    },
    export: {
      excluded:
        "the admin audit trail; a report decision against the member reaches them as a notice (admin/decideReport)",
    },
  },
  "moderationActions.targetId": {
    declared:
      "v.string(): the member's users id on role_granted / role_revoked rows, a content id on the rest",
    erasure: {
      kept: "a role change row names its member by users id only (SEC-57); older rows' Clerk ids are rewritten by admin/backfillAuditTargets",
    },
    export: { excluded: "the admin audit trail" },
  },

  "csamEscalations.uploaderId": CSAM_PRESERVATION,
  "csamEscalations.uploaderSnapshot.clerkId": CSAM_PRESERVATION,
  "csamEscalations.uploaderSnapshot.email": CSAM_PRESERVATION,
  "csamEscalations.notes[].actorId": ADMIN_ATTRIBUTION,

  "puzzleChangeProposals.proposedBy": {
    erasure: {
      kept: "a proposed catalogue change is part of the entry's moderation history; it names the proposer by id only",
    },
    export: { exported: ["changeProposals"] },
  },

  "goals.userId": {
    erasure: { deleted: "their goals" },
    phases: ["goals"],
    export: { exported: ["goals"] },
  },

  "exchanges.initiatorId": {
    erasure: {
      kept: "a trade is the other party's history too: it stays, naming them as a deleted member; an open one is cancelled and the other party told",
    },
    phases: ["exchangesOpen"],
    export: { exported: ["exchangesProposed"] },
  },
  "exchanges.recipientId": {
    erasure: {
      kept: "a trade is the other party's history too: it stays, naming them as a deleted member; an open one is cancelled and the other party told",
    },
    phases: ["exchangesOpenIn"],
    export: { exported: ["exchangesReceived"] },
  },
  "tradeContactShares.side": {
    erasure: {
      deleted:
        "their consent to show their email on each of their trades, found through the exchange and its side; the other party's consent on the same trade is theirs and stays",
    },
    phases: ["contactShares", "contactSharesIn"],
    export: { exported: ["exchangesProposed", "exchangesReceived"] },
  },
  "exchanges.offeredPuzzleOwnerId": {
    erasure: {
      kept: "who owned a swap's offered copy at propose time, by id only, on a trade that stays the parties' history; it resolves to no one once the account is gone, and their copy goes with them, so an open trade naming it can no longer settle",
    },
    export: {
      excluded:
        "internal settlement bookkeeping that may name a household mate who is no party: exchangesProposed and exchangesReceived carry the offered copy's id, never its recorded owner",
    },
  },

  "messages.senderId": {
    erasure: {
      deleted:
        "a legacy exchange-chat row conversation/backfill copied into its thread is a duplicate and goes; one never copied is the only copy and stays, counted in the log",
    },
    phases: ["legacyMessagesSent"],
    export: {
      excluded:
        "the legacy chat: a copied row is exported as messagesSent from its thread copy; an uncopied one is not",
    },
    gap: "SEC-93: uncopied legacy rows stay (prod count unknown); the owner checks conversation/backfill legacyMessagesStatus, runs the backfill and drops the table",
  },
  "messages.receiverId": {
    erasure: {
      deleted:
        "a legacy exchange-chat row conversation/backfill copied into its thread is a duplicate and goes; one never copied is the only copy and stays, counted in the log",
    },
    phases: ["legacyMessagesReceived"],
    export: {
      excluded:
        "a received message is its sender's; copied rows live in the thread",
    },
    gap: "SEC-93: uncopied legacy rows stay (prod count unknown); the owner checks conversation/backfill legacyMessagesStatus, runs the backfill and drops the table",
  },

  "threads.participants[]": {
    erasure: {
      kept: "a DM or exchange thread keeps both participants while the other one still has an account (its pair key and their reading of it need both) and is purged whole once none has (SEC-70); a circle thread drops them",
    },
    phases: ["circleParticipants", "pairThreads"],
    export: { exported: ["threads"] },
  },
  "threads.readReceipts[].memberId": {
    erasure: {
      kept: "deprecated and no longer written (read state lives on threadParticipants); an old entry is an id and a time, dropped with the field after conversation/backfillParticipantState, or with an orphaned thread",
    },
    phases: ["pairThreads"],
    export: {
      excluded:
        "deprecated; the member's read state is exported from threadParticipants (threads.lastReadAt)",
    },
  },
  "threads.lastMessage.authorId": {
    erasure: {
      kept: "the inbox summary of a thread's newest message names its author by id, like the message it summarises; it goes with an orphaned thread",
    },
    phases: ["pairThreads"],
    export: { excluded: "a summary of a message exported in messagesSent" },
  },
  "threads.lastMessage.systemEvent.memberId": {
    erasure: {
      kept: "the summary of a circle thread's newest 'joined' or 'left' row, by id; it reads as a deleted member",
    },
    export: { excluded: "their circle seats are exported in circles" },
  },

  "threadMessages.authorId": {
    erasure: {
      kept: "message text stays for the other participants and shows its author as a deleted member; it goes with an orphaned DM or exchange thread, or a deleted circle (sharing/purgeDeletedCircle)",
    },
    phases: ["pairThreads"],
    export: { exported: ["messagesSent"] },
  },
  "threadMessages.systemEvent.memberId": {
    erasure: {
      kept: "a circle thread's 'joined' or 'left' row: who joined or left, by id; it reads as a deleted member",
    },
    export: {
      excluded: "their circle seats (joinedAt) are exported in circles",
    },
  },

  "messageAttachments.uploaderId": {
    erasure: {
      kept: "a photo or place they sent stays as its message's 'no longer available' row: blobs, reveals and coordinates go, and an unsent one is deleted. One an open report holds, or a quarantined photo, stays",
    },
    phases: ["attachments"],
    export: { exported: ["attachmentsSent"] },
  },
  "messageAttachments.hashCheckWaivedBy": ADMIN_ATTRIBUTION,
  "messageAttachments.moderatedBy": ADMIN_ATTRIBUTION,

  "locationGpsViews.memberId": {
    erasure: { deleted: "their current-location picker views" },
    phases: ["gpsViews"],
    export: {
      excluded:
        "the location picker's 15-minute state, which expires on its own",
    },
  },
  "messageImageReveals.viewerId": {
    erasure: { deleted: "their taps on Show" },
    phases: ["reveals"],
    export: { excluded: "which photos they chose to show: display state" },
  },
  "threadParticipants.memberId": {
    erasure: {
      kept: "their row in a DM or exchange thread (read state, mute) stays while the other party still has an account and goes with the orphaned thread (SEC-70); their circle-thread rows go",
    },
    phases: ["circleParticipants", "pairThreads"],
    export: { exported: ["threads"] },
  },
  "typingIndicators.memberId": {
    erasure: { deleted: "their typing indicators, in every thread kind" },
    phases: ["typing"],
    export: { excluded: "a few seconds of 'is typing' state" },
  },

  "reviews.reviewerId": {
    erasure: {
      kept: "a partner review is the reviewee's reputation and stays; the reviewer can remove its comment (reputation/clearPartnerReviewComment) and the operator tool clears all their comments (social/removeMemberContent); the rating stays (SEC-70 owner decision)",
    },
    export: { exported: ["partnerReviewsGiven"] },
  },
  "reviews.revieweeId": {
    erasure: {
      kept: "reviews about them are their trade partners' and stay with that trade history",
    },
    export: { exported: ["partnerReviewsReceived"] },
  },
  "reputationProfiles.memberId": {
    erasure: {
      kept: "the read model folded from the partner reviews they received, which stay",
    },
    export: { exported: ["account"] },
  },

  "favorites.userId": {
    erasure: { deleted: "their favourites" },
    phases: ["favorites"],
    export: { exported: ["favorites"] },
  },

  "notifications.userId": {
    erasure: { deleted: "their own inbox" },
    phases: ["notifications"],
    export: {
      excluded:
        "the inbox restates what the other sections export (trades, follows, messages, decisions)",
    },
  },
  "notifications.actorIds[]": {
    erasure: {
      kept: "in other members' inboxes a past actor reads as 'Former member', never a name (spec 5.4); follow notices drop them, or go when they named only them",
    },
    phases: FOLLOW_NOTICE_PHASES,
    export: { excluded: "other members' inboxes" },
  },
  "notifications.relatedId": {
    declared:
      "v.string(): the newest actor's users id on a follow notice, a content id on the rest",
    erasure: {
      anonymised:
        "a follow notice points at its next actor instead, or goes when they were its only one",
    },
    phases: FOLLOW_NOTICE_PHASES,
    export: { excluded: "other members' inboxes" },
  },
  "notifications.params": {
    declared:
      "a string record: rows from before SEC-68 carry an actorName snapshot",
    erasure: {
      anonymised:
        "no row stores the actor's name any more (SEC-68); a follow notice drops the snapshot with its actor, and notifications/backfill stripActorNameSnapshots strips older rows",
    },
    phases: FOLLOW_NOTICE_PHASES,
    export: { excluded: "other members' inboxes" },
    gap: "SEC-68: older rows keep their snapshot until stripActorNameSnapshots runs (post-deploy); rows without actor refs need includeUnattributed (owner decision)",
  },

  "notificationPreferences.memberId": {
    erasure: { deleted: "their notification settings" },
    phases: ["settings"],
    export: { exported: ["account"] },
  },
  "notificationPreferences.toggles": {
    erasure: { deleted: "with their notification settings row" },
    phases: ["settings"],
    export: { exported: ["account"] },
  },
  "solvingPreferences.memberId": {
    erasure: { deleted: "their solving settings" },
    phases: ["settings"],
    export: { exported: ["account"] },
  },
  "presencePreferences.memberId": {
    erasure: { deleted: "their presence settings" },
    phases: ["presence"],
    export: { exported: ["account"] },
  },
  "pushSubscriptions.userId": {
    erasure: { deleted: "their push devices" },
    phases: ["pushSubscriptions"],
    export: { exported: ["pushDevices"] },
  },

  "circles.ownerId": {
    erasure: {
      anonymised:
        "a circle they own goes to its longest-standing active admin, else member; with nobody active left it is deleted",
    },
    phases: ["circlesOwned"],
    export: { exported: ["circles"] },
  },
  "circles.memberships[].memberId": {
    erasure: {
      kept: "their seat stays as a departed seat, shown as a deleted member",
    },
    export: { exported: ["circles"] },
  },
  "circleIcons.uploaderId": {
    erasure: {
      kept: "a circle's icon stays with the circle while it survives and goes with a deleted circle",
    },
    export: {
      excluded: "the circle's shared picture; the circle itself is in circles",
    },
  },
  "circleIcons.moderatedBy": ADMIN_ATTRIBUTION,
  "circleIcons.hashCheckWaivedBy": ADMIN_ATTRIBUTION,
  "circleMembers.memberId": {
    erasure: {
      kept: "the seat projection of circles.memberships: a departed seat stays",
    },
    export: { exported: ["circles"] },
  },
  "circleInvites.inviteeId": {
    erasure: { deleted: "circle invites they received, with the notices" },
    phases: ["invitesIn"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "circleInvites.inviterId": {
    erasure: { deleted: "circle invites they sent, with the notices" },
    phases: ["invitesOut"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "circleInvites.revokedBy": {
    erasure: {
      kept: "the circle admin who revoked another member's invite, by id only (it holds off a re-invite)",
    },
    export: { excluded: "another member's invitation" },
  },

  "profiles.memberId": {
    erasure: { deleted: "their profile" },
    phases: ["settings"],
    export: { exported: ["account"] },
  },

  "puzzleComments.authorId": {
    erasure: {
      kept: "a comment on a puzzle or another member's copy stays, shown as a deleted member (those on their own copies go with them); the member deletes their own in the app (social/deletePuzzleComment) and the operator tool removes all (social/removeMemberContent)",
    },
    phases: ["copies"],
    export: { exported: ["puzzleComments"] },
  },
  "photoComments.authorId": {
    erasure: {
      kept: "a comment on another member's photo stays, shown as a deleted member (those on their own photos go with them); the member deletes their own in the app (library/deletePhotoComment) and the operator tool removes all (social/removeMemberContent)",
    },
    phases: ["copies", "copyPhotos"],
    export: { exported: ["photoComments"] },
  },

  "follows.followerId": {
    erasure: { deleted: "the people they follow, with the follow notices" },
    phases: ["followsOut"],
    export: { exported: ["following"] },
  },
  "follows.followeeId": {
    erasure: { deleted: "the people following them" },
    phases: ["followsIn"],
    export: { exported: ["followers"] },
  },

  "inviteLinks.ownerId": {
    erasure: { deleted: "their invite links" },
    phases: ["inviteLinks"],
    export: { exported: ["inviteLinks"] },
  },
  "inviteLinks.consumedBy": {
    erasure: {
      anonymised:
        "a household link they used stays used up but no longer names them",
    },
    phases: ["redemptionsIn"],
    export: {
      excluded:
        "the link is its owner's; the household it brought them into is in household",
    },
  },
  "inviteRedemptions.inviterId": {
    erasure: { deleted: "the redemptions of their links" },
    phases: ["redemptionsOut"],
    export: {
      excluded: "counted on their links (inviteLinks.signupsAttributed)",
    },
  },
  "inviteRedemptions.newMemberId": {
    erasure: { deleted: "their redemption of someone's link" },
    phases: ["redemptionsIn"],
    export: { excluded: "the link owner's attribution record" },
  },

  "connectionOffers.fromId": {
    erasure: { deleted: "connection offers they made, with the notices" },
    phases: ["offersOut"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "connectionOffers.toId": {
    erasure: { deleted: "connection offers made to them, with the notices" },
    phases: ["offersIn"],
    export: { excluded: TRANSIENT_INVITE },
  },

  "followRequests.requesterId": {
    erasure: { deleted: "follow requests they sent, with the notices" },
    phases: ["requestsOut"],
    export: { exported: ["followRequestsSent"] },
  },
  "followRequests.targetId": {
    erasure: { deleted: "follow requests sent to them, with the notices" },
    phases: ["requestsIn"],
    export: { exported: ["followRequestsReceived"] },
  },

  "blocks.blockerId": {
    erasure: { deleted: "the blocks they placed" },
    phases: ["blocksOut"],
    export: { exported: ["blocks"] },
  },
  "blocks.blockedId": {
    erasure: { deleted: "the blocks placed on them" },
    phases: ["blocksIn"],
    export: {
      excluded: "a block placed on them is the blocker's, never disclosed",
    },
  },

  "householdMembers.memberId": {
    erasure: {
      deleted:
        "they leave through the leave use case: an admin's household promotes its longest-standing member, a sole member's is dissolved",
    },
    phases: ["household"],
    export: { exported: ["household"] },
  },
  "householdInvites.inviterId": {
    erasure: { deleted: "household invites they sent, with the notices" },
    phases: ["householdInvitesOut"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "householdInvites.inviteeId": {
    erasure: { deleted: "household invites they received, with the notices" },
    phases: ["householdInvitesIn"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "householdJoinRequests.requesterId": {
    erasure: { deleted: "requests to join they sent, with the notices" },
    phases: ["householdJoinRequestsOut"],
    export: { excluded: TRANSIENT_INVITE },
  },
  "householdJoinRequests.adminId": {
    erasure: {
      kept: "the link owner a request to join was sent to, by id only: the request is the requester's, and whoever is the household's admin decides it",
    },
    export: { excluded: "another member's request" },
  },

  "emailInvites.inviterId": {
    erasure: {
      deleted:
        "email invitations they sent: the fallback is withdrawn and the Clerk invitation revoked",
    },
    phases: ["emailInvitesOut"],
    export: { exported: ["emailInvitesSent"] },
  },

  "domainEvents.payload": {
    erasure: {
      anonymised:
        "their own feed events (solves, copies acquired) are deleted, and every other event naming them has their id replaced and copied personal fields dropped; typed free text is never recorded (events/recordAndSchedule)",
    },
    phases: ["domainEvents"],
    export: {
      excluded: "the internal event log; each fact is in its own section",
    },
    gap: "SEC-71: events/retention deletes dispatched events after the feed window only once RETENTION_ENFORCE is set (owner decision); older rows keep free text until events/redactPayloads runs (post-deploy)",
  },
  "domainEventMembers.memberId": {
    erasure: { deleted: "their event lookup rows" },
    phases: ["domainEvents"],
    export: { excluded: "an internal index of the event log" },
  },
  "memberLibraryCounts.memberId": {
    erasure: {
      deleted: "their library counters, once their copies are gone",
    },
    phases: ["copies"],
    export: {
      excluded:
        "two numbers derived from their copies, which the export carries itself",
    },
  },
  "activityEntries.actorId": {
    erasure: {
      deleted:
        "their rows in the activity feed's read model (social/activityEntries)",
    },
    phases: ["activityEntries"],
    export: {
      excluded:
        "a read model derived from their solves, copies and exchanges, which the export carries itself",
    },
  },
  "activityEntries.partyIds[]": {
    erasure: {
      kept: "the other party's row of an exchange lists both parties by id, like the exchanges row it mirrors; it reads as a deleted member once their account is gone",
    },
    export: {
      excluded:
        "a read model derived from their exchanges, which the export carries itself",
    },
  },

  "loans.lenderId": {
    erasure: {
      kept: "a loan is the copy's History and the other party's: it stays, naming them as a deleted member; an open one is closed as returned",
    },
    phases: ["loansOpen"],
    export: { exported: ["loansLent"] },
  },
  "loans.borrowerId": {
    erasure: {
      kept: "a loan is the copy's History and the other party's: it stays, naming them as a deleted member; an open one is closed as returned",
    },
    phases: ["loansOpenIn"],
    export: { exported: ["loansBorrowed"] },
  },

  "contactMessages.email": {
    erasure: {
      kept: "the public contact form is not linked to an account (no member id), so the purge cannot find it",
    },
    export: { excluded: "not linked to an account" },
    gap: "SEC-22 (sec-abuse-paid): contact messages need a retention limit",
  },
  "docFeedback.userId": {
    erasure: {
      kept: "never written today: docs feedback is anonymous (the field is reserved)",
    },
    export: { excluded: "never written" },
    gap: "SEC-22 (sec-abuse-paid): docs feedback needs a retention limit",
  },

  "whatsNewReadStates.memberId": {
    erasure: { deleted: "which release notes they have read" },
    phases: ["settings"],
    export: { excluded: "display state" },
  },
  "whatsNewTourProgress.memberId": {
    erasure: { deleted: "their tour progress" },
    phases: ["tourProgress"],
    export: { excluded: "display state" },
  },
  "memberOnboarding.memberId": {
    erasure: { deleted: "their onboarding state" },
    phases: ["settings"],
    export: { exported: ["account"] },
  },

  "reports.reporterId": {
    erasure: {
      anonymised:
        "reports they filed stay as the decision record, without them (reporterId cleared)",
    },
    phases: ["reports"],
    export: { exported: ["reportsFiled"] },
  },
  "reports.reportedUserId": {
    erasure: {
      kept: "a report about them stays as the decision record; 12 months after its decision reports/retention anonymises the reporter and clears the details",
    },
    export: {
      excluded:
        "a report about them is the reporter's, kept confidential; a decision against them reaches them as a notice (admin/decideReport)",
    },
    gap: "SEC-89: an undecided report never reaches retention (owner/DSA decision); the daily backstop only logs reports open over 30 days",
  },
  "reports.illegalNotice.notifierEmail": {
    erasure: {
      anonymised:
        "the notice's name and email go with the reporter, or at the report's retention",
    },
    phases: ["reports"],
    export: { exported: ["reportsFiled"] },
  },
  "reports.evidence.messages[].authorId": {
    erasure: {
      kept: "the evidence snapshot of a reported conversation names message authors by id; reports/retention clears the bodies",
    },
    export: {
      excluded:
        "evidence held for the report; the member's own messages are in messagesSent",
    },
  },
  "reports.decidedBy": ADMIN_ATTRIBUTION,

  "copyCustodyEntries.previousOwner": {
    declared: "v.string(): a users id",
    erasure: {
      kept: "a copy's custody History names who it moved between, by id; it reads as a deleted member",
    },
    export: {
      excluded:
        "each transfer is exported as its exchange (exchangesProposed, exchangesReceived)",
    },
  },
  "copyCustodyEntries.newOwner": {
    declared: "v.string(): a users id",
    erasure: {
      kept: "a copy's custody History names who it moved between, by id; it reads as a deleted member",
    },
    export: {
      excluded:
        "each transfer is exported as its exchange (exchangesProposed, exchangesReceived)",
    },
  },

  "rateLimits.key": {
    declared: "v.string(): '<limit name>:<users id>' for per-member limits",
    erasure: { deleted: "their per-member counters" },
    phases: ["rateLimits"],
    export: { excluded: "abuse-prevention counters" },
  },
  "rateLimits.pairActorId": {
    erasure: { deleted: "the per-pair counters of what they did to others" },
    phases: ["rateLimits"],
    export: { excluded: "abuse-prevention counters" },
  },
  "rateLimits.pairTargetId": {
    erasure: { deleted: "the per-pair counters of what others did to them" },
    phases: ["rateLimits"],
    export: { excluded: "abuse-prevention counters" },
  },
};

// Member data outside the Convex schema, for the complete picture.
const OUTSIDE_SCHEMA: Record<string, Disposition> = {
  "Clerk user": {
    erasure: {
      deleted:
        "the member deletes their account in Clerk; its user.deleted webhook runs users.deleteUser",
    },
    export: {
      excluded:
        "Clerk's own account page shows the sign-in data; the account section exports what JigSwap mirrors (email, name)",
    },
  },
  "presence component rows": {
    erasure: { deleted: "their rows in every room they were in" },
    phases: ["presence"],
    export: { excluded: "live online state" },
  },
  "PostHog person": {
    erasure: { kept: "not deleted with the account" },
    export: { excluded: "product analytics" },
    gap: "SEC-59 (sec-web): stop sending the email and reset on sign-out; deleting the person needs a PostHog API key (owner decision)",
  },
  "Axiom logs": {
    erasure: {
      kept: "wide-event logs name members by users id (SEC-75 keeps recipient addresses out of the email logs); they age out under the dataset's retention, an Axiom setting",
    },
    export: { excluded: "operational logs" },
  },
  "AhaSend delivery logs": {
    erasure: {
      kept: "the email provider keeps its own delivery records under its retention (named in the privacy policy, SEC-64)",
    },
    export: { excluded: "the provider's records" },
  },
};

type Found = {
  /** Paths that must be classified: users ids, opaque values, direct identifiers. */
  readonly memberPaths: Set<string>;
  /** Every field path, of any type, with its validator kinds. */
  readonly kinds: Map<string, Set<string>>;
};

const IDENTIFIER_NAME = /^(email|clerkId)$|(Email|ClerkId)$/;

const walk = (validator: GenericValidator, path: string, found: Found) => {
  const kinds = found.kinds.get(path) ?? new Set<string>();
  kinds.add(
    validator.kind === "id" ? `id:${validator.tableName}` : validator.kind,
  );
  found.kinds.set(path, kinds);
  switch (validator.kind) {
    case "id":
      if (validator.tableName === "users") found.memberPaths.add(path);
      return;
    case "any":
      found.memberPaths.add(path);
      return;
    case "string": {
      const name = path.slice(path.lastIndexOf(".") + 1);
      if (IDENTIFIER_NAME.test(name)) found.memberPaths.add(path);
      return;
    }
    case "object": {
      const { exchangeId, side } = validator.fields;
      if (
        exchangeId?.kind === "id" &&
        exchangeId.tableName === "exchanges" &&
        side
      ) {
        found.memberPaths.add(`${path}.side`);
      }
      for (const [name, field] of Object.entries(validator.fields)) {
        walk(field, `${path}.${name}`, found);
      }
      return;
    }
    case "array":
      walk(validator.element, `${path}[]`, found);
      return;
    case "record":
      walk(validator.key, `${path}{key}`, found);
      walk(validator.value, `${path}{}`, found);
      return;
    case "union":
      for (const member of validator.members) walk(member, path, found);
      return;
    default:
      return;
  }
};

const walkSchema = (): Found => {
  const found: Found = { memberPaths: new Set(), kinds: new Map() };
  for (const [table, definition] of Object.entries(schema.tables)) {
    walk(definition.validator, table, found);
  }
  return found;
};

const sorted = (values: Iterable<string>) => [...values].sort();

describe("member-data coverage manifest (SEC-95)", () => {
  const found = walkSchema();
  const entries = Object.entries(MANIFEST);

  test("the walker sees member references through nesting", () => {
    // Guards the walker itself: an optional id, an id in a union member (a table defined as a
    // union), in an array, in an array of objects and in a nested optional object, a direct
    // identifier and an opaque value are all found.
    for (const path of [
      "docFeedback.userId",
      "messageAttachments.moderatedBy",
      "threads.participants[]",
      "threads.readReceipts[].memberId",
      "threads.lastMessage.systemEvent.memberId",
      "reports.evidence.messages[].authorId",
      "csamEscalations.uploaderSnapshot.email",
      "domainEvents.payload",
      "tradeContactShares.side",
    ]) {
      expect(found.memberPaths).toContain(path);
    }
  });

  test("classifies every place the schema holds a member's data", () => {
    const unclassified = sorted(found.memberPaths).filter(
      (path) => !(path in MANIFEST),
    );
    expect(unclassified).toEqual([]);
  });

  test("has no entry for a field the schema no longer has", () => {
    const stale = sorted(
      entries.map(([path]) => path).filter((path) => !found.kinds.has(path)),
    );
    expect(stale).toEqual([]);
  });

  test("declares by hand exactly the member references the walker cannot see", () => {
    // A declared path holds a users id the validator does not type as one; a discovered path
    // needs no declaration.
    const misdeclared = sorted(
      entries
        .filter(
          ([path, entry]) =>
            (entry.declared !== undefined) === found.memberPaths.has(path),
        )
        .map(([path]) => path),
    );
    expect(misdeclared).toEqual([]);
  });

  test("accounts for every phase of the account-deletion purge", () => {
    const cited = new Set(
      [...entries, ...Object.entries(OUTSIDE_SCHEMA)].flatMap(
        ([, entry]) => entry.phases ?? [],
      ),
    );
    expect(PHASES.filter((phase) => !cited.has(phase))).toEqual([]);
  });

  test("accounts for every section of the data export", () => {
    const cited = new Set(
      entries.flatMap(([, entry]) =>
        "exported" in entry.export ? entry.export.exported : [],
      ),
    );
    expect(EXPORT_SECTIONS.filter((section) => !cited.has(section))).toEqual(
      [],
    );
  });

  test("cites only Convex modules that exist", () => {
    // Reasons name the modules that carry them ("reports/retention"); a rename must update them.
    const texts = [...entries, ...Object.entries(OUTSIDE_SCHEMA)].flatMap(
      ([, entry]) => [
        ...Object.values(entry.erasure),
        ...("excluded" in entry.export ? [entry.export.excluded] : []),
        ...(entry.gap === undefined ? [] : [entry.gap]),
      ],
    );
    const modules = new Set(
      texts.flatMap((text) =>
        [...text.matchAll(/\b([a-z][A-Za-z]*\/[a-z][A-Za-z]*)\b/g)].map(
          (match) => match[1],
        ),
      ),
    );
    expect(modules.size).toBeGreaterThan(10);
    const missing = sorted(modules).filter(
      (module) => !existsSync(new URL(`./${module}.ts`, import.meta.url)),
    );
    expect(missing).toEqual([]);
  });

  test("gives every disposition a reason", () => {
    const blank = [...entries, ...Object.entries(OUTSIDE_SCHEMA)]
      .filter(([, entry]) => {
        const reasons = [
          ...Object.values(entry.erasure),
          ...("excluded" in entry.export ? [entry.export.excluded] : []),
        ];
        return reasons.some((reason) => reason.trim().length === 0);
      })
      .map(([path]) => path);
    expect(blank).toEqual([]);
  });
});
