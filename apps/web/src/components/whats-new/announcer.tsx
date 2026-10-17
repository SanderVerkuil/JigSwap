"use client";

import { useState } from "react";
import { useTranslations } from "use-intl";
import { announcedCount } from "./logic";
import { useWhatsNewState } from "./use-whats-new-state";

// The single shell-level live region for the What's new badge (spec Part B §3.4). It speaks only
// when the unread count rises after it first loaded, so the badges (sidebar, quick sheet, user
// menu) are never read out on page load, on a route change, or after visiting /whats-new.
export function WhatsNewAnnouncer() {
  const t = useTranslations("whatsNew");
  const count = useWhatsNewState().unreadIds?.length;
  const [previous, setPrevious] = useState<number>();
  const [message, setMessage] = useState("");

  // Derive the message while rendering (React's "adjust state on prop change" pattern). Any other
  // change clears it, so a later rise to the same total is announced again.
  if (count !== previous) {
    const announced = announcedCount(previous, count);
    setPrevious(count);
    setMessage(announced === null ? "" : t("announce", { count: announced }));
  }

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
