import { gateway } from "@/gateway";
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
export type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
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
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", draft: result.draft, match: result.match });
    } catch {
      setState({ status: "error" });
    }
  };

  const reset = () => setState({ status: "idle" });

  return { state, run, reset };
};
