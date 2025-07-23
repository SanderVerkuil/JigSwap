"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function AddPuzzlePage() {
  const router = useRouter();
  const t = useTranslations("puzzles.form");

  const handleSuccess = (data: { productId: string; instanceId: string }) => {
    toast.success(t("success.puzzleAdded"));
    router.push("/puzzles");
  };

  const handleCancel = () => {
    router.push("/puzzles");
  };

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-2xl mx-auto">
        <PuzzleForm.Root onSuccess={handleSuccess} onCancel={handleCancel}>
          <Card>
            <CardHeader>
              <PuzzleForm.Title />
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
    </div>
  );
}
