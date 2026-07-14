import type { EmailType } from "./copy";

// Web-app path the email CTA deep-links to, mirroring the in-app notificationHref mapping
// (apps/web/src/components/notifications/notification-meta.ts). relatedId semantics per type are
// set by the backend subscriber: thread aggregateId for messages, puzzle id for favorites.
export const ctaPath = (type: EmailType, relatedId?: string): string => {
  switch (type) {
    case "trade_request":
    case "trade_accepted":
    case "trade_declined":
    case "trade_completed":
    case "trade_cancelled":
      return "/trades";
    case "message_received":
      return relatedId ? `/messages/${relatedId}` : "/messages";
    case "review_received":
      return "/profile";
    case "puzzle_favorited":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    case "goal_achieved":
      return "/goals";
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
  }
};
