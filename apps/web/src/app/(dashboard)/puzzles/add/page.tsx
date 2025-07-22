"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";

export default function AddPuzzlePage() {
  const router = useRouter();

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
          <h1 className="text-3xl font-bold">Add New Puzzle</h1>
          <p className="text-muted-foreground">
            Add a new puzzle to your collection
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Puzzle Details</CardTitle>
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
