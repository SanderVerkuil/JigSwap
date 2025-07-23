"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Check, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormContext } from "react-hook-form";

interface PuzzleProduct {
  _id: Id<"puzzleProducts">;
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  description?: string;
  tags?: string[];
}

interface ProductSearchStepProps {
  onProductSelected: (product: PuzzleProduct) => void;
  onCreateNew: () => void;
}

export function ProductSearchStep({
  onProductSelected,
  onCreateNew,
}: ProductSearchStepProps) {
  const t = useTranslations("puzzles.form.search");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<PuzzleProduct | null>(
    null,
  );

  const { setValue } = useFormContext();

  const suggestions = useQuery(
    api.puzzles.getPuzzleProductSuggestions,
    searchTerm.length > 0 ? { searchTerm, limit: 5 } : "skip",
  );

  const handleProductSelect = (product: PuzzleProduct) => {
    setSelectedProduct(product);
    setValue("productId", product._id);
    onProductSelected(product);
  };

  const handleCreateNew = () => {
    setValue("productId", null);
    onCreateNew();
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">{t("title")}</h2>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {suggestions && suggestions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("suggestions")}
            </h3>
            {suggestions.map((product) => (
              <Card
                key={product._id}
                className={`cursor-pointer transition-colors hover:bg-accent ${
                  selectedProduct?._id === product._id
                    ? "ring-2 ring-primary"
                    : ""
                }`}
                onClick={() => handleProductSelect(product)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{product.title}</h4>
                        {product.brand && (
                          <Badge variant="secondary" className="text-xs">
                            {product.brand}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{product.pieceCount} pieces</span>
                        {product.difficulty && (
                          <Badge variant="outline" className="text-xs">
                            {product.difficulty}
                          </Badge>
                        )}
                      </div>
                      {product.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>
                    {selectedProduct?._id === product._id && (
                      <Check className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {searchTerm && suggestions && suggestions.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              {t("noResultsFound", { searchTerm })}
            </p>
            <Button onClick={handleCreateNew} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              {t("createNewPuzzle")}
            </Button>
          </div>
        )}

        {!searchTerm && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">{t("startTyping")}</p>
            <Button onClick={handleCreateNew} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              {t("createNewPuzzle")}
            </Button>
          </div>
        )}
      </div>

      {selectedProduct && (
        <div className="bg-accent/50 rounded-lg p-4">
          <h3 className="font-medium mb-2">{t("selectedPuzzle")}</h3>
          <div className="flex items-center gap-2">
            <span className="font-medium">{selectedProduct.title}</span>
            {selectedProduct.brand && (
              <Badge variant="secondary">{selectedProduct.brand}</Badge>
            )}
            <Badge variant="outline">{selectedProduct.pieceCount} pieces</Badge>
          </div>
        </div>
      )}
    </div>
  );
}
