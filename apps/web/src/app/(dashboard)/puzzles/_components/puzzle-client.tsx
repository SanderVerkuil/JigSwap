"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { api } from "@jigswap/backend/convex/_generated/api";
import { usePaginatedQuery } from "convex/react";
import { Filter, Grid, List, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PuzzleCard } from "./puzzle-card";
import { PuzzleFilters } from "./puzzle-filters";
import { PuzzleProductViewProvider } from "./puzzle-view-provider";

interface PuzzlesClientProps {
  className?: string;
}

export function PuzzlesClient({ className = "" }: PuzzlesClientProps) {
  const t = useTranslations("puzzles.products");
  const tCommon = useTranslations("common");
  const tBrowse = useTranslations("browse");

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    searchTerm: "",
    brand: "",
    minPieces: "",
    maxPieces: "",
    difficulty: "",
    category: "",
    tags: [] as string[],
  });

  const observerRef = useRef<HTMLDivElement>(null);

  // Use paginated query for infinite scroll
  const {
    results: products,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    api.puzzles.listAllpuzzles,
    {},
    { initialNumItems: 20 },
  );

  // Infinite scroll implementation
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && status === "CanLoadMore") {
        loadMore(20);
      }
    },
    [loadMore, status],
  );

  useEffect(() => {
    const element = observerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "20px",
      threshold: 0.1,
    });

    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver]);

  // Filter products based on current filters
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      !filters.searchTerm ||
      product.title.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      (product.description &&
        product.description
          .toLowerCase()
          .includes(filters.searchTerm.toLowerCase())) ||
      (product.brand &&
        product.brand.toLowerCase().includes(filters.searchTerm.toLowerCase()));

    const matchesBrand =
      !filters.brand ||
      (product.brand &&
        product.brand.toLowerCase().includes(filters.brand.toLowerCase()));

    const matchesMinPieces =
      !filters.minPieces || product.pieceCount >= parseInt(filters.minPieces);

    const matchesMaxPieces =
      !filters.maxPieces || product.pieceCount <= parseInt(filters.maxPieces);

    const matchesDifficulty =
      !filters.difficulty || product.difficulty === filters.difficulty;

    const matchesCategory =
      !filters.category || product.category === filters.category;

    const matchesTags =
      filters.tags.length === 0 ||
      (product.tags && filters.tags.some((tag) => product.tags!.includes(tag)));

    return (
      matchesSearch &&
      matchesBrand &&
      matchesMinPieces &&
      matchesMaxPieces &&
      matchesDifficulty &&
      matchesCategory &&
      matchesTags
    );
  });

  const clearFilters = () => {
    setFilters({
      searchTerm: "",
      brand: "",
      minPieces: "",
      maxPieces: "",
      difficulty: "",
      category: "",
      tags: [],
    });
  };

  const hasActiveFilters = Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== "",
  );

  if (isLoading && products.length === 0) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/puzzles/add">
          <Plus className="h-4 w-4 mr-2" />
          {t("addProduct")}
        </Link>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent>
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={filters.searchTerm}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    searchTerm: e.target.value,
                  }))
                }
                className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Filter Toggle */}
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              {t("filtersLabel")}
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                onClick={clearFilters}
                className="flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                {t("clearFilters")}
              </Button>
            )}
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <PuzzleFilters
              filters={filters}
              onFiltersChange={setFilters}
              className="mt-4"
            />
          )}
        </CardContent>
      </Card>

      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          {t("productsFound", { count: filteredProducts.length })}
        </div>
      </div>

      {/* Products Grid/List */}
      {filteredProducts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                {t("noProductsFound")}
              </h3>
              <p className="text-sm">{t("tryDifferentFilters")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PuzzleProductViewProvider viewMode={viewMode}>
          {filteredProducts.map((puzzle) => (
            <PuzzleCard key={puzzle._id} puzzle={puzzle} />
          ))}
        </PuzzleProductViewProvider>
      )}

      {/* Infinite Scroll Observer */}
      <div ref={observerRef} className="h-4" />

      {/* Loading More Indicator */}
      {status === "LoadingMore" && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      )}
    </div>
  );
}
