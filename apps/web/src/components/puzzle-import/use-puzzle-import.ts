import { gateway } from "@/gateway";
import { useAction } from "convex/react";
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

export type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; draft: ImportedDraft; match: ImportedMatch | null };

export const usePuzzleImport = () => {
  const extract = useAction(gateway.catalog.extractPuzzleFromUrl);
  const [state, setState] = useState<ImportState>({ status: "idle" });

  const run = async (url: string) => {
    setState({ status: "loading" });
    try {
      const result = await extract({ url });
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
