"use client";

import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Edit, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

// Collection detail view DTO this header renders, derived from the read it is fed by.
type CollectionData = NonNullable<
  FunctionReturnType<typeof gateway.collections.byId>
>;

interface CollectionDetailHeaderProps {
  collection: CollectionData;
  onEdit?: () => void;
  onAddPuzzles?: () => void;
}

export function CollectionDetailHeader({
  collection,
  onEdit,
  onAddPuzzles,
}: CollectionDetailHeaderProps) {
  const t = useTranslations("collections");

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-lg flex items-center justify-center text-2xl"
          style={{
            backgroundColor: collection.color || "#f3f4f6",
          }}
        >
          {collection.icon || "📦"}
        </div>
        <div>
          <h1 className="text-3xl font-bold">{collection.name}</h1>
          <p className="text-muted-foreground">
            {collection.puzzles?.length || 0} {t("puzzles")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onEdit && (
          <Button variant="outline" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
        {onAddPuzzles && (
          <Button onClick={onAddPuzzles}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addPuzzles")}
          </Button>
        )}
      </div>
    </div>
  );
}
