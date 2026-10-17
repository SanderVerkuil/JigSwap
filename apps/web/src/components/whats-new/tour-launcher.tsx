"use client";

import { createContext, useContext } from "react";

// Seam for the tour runner. "Take the tour" buttons (entry cards, highlight modal) call
// `useTourLauncher().startTour(tourId, { returnFocus })`; the dashboard mounts `TourProvider`
// (components/tour) with the real runner. `returnFocus` is the element focus goes back to when the
// tour pauses or ends (the clicked button; null when it is about to unmount, as in the modal).
// A paused tour resumes at its saved step unless `restart` is set. Outside the provider the
// default is a no-op.
export interface TourLauncher {
  startTour: (
    tourId: string,
    options?: { returnFocus?: HTMLElement | null; restart?: boolean },
  ) => void;
}

const noopLauncher: TourLauncher = { startTour: () => {} };

export const TourLauncherContext = createContext<TourLauncher>(noopLauncher);

export function useTourLauncher(): TourLauncher {
  return useContext(TourLauncherContext);
}
