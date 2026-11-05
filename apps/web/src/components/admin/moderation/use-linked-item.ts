import { useState } from "react";

/**
 * Tells a link to a queue item from the console's own selection, since both end up in the URL's
 * `item`. `linkToken` changes each time the URL's item becomes one the console did not write itself:
 * a notification's link opened while the queue is already on screen, or Back. Call `noteOwnWrite`
 * right before the console writes the item (a row selected, a decision moving on to the next one).
 * The value on mount is not a change: a queue that mounts with an item has `defaultDetailOpen`.
 * State is adjusted during render (React's "storing information from previous renders" pattern),
 * never in an effect.
 */
export function useLinkedItem(item: string | undefined): {
  linkToken: number;
  noteOwnWrite: (id: string | undefined) => void;
} {
  const [seen, setSeen] = useState(item);
  const [own, setOwn] = useState<string | undefined>(undefined);
  const [linkToken, setLinkToken] = useState(0);

  if (item !== seen) {
    setSeen(item);
    // A cleared item (a tab switch) also ends what the console wrote: a later link to that same
    // row is still a link.
    if (item === undefined) setOwn(undefined);
    else if (item !== own) setLinkToken(linkToken + 1);
  }

  return { linkToken, noteOwnWrite: setOwn };
}
