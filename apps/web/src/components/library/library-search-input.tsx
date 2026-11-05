"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

// Wait this long after the last keystroke before writing the search to the URL: the list follows
// the URL, and browsers throttle rapid history.replaceState calls.
export const SEARCH_COMMIT_DELAY_MS = 250;

// A search box whose committed value lives elsewhere (My Puzzles keeps it in the URL). Typing edits
// a local draft at once and commits it, trimmed, after a short pause. When `value` changes from
// outside (Show all, a nav link back to the bare page) the draft follows it; the echo of the
// box's own commit never overwrites what the member has typed since.
export function LibrarySearchInput({
  value,
  onCommit,
  label,
  placeholder,
  maxLength,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  placeholder: string;
  maxLength?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // The last `value` seen, and the last value this box committed or adopted.
  const [seen, setSeen] = useState(value);
  const [written, setWritten] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== written) {
      setDraft(value);
      setWritten(value);
    }
  }

  const commit = useEffectEvent((next: string) => {
    setWritten(next);
    onCommit(next);
  });
  useEffect(() => {
    const next = draft.trim();
    if (next === written) return;
    const handle = setTimeout(() => commit(next), SEARCH_COMMIT_DELAY_MS);
    return () => clearTimeout(handle);
  }, [draft, written]);

  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9 pointer-coarse:min-h-11"
      />
    </div>
  );
}
