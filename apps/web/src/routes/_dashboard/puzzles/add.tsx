import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useRouter } from "@/compat/navigation";
import { PuzzleForm, PuzzleFormData } from "@/components/forms/puzzle-form";
import {
  draftToFormDefaults,
  type ImportedDraft,
} from "@/components/puzzle-import/draft-to-form-defaults";
import { PuzzleImportBar } from "@/components/puzzle-import/puzzle-import-bar";
import { gateway } from "@/gateway";
import { useAction, useMutation } from "convex/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/puzzles/add")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "addPuzzle") }],
  }),
  component: AddPuzzlePage,
});

function AddPuzzlePage() {
  const router = useRouter();
  const createPuzzle = useMutation(gateway.catalog.createPuzzle);
  const generateUploadUrl = useMutation(gateway.library.generateUploadUrl);
  const importImage = useAction(gateway.catalog.importPuzzleImage);
  const t = useTranslations("puzzles");
  const [isPending, startTransition] = useTransition();

  const [defaults, setDefaults] = useState<PuzzleFormData | undefined>(
    undefined,
  );
  const [importKey, setImportKey] = useState(0);
  const [importedImageUrl, setImportedImageUrl] = useState<string | undefined>(
    undefined,
  );

  const applyDraft = (draft: ImportedDraft) => {
    setDefaults(draftToFormDefaults(draft));
    setImportedImageUrl(draft.imageUrl);
    setImportKey((k) => k + 1);
  };

  const handleSubmit = async (data: PuzzleFormData) => {
    startTransition(async () => {
      try {
        console.log("Creating puzzle");
        const storageId = await (async () => {
          if (data.image instanceof File) {
            const imageUrl = await generateUploadUrl();
            const result = await fetch(imageUrl, {
              method: "POST",
              headers: { "Content-Type": data.image.type },
              body: data.image,
            });
            const { storageId } = await result.json();
            return storageId;
          } else if (importedImageUrl) {
            try {
              return await importImage({ url: importedImageUrl });
            } catch {
              return undefined;
            }
          } else {
            return undefined;
          }
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

        <PuzzleImportBar
          onDraft={applyDraft}
          onMatch={(match) =>
            router.push(`/my-puzzles/add?puzzleId=${match.puzzleId}`)
          }
        />

        <PuzzleForm
          key={importKey}
          defaultValues={defaults}
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
