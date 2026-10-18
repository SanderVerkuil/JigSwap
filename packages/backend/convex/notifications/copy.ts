import type { NotificationType } from "@jigswap/domain";
import type { DeliveryContent } from "./deliveryContent";

// English render table for notification copy, used ONLY where a server-side plain string is
// needed today: the push channel payload. Web renders localized copy from i18n keys; email
// renders localized copy in @jigswap/email. Push stays English by design (spec: localizing push
// is out of scope).
//
// Params contract (what the subscriber puts in `params`, all optional at render time; renderers
// use what they need — e.g. this push table keeps follow_request_approved static while the email
// templates interpolate its actorName):
//   actorName   — trade_request (initiator), message_received (author), new_follower (follower),
//                 follow_request_received (requester), follow_request_approved (target),
//                 household_invite_received (inviter), household_invite_accepted (invitee),
//                 connection_offer_received (inviter)
//   puzzleTitle — puzzle_approved/rejected, proposal_approved/rejected, admin_proposal_filed,
//                 admin_definition_submitted
//   goalTitle   — goal_achieved
//   reason      — proposal_rejected (moderator-entered, may be absent)
//   rating      — review_received (1-5, snapshotted)
// The push send action renders from the delivery resolved for the recipient (pushTextOf), which
// overlays the live actor name and context: puzzleTitle on the trade types (the exchanged copy),
// messagePreview or messageKind (image | location) on message_received, and actorName on every
// type that has an actor.
// whats_new carries no params: relatedId is the entry id, and the entry title is per-locale content
// the backend manifest doesn't hold, so push uses a static line.

export interface NotificationText {
  readonly title: string;
  readonly message: string;
}

type Params = Readonly<Record<string, string>>;

// ` for "<title>"` / ` of "<title>"` when the puzzle is known, else nothing.
const about = (p: Params, word: "for" | "of"): string =>
  p["puzzleTitle"] ? ` ${word} "${p["puzzleTitle"]}"` : "";

