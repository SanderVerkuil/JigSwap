// Multi-step tours as data (spec §A7). A tour id must be the `tour` of a What's new entry or be
// listed in STANDALONE_TOUR_IDS (@jigswap/contracts), or the backend rejects its progress with
// `unknown_tour`; definitions.test.ts checks both ways. Step copy lives in the locale files under
// `tours.<tourId>.steps.<stepId>.title|body`; targets are `data-tour="<anchor>"` attributes on
// existing components.

import { STANDALONE_TOUR_IDS } from "@jigswap/contracts";

export type TourSide = "top" | "right" | "bottom" | "left";
export type TourAlign = "start" | "center" | "end";

export interface TourStep {
  /** Stable within the tour; also the i18n key segment. */
  id: string;
  /** In-app path the step lives on. The runner navigates there first when it is another page. */
  route: string;
  /**
   * `data-tour` value of the element to spotlight. Omitted for a step that explains something not
   * on screen: it shows as a centred card, like a target that never appeared.
   */
  target?: string;
  /** Desktop popover placement (defaults: bottom, start). Mobile always uses the docked card. */
  side?: TourSide;
  align?: TourAlign;
}

export interface TourDefinition {
  id: string;
  steps: readonly TourStep[];
}

const tours: readonly TourDefinition[] = [
  // Standalone: the quick start's "Show me around" hand-off (quick start spec §2.8).
  {
    id: "getting-started",
    steps: [
      { id: "shelf", route: "/dashboard", target: "dashboard-shelf" },
      { id: "solving-now", route: "/dashboard", target: "solving-now" },
      { id: "people", route: "/people", target: "people-network" },
      {
        id: "account-menu",
        route: "/dashboard",
        target: "account-menu",
        side: "right",
        align: "end",
      },
    ],
  },
  {
    id: "households",
    steps: [
      { id: "start", route: "/household", target: "household-main" },
      { id: "invite", route: "/household", target: "household-invite" },
      // Per-copy access, set in bulk from the household page's Sharing tab.
      { id: "copy-access", route: "/household", target: "household-my-copies" },
    ],
  },
  {
    id: "member-profiles",
    steps: [
      { id: "network", route: "/people", target: "people-network" },
      { id: "your-profile", route: "/profile", target: "profile-edit" },
    ],
  },
  {
    id: "in-progress-solves",
    steps: [
      { id: "solving-now", route: "/dashboard", target: "solving-now" },
      {
        id: "in-progress",
        route: "/completions",
        target: "completions-in-progress",
      },
      {
        id: "sharing",
        route: "/completions",
        target: "account-menu",
        side: "right",
        align: "end",
      },
    ],
  },
];

export const TOURS: ReadonlyMap<string, TourDefinition> = new Map(
  tours.map((tour) => [tour.id, tour]),
);

/** A tour started outside What's new, so a paused one is resumed from elsewhere. */
export function isStandaloneTour(tourId: string): boolean {
  return (STANDALONE_TOUR_IDS as readonly string[]).includes(tourId);
}

/** i18n keys for a step's copy, relative to the root namespace. */
export function stepMessageKeys(tourId: string, stepId: string) {
  const base = `tours.${tourId}.steps.${stepId}`;
  return { title: `${base}.title`, body: `${base}.body` };
}
