import { useEffect, useRef, useState } from "react";

/**
 * A search box whose term lives in the URL. The box edits a local draft so typing stays instant;
 * the trimmed term is written after a pause in typing (clearing is written at once). When the URL's
 * term changes for another reason (a nav link to the bare page, a shared link), the draft takes it
 * over, so the box never shows a term the results aren't filtered by. The page's own write landing
 * doesn't touch the draft, so characters typed meanwhile are kept.
 */
export function useUrlTextDraft(
  urlTerm: string | undefined,
  write: (term: string | undefined) => void,
  delayMs: number,
) {
  const [draft, setDraft] = useState(urlTerm ?? "");
  // The URL term the draft was last reconciled with, and the last term this box wrote.
  const [seen, setSeen] = useState(urlTerm);
  const [written, setWritten] = useState(urlTerm);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Adjusting state to a changed input while rendering (no effect): React re-renders at once.
  if (urlTerm !== seen) {
    setSeen(urlTerm);
    if (urlTerm !== written) {
      setDraft(urlTerm ?? "");
      setWritten(urlTerm);
    }
  }

  const change = (value: string) => {
    setDraft(value);
    clearTimeout(timer.current);
    const term = value.trim() || undefined;
    if (term === undefined) {
      setWritten(undefined);
      write(undefined);
      return;
    }
    timer.current = setTimeout(() => {
      setWritten(term);
      write(term);
    }, delayMs);
  };

  return { draft, change };
}
