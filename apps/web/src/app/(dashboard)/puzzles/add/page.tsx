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
    <div className="container mx-auto py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Add New Puzzle</h1>
          <p className="text-muted-foreground mt-2">
            Add a new puzzle to your collection
          </p>
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
    </div>
  );
}
