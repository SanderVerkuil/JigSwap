"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ArrowLeft, Calendar, Plus, Star, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface PuzzleProductDetailProps {
  productId: string;
}

export function PuzzleProductDetail({ productId }: PuzzleProductDetailProps) {
  const router = useRouter();
  const t = useTranslations("puzzles.products");
  const tPuzzles = useTranslations("puzzles");
  const tCommon = useTranslations("common");

  const product = useQuery(api.puzzles.getPuzzleProductById, {
    productId: productId as Id<"puzzles">,
  });

  const category = useQuery(
    api.adminCategories.getAdminCategoryById,
    product !== undefined && product !== null && product.category !== undefined
      ? { id: product?.category as Id<"adminCategories"> }
      : "skip",
  );

  if (product === null) {
    return <h1>Product not found</h1>;
  }

  if (
    product === undefined ||
    (product.category !== undefined && category === undefined)
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (product === null) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold mb-4">{t("notFound")}</h2>
        <Button onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tCommon("back")}
        </Button>
      </div>
    );
  }

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return "bg-green-100 text-green-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "hard":
        return "bg-orange-100 text-orange-800";
      case "expert":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getDifficultyLabel = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return t("difficulty.easy");
      case "medium":
        return t("difficulty.medium");
      case "hard":
        return t("difficulty.hard");
      case "expert":
        return t("difficulty.expert");
      default:
        return t("difficulty.unknown");
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" asChild>
          <Link href="/puzzles/products">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {tCommon("back")}
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{product.title}</h1>
          {product.brand && (
            <p className="text-lg text-muted-foreground">{product.brand}</p>
          )}
        </div>
        <Button asChild>
          <Link href={`/puzzles/add?productId=${productId}`}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addPuzzle")}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Product Image */}
          {product.image ? (
            <Card>
              <CardContent className="p-6">
                <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                  <Image
                    src={product.image}
                    alt={product.title ?? ""}
                    className="w-full h-full object-contain"
                    width={512}
                    height={512}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="text-muted-foreground">
                  <div className="text-6xl mb-4">🧩</div>
                  <div className="text-lg">{t("noImage")}</div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Description */}
          {product.description && (
            <Card>
              <CardHeader>
                <CardTitle>{tPuzzles("description")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">
                  {product.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {product.tags && product.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="h-5 w-5" />
                  {tPuzzles("tags")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {product.tags.map((tag, index) => (
                    <Badge key={index} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Product Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t("productDetails")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-medium">{tPuzzles("pieceCount")}</span>
                <span>
                  {product.pieceCount} {tPuzzles("pieces")}
                </span>
              </div>

              {product.difficulty && (
                <div className="flex justify-between items-center">
                  <span className="font-medium">{tPuzzles("difficulty")}</span>
                  <Badge
                    variant="secondary"
                    className={getDifficultyColor(product.difficulty)}
                  >
                    {getDifficultyLabel(product.difficulty)}
                  </Badge>
                </div>
              )}

              {product.category && (
                <div className="flex justify-between items-center">
                  <span className="font-medium">{tPuzzles("category")}</span>
                  <span>{category?.name.en}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {t("metadata")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-medium">{t("created")}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(product.createdAt ?? 0)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="font-medium">{t("updated")}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(product.updatedAt ?? 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("actions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full">
                <Link href={`/puzzles/add?productId=${productId}`}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("addPuzzle")}
                </Link>
              </Button>

              <Button variant="outline" className="w-full">
                <Star className="h-4 w-4 mr-2" />
                {t("addToFavorites")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
