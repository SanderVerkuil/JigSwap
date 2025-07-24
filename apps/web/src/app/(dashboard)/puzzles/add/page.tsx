"use client";

import { api } from "@jigswap/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";

export default function AddPuzzlePage() {
  const router = useRouter();
  const createProduct = useMutation(api.puzzles.createPuzzleProduct);
  const createInstance = useMutation(api.puzzles.createPuzzleInstance);

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Add New Puzzle</h1>
          <p className="text-muted-foreground">
            Add a new puzzle to your collection. You can either search for an
            existing puzzle or create a new one.
          </p>
        </div>
      </div>
    </div>
  );
}
