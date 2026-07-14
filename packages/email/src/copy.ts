// Localized email copy for the EMAIL-ELIGIBLE notification types. Kept in sync with the domain's
// EMAIL_ELIGIBLE_TYPES (packages/domain notification-type.ts) — set-equality is pinned by a test
// in render.test.ts. Hand-maintained (not Crowdin) per spec.
export const EMAIL_TYPES = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];
export type EmailLocale = "en" | "nl";

export interface EmailCopy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly cta: string;
}

// Locale-appropriate fallbacks merged UNDER params at render time, so copy may reference
// {actorName} even though a legacy or degenerate event carries none.
export const DEFAULT_PARAMS: Record<EmailLocale, Record<string, string>> = {
  en: { actorName: "Someone", goalTitle: "your goal", puzzleTitle: "a puzzle" },
  nl: { actorName: "Iemand", goalTitle: "je doel", puzzleTitle: "een puzzel" },
};

export const FOOTER: Record<EmailLocale, { text: string; linkLabel: string }> =
  {
    en: {
      text: "You are receiving this because email notifications are enabled for your JigSwap account.",
      linkLabel: "Manage notification preferences",
    },
    nl: {
      text: "Je ontvangt deze e-mail omdat e-mailmeldingen aanstaan voor je JigSwap-account.",
      linkLabel: "Meldingsvoorkeuren beheren",
    },
  };

export const EMAIL_COPY: Record<EmailType, Record<EmailLocale, EmailCopy>> = {
  trade_request: {
    en: {
      subject: "New trade request on JigSwap",
      heading: "New trade request",
      body: "{actorName} wants to trade for one of your puzzles.",
      cta: "View trade requests",
    },
    nl: {
      subject: "Nieuw ruilverzoek op JigSwap",
      heading: "Nieuw ruilverzoek",
      body: "{actorName} wil ruilen voor een van je puzzels.",
      cta: "Bekijk ruilverzoeken",
    },
  },
  trade_accepted: {
    en: {
      subject: "Your trade request was accepted",
      heading: "Trade request accepted",
      body: "Good news — your trade request has been accepted! Time to arrange the exchange.",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruilverzoek is geaccepteerd",
      heading: "Ruilverzoek geaccepteerd",
      body: "Goed nieuws — je ruilverzoek is geaccepteerd! Tijd om de ruil te regelen.",
      cta: "Bekijk uitwisselingen",
    },
  },
  trade_declined: {
    en: {
      subject: "Your trade request was declined",
      heading: "Trade request declined",
      body: "Unfortunately your trade request has been declined.",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruilverzoek is afgewezen",
      heading: "Ruilverzoek afgewezen",
      body: "Helaas is je ruilverzoek afgewezen.",
      cta: "Bekijk uitwisselingen",
    },
  },
  trade_completed: {
    en: {
      subject: "Your trade is complete",
      heading: "Trade completed",
      body: "Your exchange has been marked as completed. Enjoy the puzzle!",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruil is afgerond",
      heading: "Ruil afgerond",
      body: "Je ruil is gemarkeerd als afgerond. Veel puzzelplezier!",
      cta: "Bekijk uitwisselingen",
    },
  },
  trade_cancelled: {
    en: {
      subject: "A trade was cancelled",
      heading: "Trade cancelled",
      body: "A trade request involving you has been cancelled.",
      cta: "View trades",
    },
    nl: {
      subject: "Een ruil is geannuleerd",
      heading: "Ruil geannuleerd",
      body: "Een ruilverzoek waar jij bij betrokken bent is geannuleerd.",
      cta: "Bekijk uitwisselingen",
    },
  },
  message_received: {
    en: {
      subject: "New message from {actorName} on JigSwap",
      heading: "New message",
      body: "{actorName} sent you a message on JigSwap.",
      cta: "Read message",
    },
    nl: {
      subject: "Nieuw bericht van {actorName} op JigSwap",
      heading: "Nieuw bericht",
      body: "{actorName} heeft je een bericht gestuurd op JigSwap.",
      cta: "Lees bericht",
    },
  },
  review_received: {
    en: {
      subject: "You received a new review",
      heading: "New review",
      body: "A trade partner left you a review.",
      cta: "View your profile",
    },
    nl: {
      subject: "Je hebt een nieuwe beoordeling ontvangen",
      heading: "Nieuwe beoordeling",
      body: "Een ruilpartner heeft een beoordeling voor je achtergelaten.",
      cta: "Bekijk je profiel",
    },
  },
  puzzle_favorited: {
    en: {
      subject: "Someone favorited your puzzle",
      heading: "Your puzzle was favorited",
      body: "A member added one of your puzzles to their favorites.",
      cta: "View puzzle",
    },
    nl: {
      subject: "Iemand heeft je puzzel als favoriet gemarkeerd",
      heading: "Je puzzel is toegevoegd aan de favorieten",
      body: "Een lid heeft een van je puzzels aan hun favorieten toegevoegd.",
      cta: "Bekijk puzzel",
    },
  },
  goal_achieved: {
    en: {
      subject: "Goal achieved on JigSwap",
      heading: "Goal achieved",
      body: "You reached your goal “{goalTitle}”. Congratulations!",
      cta: "View goals",
    },
    nl: {
      subject: "Doel behaald op JigSwap",
      heading: "Doel behaald",
      body: "Je hebt je doel “{goalTitle}” behaald. Gefeliciteerd!",
      cta: "Bekijk doelen",
    },
  },
  new_follower: {
    en: {
      subject: "{actorName} started following you on JigSwap",
      heading: "New follower",
      body: "{actorName} started following you on JigSwap.",
      cta: "View people",
    },
    nl: {
      subject: "{actorName} volgt je nu op JigSwap",
      heading: "Nieuwe volger",
      body: "{actorName} is je gaan volgen op JigSwap.",
      cta: "Bekijk leden",
    },
  },
  follow_request_received: {
    en: {
      subject: "{actorName} wants to follow you on JigSwap",
      heading: "Follow request",
      body: "{actorName} asked to follow you. You can approve or decline the request.",
      cta: "Review request",
    },
    nl: {
      subject: "{actorName} wil je volgen op JigSwap",
      heading: "Volgverzoek",
      body: "{actorName} heeft gevraagd om je te volgen. Je kunt het verzoek goedkeuren of afwijzen.",
      cta: "Beoordeel verzoek",
    },
  },
  follow_request_approved: {
    en: {
      subject: "Your follow request was approved",
      heading: "Follow request approved",
      body: "{actorName} approved your follow request. You can now see their profile and puzzles.",
      cta: "View people",
    },
    nl: {
      subject: "Je volgverzoek is goedgekeurd",
      heading: "Volgverzoek goedgekeurd",
      body: "{actorName} heeft je volgverzoek goedgekeurd. Je kunt nu hun profiel en puzzels bekijken.",
      cta: "Bekijk leden",
    },
  },
};
