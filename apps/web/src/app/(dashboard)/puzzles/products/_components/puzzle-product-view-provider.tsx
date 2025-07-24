"use client";

import { createContext, ReactNode, useContext } from "react";

interface PuzzleProductViewContextType {
  viewMode: "grid" | "list";
}

const PuzzleProductViewContext = createContext<
  PuzzleProductViewContextType | undefined
>(undefined);

interface PuzzleProductViewProviderProps {
  viewMode: "grid" | "list";
  children: ReactNode;
}

export function PuzzleProductViewProvider({
  viewMode,
  children,
}: PuzzleProductViewProviderProps) {
  return (
    <PuzzleProductViewContext.Provider value={{ viewMode }}>
      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            : "space-y-4"
        }
      >
        {children}
      </div>
    </PuzzleProductViewContext.Provider>
  );
}

export function usePuzzleProductView() {
  const context = useContext(PuzzleProductViewContext);
  if (context === undefined) {
    throw new Error(
      "usePuzzleProductView must be used within a PuzzleProductViewProvider",
    );
  }
  return context;
}
