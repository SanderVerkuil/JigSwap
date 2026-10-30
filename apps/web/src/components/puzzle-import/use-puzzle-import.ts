import { gateway } from "@/gateway";
import { rateLimitedRetryAt } from "@/lib/convex-error-code";
import { useConvexAction } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ImportedDraft } from "./draft-to-form-defaults";

export interface ImportedMatch {
  puzzleId: string;
  aggregateId?: string;
  title: string;
  brand?: string;
  pieceCount: number;
  imageUrl?: string;
}

// Kept as an explicit state machine (busy-state rule v2 exemption): the exported
// ImportState carries draft/match result data and maps a non-throwing
// result.ok === false to 'error', which a derived useMutation mapping would not simplify.
// An error's reason is "rateLimited" when the server refused the member for importing too
// many pages (catalog/extractFromUrl's RateLimited), with when they can try again; else "failed".
export type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; reason: "failed" }
  | { status: "error"; reason: "rateLimited"; retryAt: number }
  | { status: "ready"; draft: ImportedDraft; match: ImportedMatch | null };

export const usePuzzleImport = () => {
  const extract = useMutation({
    mutationFn: useConvexAction(gateway.catalog.extractPuzzleFromUrl),
  });
  const [state, setState] = useState<ImportState>({ status: "idle" });

  const run = async (url: string) => {
    setState({ status: "loading" });
    try {
      const result = await extract.mutateAsync({ url });
      if (!result.ok) {
        setState({ status: "error", reason: "failed" });
        return;
      }
      setState({ status: "ready", draft: result.draft, match: result.match });
    } catch (error) {
      const retryAt = rateLimitedRetryAt(error, Date.now());
      setState(
        retryAt === undefined
          ? { status: "error", reason: "failed" }
          : { status: "error", reason: "rateLimited", retryAt },
      );
    }
  };

  const reset = () => setState({ status: "idle" });

  return { state, run, reset };
};
