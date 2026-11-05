"use client";

import { createContext, ReactNode, useContext } from "react";

type ViewMode = "grid" | "list";

/**
 * `sizes` for a card cover in the default grid below (auto-fill, 212px minimum, 18px gaps). The
 * column width depends on the container (shell padding, sidebar), not the viewport alone, so:
 * `auto` lets browsers that support it use the cover's laid-out width (lazy images only, which
 * the cards' covers are); the rest is an upper bound for the others. With two or more columns no
 * column is wider than ~327px (just short of a third 212px column); only a phone-width container
 * leaves one full-width column. Over-estimating only costs bytes, under-estimating blurs, so keep
 * the fallback an upper bound and in step with the grid class.
 */
export const PUZZLE_GRID_COVER_SIZES = "auto, (max-width: 499px) 100vw, 330px";

interface PuzzleViewContextType {
  viewMode: ViewMode;
}

const PuzzleViewContext = createContext<PuzzleViewContextType | undefined>(
  undefined,
);

interface PuzzleViewProviderProps {
  viewMode: ViewMode;
  children: ReactNode;
  /** Optional override of the wrapper layout classes (e.g. an auto-fill grid). */
  className?: string;
}

export function PuzzleViewProvider({
  viewMode,
  children,
  className,
}: PuzzleViewProviderProps) {
  return (
    <PuzzleViewContext.Provider value={{ viewMode }}>
      <div
        className={
          className ??
          (viewMode === "grid"
            ? // Design-language puzzle grid: compact covers that auto-fill the
              // row at a 212px minimum, instead of fixed breakpoint columns.
              "grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-[18px]"
            : "space-y-4")
        }
      >
        {children}
      </div>
    </PuzzleViewContext.Provider>
  );
}

export function usePuzzleView() {
  const context = useContext(PuzzleViewContext);
  if (context === undefined) {
    throw new Error("usePuzzleView must be used within a PuzzleViewProvider");
  }
  return context;
}
