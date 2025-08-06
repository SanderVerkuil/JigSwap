"use client";

import { useParams } from "next/navigation";
import { PuzzleDetail } from "./_components/puzzle-detail";

export default function PuzzlePage() {
  const params = useParams();
  return <PuzzleDetail puzzleId={params.id as string} />;
}
