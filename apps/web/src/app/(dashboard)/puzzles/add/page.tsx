"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export default function AddPuzzlePage() {
  const router = useRouter();
  const t = useTranslations("puzzles");

  const handleSuccess = () => {
    router.push("/puzzles");
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("addPuzzle")}</h1>
          <p className="text-muted-foreground">{t("addPuzzleDescription")}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("basicInformation")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PuzzleForm
            id="add-puzzle-form"
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </CardContent>
      </Card>
    </div>
  );
}
