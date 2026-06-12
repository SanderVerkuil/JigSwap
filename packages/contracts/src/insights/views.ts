// Insights read-model view DTOs: the typed shapes the gateway's `insights:` reads return.

/** Minimal public view of a catalog puzzle for the marketing hero plank. */
export interface PlankPuzzleView {
  title: string;
  pieceCount: number;
  brand?: string;
  /** Resolved cover URL, if the puzzle has box art. */
  image: string | null;
}

/** Privacy-minimal public view of a community member for marketing surfaces.
 *  Initials are derived server-side; the raw name never crosses the wire.
 *  `image` is only present when the member opted in to public avatar sharing. */
export interface CommunityAvatarView {
  initials: string;
  image: string | null;
}
