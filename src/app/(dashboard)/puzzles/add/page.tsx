"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, X } from "lucide-react";

export default function AddPuzzlePage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    brand: "",
    pieceCount: "",
    difficulty: "",
    condition: "",
    category: "",
    tags: "",
    images: [] as string[],
    isCompleted: false,
    completedDate: "",
    acquisitionDate: "",
    notes: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const convexUser = useQuery(api.users.getUserByClerkId, 
    user?.id ? { clerkId: user.id } : "skip"
  );

  const createPuzzle = useMutation(api.puzzles.createPuzzle);

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleTagsChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      tags: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convexUser?._id) return;

    setIsSubmitting(true);
    try {
      const tagsArray = formData.tags
        .split(",")
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      await createPuzzle({
        title: formData.title,
        description: formData.description || undefined,
        brand: formData.brand || undefined,
        pieceCount: parseInt(formData.pieceCount),
        difficulty: formData.difficulty as any || undefined,
        condition: formData.condition as any,
        category: formData.category || undefined,
        tags: tagsArray.length > 0 ? tagsArray : undefined,
        images: formData.images,
        ownerId: convexUser._id,
        isCompleted: formData.isCompleted,
        completedDate: formData.completedDate ? new Date(formData.completedDate).getTime() : undefined,
        acquisitionDate: formData.acquisitionDate ? new Date(formData.acquisitionDate).getTime() : undefined,
        notes: formData.notes || undefined,
      });

      router.push("/puzzles");
    } catch (error) {
      console.error("Failed to create puzzle:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user || !convexUser) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{tCommon("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {tCommon("back")}
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{t("addPuzzle")}</h1>
          <p className="text-muted-foreground">{t("addPuzzleDescription")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t("basicInformation")}</CardTitle>
            <CardDescription>{t("basicInformationDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                {t("title")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={t("titlePlaceholder")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t("description")}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={t("descriptionPlaceholder")}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("brand")}
                </label>
                <input
                  type="text"
                  value={formData.brand}
                  onChange={(e) => handleInputChange("brand", e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={t("brandPlaceholder")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("pieceCount")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.pieceCount}
                  onChange={(e) => handleInputChange("pieceCount", e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="1000"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("difficulty")}
                </label>
                <select
                  value={formData.difficulty}
                  onChange={(e) => handleInputChange("difficulty", e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("selectDifficulty")}</option>
                  <option value="easy">{t("easy")}</option>
                  <option value="medium">{t("medium")}</option>
                  <option value="hard">{t("hard")}</option>
                  <option value="expert">{t("expert")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("condition")} <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={formData.condition}
                  onChange={(e) => handleInputChange("condition", e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("selectCondition")}</option>
                  <option value="excellent">{t("excellent")}</option>
                  <option value="good">{t("good")}</option>
                  <option value="fair">{t("fair")}</option>
                  <option value="poor">{t("poor")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t("category")}
              </label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => handleInputChange("category", e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={t("categoryPlaceholder")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t("tags")}
              </label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => handleTagsChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={t("tagsPlaceholder")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("tagsHelp")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Status Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t("statusInformation")}</CardTitle>
            <CardDescription>{t("statusInformationDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isCompleted"
                checked={formData.isCompleted}
                onChange={(e) => handleInputChange("isCompleted", e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="isCompleted" className="text-sm font-medium">
                {t("puzzleCompleted")}
              </label>
            </div>

            {formData.isCompleted && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("completedDate")}
                </label>
                <input
                  type="date"
                  value={formData.completedDate}
                  onChange={(e) => handleInputChange("completedDate", e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                {t("acquisitionDate")}
              </label>
              <input
                type="date"
                value={formData.acquisitionDate}
                onChange={(e) => handleInputChange("acquisitionDate", e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t("notes")}
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleInputChange("notes", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={t("notesPlaceholder")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit Buttons */}
        <div className="flex items-center justify-end gap-4">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => router.back()}
          >
            {tCommon("cancel")}
          </Button>
          <Button 
            type="submit" 
            disabled={isSubmitting || !formData.title || !formData.pieceCount || !formData.condition}
          >
            {isSubmitting ? tCommon("loading") : t("addPuzzle")}
          </Button>
        </div>
      </form>
    </div>
  );
}