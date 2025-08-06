"use client";

import { useParams } from "next/navigation";
import { PuzzleProductDetail } from "./_components/puzzle-product-detail";

export default function PuzzleProductPage() {
  const params = useParams();
  return <PuzzleProductDetail puzzleId={params.id as string} />;
}
