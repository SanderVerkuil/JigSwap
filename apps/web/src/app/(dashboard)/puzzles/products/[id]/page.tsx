"use client";

import { useParams } from "next/navigation";
import { PuzzleProductDetail } from "./_components/puzzle-product-detail";

export default function PuzzleProductPage() {
  const params = useParams();
  return <PuzzleProductDetail productId={params.id as string} />;
}
