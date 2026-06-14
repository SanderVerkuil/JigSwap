"use client";

import { createContext, ReactNode, useContext } from "react";

type ViewMode = "grid" | "list";

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
