"use client";

import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Edit, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

// Collection detail view DTO this component renders, derived from the read it is fed by.
type CollectionData = NonNullable<
  FunctionReturnType<typeof gateway.collections.byId>
>;

interface CollectionDetailActionsProps {
  collection: CollectionData;
  onEdit?: () => void;
  onAddPuzzles?: () => void;
}

export function CollectionDetailActions({
  onEdit,
  onAddPuzzles,
}: CollectionDetailActionsProps) {
  const t = useTranslations("collections");

  return (
    <div className="flex items-center justify-end space-x-2 pt-6">
      {onEdit && (
        <Button variant="outline" onClick={onEdit}>
          <Edit className="h-4 w-4 mr-2" />
          Edit Collection
        </Button>
      )}
      {onAddPuzzles && (
        <Button onClick={onAddPuzzles}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addPuzzles")}
        </Button>
      )}
    </div>
  );
}
