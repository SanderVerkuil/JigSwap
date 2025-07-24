"use client";

import {
  PuzzleProductForm,
  PuzzleProductFormData,
} from "@/components/forms/puzzle-product-form";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export default function AddPuzzleProductPage() {
  const router = useRouter();
  const createProduct = useMutation(api.puzzles.createPuzzleProduct);
  const generateUploadUrl = useMutation(api.puzzles.generateUploadUrl);
  const t = useTranslations("puzzles");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (data: PuzzleProductFormData) => {
    startTransition(async () => {
      try {
        console.log("Creating product");
        const storageId = await (async () => {
          if (!(data.image instanceof File)) {
            return undefined;
          }
          const imageUrl = await generateUploadUrl();
          const result = await fetch(imageUrl, {
            method: "POST",
            headers: { "Content-Type": data.image.type },
            body: data.image,
          });
          const { storageId } = await result.json();
          return storageId;
        })();
        await createProduct({
          title: data.title,
          description: data.description,
          brand: data.brand,
          pieceCount: data.pieceCount,
          difficulty: data.difficulty,
          category: data.category as Id<"adminCategories">,
          tags: data.tags,
          image: storageId,
        });

        toast.success("Puzzle product created successfully!");
        router.push("/puzzles/products");
      } catch (error) {
        console.error("Failed to create puzzle product:", error);
        toast.error("Failed to create puzzle product. Please try again.");
      }
    });
  };

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{t("addPuzzle")}</h1>
          <p className="text-muted-foreground">{t("addPuzzleDescription")}</p>
        </div>

        <PuzzleProductForm
          onSubmit={handleSubmit}
          onCancel={() => router.push("/puzzles/products")}
          pending={isPending}
        >
          <PuzzleProductForm.Content />
          <PuzzleProductForm.Actions />
        </PuzzleProductForm>
      </div>
    </div>
  );
}
