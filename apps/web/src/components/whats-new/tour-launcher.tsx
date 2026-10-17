"use client";

import { createContext, useContext } from "react";

// Seam for W4's tour runner. "Take the tour" buttons (entry cards, highlight modal) call
// `useTourLauncher().startTour(tourId, { returnFocus })`; W4 mounts a provider with the real
// runner. `returnFocus` is the element focus goes back to when the tour pauses or ends (the
// clicked button; null when it is about to unmount, as in the modal). Until then the default is
// a no-op: no shipped entry has a `tour` before W4 adds the tours and the seed entries.
export interface TourLauncher {
  startTour: (
    tourId: string,
    options?: { returnFocus?: HTMLElement | null },
  ) => void;
}

const noopLauncher: TourLauncher = { startTour: () => {} };

export const TourLauncherContext = createContext<TourLauncher>(noopLauncher);

export function useTourLauncher(): TourLauncher {
  return useContext(TourLauncherContext);
}
