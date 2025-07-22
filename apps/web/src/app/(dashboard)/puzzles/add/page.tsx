"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        <PuzzleForm.Title />
      </div>
      <PuzzleForm.Root onSuccess={handleSuccess} onCancel={handleCancel}>
        <Card>
          <CardHeader>
            <CardTitle>{t("basicInformation")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PuzzleForm.Form />
          </CardContent>
          <CardFooter>
            <PuzzleForm.Actions />
          </CardFooter>
        </Card>
      </PuzzleForm.Root>
    </div>
  );
}
