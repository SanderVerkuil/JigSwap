import { createFileRoute } from "@tanstack/react-router";

import { PuzzleForm, PuzzleFormData } from "@/components/forms/puzzle-form";
import { useRouter } from "@/compat/navigation";
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { useTranslations } from "use-intl";
import { useTransition } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_dashboard/puzzles/add")({
  component: AddPuzzlePage,
});

function AddPuzzlePage() {
  const router = useRouter();
  const createPuzzle = useMutation(gateway.catalog.createPuzzle);
  const generateUploadUrl = useMutation(gateway.library.generateUploadUrl);
  const t = useTranslations("puzzles");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (data: PuzzleFormData) => {
    startTransition(async () => {
      try {
        console.log("Creating puzzle");
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
        await createPuzzle({
          title: data.title,
          description: data.description,
          brand: data.brand,
          artist: data.artist,
          series: data.series,
          pieceCount: data.pieceCount,
          difficulty: data.difficulty,
          // The category is now a CatalogCategoryId aggregateId (string), not an adminCategories _id.
          category: data.category,
          tags: data.tags,
          ean: data.ean,
          upc: data.upc,
          modelNumber: data.modelNumber,
          dimensions: data.dimensions,
          shape: data.shape,
          image: storageId,
        });

        toast.success("Puzzle created successfully!");
        router.push("/puzzles");
      } catch (error) {
        console.error("Failed to create puzzle:", error);
        toast.error("Failed to create puzzle. Please try again.");
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

        <PuzzleForm
          onSubmit={handleSubmit}
          onCancel={() => router.push("/puzzles")}
          pending={isPending}
        >
          <PuzzleForm.Content />
          <PuzzleForm.Actions />
        </PuzzleForm>
      </div>
    </div>
  );
}
