import type { NotificationType } from "@jigswap/domain";

// English render table for notification copy, used ONLY where a server-side plain string is
// needed today: the push channel payload. Web renders localized copy from i18n keys; email
// renders localized copy in @jigswap/email. Push stays English by design (spec: localizing push
// is out of scope).
//
// Params contract (what the subscriber puts in `params`, all optional at render time; renderers
// use what they need — e.g. this push table keeps follow_request_approved static while the email
// templates interpolate its actorName):
//   actorName   — trade_request (initiator), message_received (author), new_follower (follower),
//                 follow_request_received (requester), follow_request_approved (target)
//   puzzleTitle — puzzle_approved/rejected, proposal_approved/rejected, admin_proposal_filed,
//                 admin_definition_submitted
//   goalTitle   — goal_achieved
//   reason      — proposal_rejected (moderator-entered, may be absent)

export interface NotificationText {
  readonly title: string;
  readonly message: string;
}

type Params = Readonly<Record<string, string>>;

const COPY: Record<NotificationType, (p: Params) => NotificationText> = {
  trade_request: (p) => ({
    title: "New Exchange Request",
    message: `${p["actorName"] ?? "Someone"} wants to trade for one of your puzzles`,
  }),
  trade_accepted: () => ({
    title: "Exchange Accepted",
    message: "Your trade request has been accepted!",
  }),
  trade_declined: () => ({
    title: "Exchange Declined",
    message: "Your trade request has been declined",
  }),
  trade_completed: () => ({
    title: "Exchange Completed",
    message: "Exchange has been marked as completed",
  }),
  trade_cancelled: () => ({
    title: "Exchange Cancelled",
    message: "Exchange request has been cancelled",
  }),
  message_received: (p) => ({
    title: "New message",
    message: p["actorName"]
      ? `${p["actorName"]} sent you a message`
      : "You have a new message",
  }),
  review_received: () => ({
    title: "New Review",
    message: "You received a new partner review",
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
  exchange_disputed: () => ({
    title: "Exchange Disputed",
    message: "The other party has flagged an issue with your exchange",
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
  follow_request_approved: () => ({
    title: "Request approved",
    message: "Your follow request was approved",
  }),
};

export const renderNotificationText = (
  type: NotificationType,
  params: Params = {},
): NotificationText => COPY[type](params);
