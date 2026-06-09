"use client";

import { createContext, ReactNode, useContext } from "react";

interface PuzzleViewContextType {
  viewMode: "grid" | "list";
}

const PuzzleViewContext = createContext<PuzzleViewContextType | undefined>(
  undefined,
);

interface PuzzleViewProviderProps {
  viewMode: "grid" | "list";
  children: ReactNode;
}

export function PuzzleViewProvider({
  viewMode,
  children,
}: PuzzleViewProviderProps) {
  return (
    <PuzzleViewContext.Provider value={{ viewMode }}>
      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            : "space-y-4"
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
