"use client";

import { PuzzleForm } from "@/components/forms/puzzle-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export function PuzzleFormDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("puzzles.form");

  const handleSuccess = (data: { productId: string; instanceId: string }) => {
    toast.success(t("success.puzzleAdded"));
    setIsOpen(false);
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Puzzle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <PuzzleForm.Root onSuccess={handleSuccess} onCancel={handleCancel}>
          <DialogHeader>
            <PuzzleForm.Title />
          </DialogHeader>
          <div className="py-4">
            <PuzzleForm.Form />
          </div>
          <DialogFooter>
            <PuzzleForm.Actions />
          </DialogFooter>
        </PuzzleForm.Root>
      </DialogContent>
    </Dialog>
  );
}