const COPY: Record<NotificationType, (p: Params) => NotificationText> = {
  trade_request: (p) => ({
    title: "New Exchange Request",
    message: p["puzzleTitle"]
      ? `${p["actorName"] ?? "Someone"} wants to trade for "${p["puzzleTitle"]}"`
      : `${p["actorName"] ?? "Someone"} wants to trade for one of your puzzles`,
  }),
  trade_accepted: (p) => ({
    title: "Exchange Accepted",
    message: p["actorName"]
      ? `${p["actorName"]} accepted your trade request${about(p, "for")}`
      : "Your trade request has been accepted!",
  }),
  trade_declined: (p) => ({
    title: "Exchange Declined",
    message: p["actorName"]
      ? `${p["actorName"]} declined your trade request${about(p, "for")}`
      : "Your trade request has been declined",
  }),
  trade_completed: (p) => ({
    title: "Exchange Completed",
    message: p["actorName"]
      ? `Your exchange${about(p, "of")} with ${p["actorName"]} was marked as completed`
      : "Exchange has been marked as completed",
  }),
  trade_cancelled: (p) => ({
    title: "Exchange Cancelled",
    message: p["actorName"]
      ? `${p["actorName"]} cancelled the trade request${about(p, "for")}`
      : "Exchange request has been cancelled",
  }),
  message_received: (p) => {
    const actor = p["actorName"];
    const preview = p["messagePreview"];
    // A photo or location is named by its kind; its caption is never shown.
    const media =
      p["messageKind"] === "image"
        ? "sent a photo"
        : p["messageKind"] === "location"
          ? "shared a location"
          : undefined;
    if (media) {
      return {
        title: actor ? `New message from ${actor}` : "New message",
        message: `${actor ?? "Someone"} ${media}`,
      };
    }
    if (actor && preview) {
      return { title: `New message from ${actor}`, message: preview };
    }
    return {
      title: "New message",
      message: actor ? `${actor} sent you a message` : "You have a new message",
    };
  },
  review_received: (p) => ({
    title: "New Review",
    message: p["actorName"]
      ? p["rating"]
        ? `${p["actorName"]} left you a ${p["rating"]}-star review`
        : `${p["actorName"]} left you a review`
      : "You received a new partner review",
  }),
  puzzle_favorited: () => ({
    title: "Puzzle Favorited",
    message: "Someone added one of your puzzles to their favorites",
  }),
  goal_achieved: (p) => ({
    title: "Goal Achieved",
    message: p["goalTitle"]
      ? `You reached your goal "${p["goalTitle"]}"!`
      : "You reached your goal!",
  }),
  puzzle_approved: (p) => ({
    title: "Puzzle Approved",
    message: p["puzzleTitle"]
      ? `Your submission "${p["puzzleTitle"]}" was approved`
      : "Your puzzle submission was approved",
  }),
  puzzle_rejected: (p) => ({
    title: "Puzzle Rejected",
    message: p["puzzleTitle"]
      ? `Your submission "${p["puzzleTitle"]}" was rejected`
      : "Your puzzle submission was rejected",
  }),
  photo_removed: () => ({
    title: "Photo Removed",
    message: "A moderator removed one of your puzzle photos",
  }),
  exchange_proposed: (p) => ({
    title: "New Exchange Request",
    message: `${p["actorName"] ?? "Someone"} wants to trade for one of your puzzles`,
  }),
  exchange_disputed: (p) => ({
    title: "Exchange Disputed",
    message: p["actorName"]
      ? `${p["actorName"]} flagged an issue with your exchange${about(p, "of")}`
      : "The other party has flagged an issue with your exchange",
  }),
  proposal_approved: (p) => ({
    title: "Suggestion Applied",
    message: p["puzzleTitle"]
      ? `Your suggested edit to "${p["puzzleTitle"]}" was approved`
      : "Your suggested edit was approved",
  }),
  proposal_rejected: (p) => {
    const base = p["puzzleTitle"]
      ? `Your suggested edit to "${p["puzzleTitle"]}" was declined`
      : "Your suggested edit was declined";
    return {
      title: "Suggestion Declined",
      message: p["reason"] ? `${base}: ${p["reason"]}` : base,
    };
  },
  admin_proposal_filed: (p) => ({
    title: "Suggestion to Review",
    message: p["puzzleTitle"]
      ? `A member suggested an edit to "${p["puzzleTitle"]}"`
      : "A member suggested an edit to a catalogue puzzle",
  }),
  admin_definition_submitted: (p) => ({
    title: "Submission to Moderate",
    message: p["puzzleTitle"]
      ? `"${p["puzzleTitle"]}" awaits moderation`
      : "A new puzzle submission awaits moderation",
  }),
  new_follower: (p) => ({
    title: "New follower",
    message: p["actorName"]
      ? `${p["actorName"]} started following you`
      : "Someone started following you",
  }),
  follow_request_received: (p) => ({
    title: "Follow request",
    message: p["actorName"]
      ? `${p["actorName"]} asked to follow you`
      : "Someone asked to follow you",
  }),
  follow_request_approved: (p) => ({
    title: "Request approved",
    message: p["actorName"]
      ? `${p["actorName"]} approved your follow request`
      : "Your follow request was approved",
  }),
  household_invite_received: (p) => ({
    title: "Household invite",
    message: p["actorName"]
      ? `${p["actorName"]} invited you to their household`
      : "You were invited to a household",
  }),
  household_invite_accepted: (p) => ({
    title: "Invite accepted",
    message: p["actorName"]
      ? `${p["actorName"]} joined your household`
      : "Someone joined your household",
  }),
  connection_offer_received: (p) => ({
    title: "Follow each other?",
    message: p["actorName"]
      ? `${p["actorName"]} invited you to JigSwap. Follow each other?`
      : "Someone invited you to JigSwap. Follow each other?",
  }),
  whats_new: () => ({
    title: "New in JigSwap",
    message: "See what's new in JigSwap",
  }),
};

export const renderNotificationText = (
  type: NotificationType,
  params: Params = {},
): NotificationText => COPY[type](params);

/** The push label for a deleted or deactivated actor (push is English-only). */
export const FORMER_MEMBER = "Former member";

/** Push text for a delivery resolved for its recipient (notifications/resolveForDelivery). */
export const pushTextOf = (
  type: NotificationType,
  content: DeliveryContent,
): NotificationText =>
  renderNotificationText(
    type,
    content.actorAnonymous
      ? { ...content.params, actorName: FORMER_MEMBER }
      : content.params,
  );
