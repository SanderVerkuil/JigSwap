import { PuzzleProductDetail } from "./_components/puzzle-product-detail";

interface PuzzleProductPageProps {
  params: {
    id: string;
  };
}

export default function PuzzleProductPage({ params }: PuzzleProductPageProps) {
  return <PuzzleProductDetail productId={params.id} />;
}
