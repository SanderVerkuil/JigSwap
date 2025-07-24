"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import { PuzzleFormData } from "@/components/forms/puzzle-form/puzzle-form-schema";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function AddPuzzlePage() {
  const router = useRouter();
  const createProduct = useMutation(api.puzzles.createPuzzleProduct);
  const createInstance = useMutation(api.puzzles.createPuzzleInstance);

  const handleSubmit = async (data: PuzzleFormData) => {
    try {
      let productId: string;

      // Step 1: Create or get product
      if (data.product.createNewProduct) {
        // Create new product
        productId = await createProduct({
          title: data.product.title,
          description: data.product.description,
          brand: data.product.brand,
          pieceCount: data.product.pieceCount,
          difficulty: data.product.difficulty,
          category: data.product.category as any, // Type assertion for Convex ID
          tags: data.product.tags,
          images: data.product.images,
        });
      } else if (data.product.selectedProductId) {
        // Use existing product
        productId = data.product.selectedProductId;
      } else {
        throw new Error("No product selected or created");
      }

      // Step 2: Create puzzle instance
      await createInstance({
        productId: productId as any, // Type assertion needed for Convex ID
        condition: data.instance.condition,
        isAvailable: data.instance.isAvailable,
        acquisitionDate: data.instance.acquisitionDate,
        notes: data.instance.notes,
      });

      toast.success("Puzzle created successfully!");
      router.push("/puzzles");
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      toast.error("Failed to create puzzle. Please try again.");
    }
  };

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

        <PuzzleForm onSubmit={handleSubmit} onCancel={() => router.back()}>
          <PuzzleForm.Content />
          <PuzzleForm.Actions onCancel={() => router.back()} />
        </PuzzleForm>
      </div>
    </div>
  );
}
