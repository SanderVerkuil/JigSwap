"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { puzzleSchema, type PuzzleFormData, transformPuzzleData } from "@/lib/validations";

// Form input type (before validation transformation)
type PuzzleFormInputs = {
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  condition?: "excellent" | "good" | "fair" | "poor";
  category?: string;
  tags: string;
  isCompleted: boolean;
  completedDate?: string;
  acquisitionDate?: string;
  notes?: string;
};
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export default function AddPuzzlePage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const { addToast } = useToast();

  const convexUser = useQuery(api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip"
  );

  const createPuzzle = useMutation(api.puzzles.createPuzzle);

  const form = useForm<PuzzleFormInputs>({
    resolver: zodResolver(puzzleSchema),
    defaultValues: {
      title: "",
      description: "",
      brand: "",
      pieceCount: 1000,
      difficulty: undefined,
      condition: undefined,
      category: "",
      tags: "",
      isCompleted: false,
      completedDate: "",
      acquisitionDate: "",
      notes: "",
    },
  });

  const onSubmit = async (data: PuzzleFormInputs) => {
    if (!convexUser?._id) {
      addToast({
        type: "error",
        title: "Authentication Error",
        description: "Please sign in to add a puzzle.",
      });
      return;
    }

    try {
      // Validate and transform the data using the schema
      const validatedData = puzzleSchema.parse(data);
      const transformedData = transformPuzzleData(validatedData);
      
      await createPuzzle({
        ...transformedData,
        ownerId: convexUser._id,
        images: [], // Will be handled separately for file uploads
      });

      addToast({
        type: "success",
        title: "Puzzle Added",
        description: "Your puzzle has been successfully added to your collection.",
      });

      router.push("/puzzles");
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      addToast({
        type: "error",
        title: "Error",
        description: "Failed to add puzzle. Please try again.",
      });
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

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t("basicInformation")}</CardTitle>
              <CardDescription>{t("basicInformationDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("title")} <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={t("titlePlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("descriptionPlaceholder")}
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("brand")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("brandPlaceholder")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pieceCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("pieceCount")} <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="1000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="difficulty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("difficulty")}</FormLabel>
                      <FormControl>
                        <select
                          className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                          {...field}
                        >
                          <option value="">{t("selectDifficulty")}</option>
                          <option value="easy">{t("easy")}</option>
                          <option value="medium">{t("medium")}</option>
                          <option value="hard">{t("hard")}</option>
                          <option value="expert">{t("expert")}</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("condition")} <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <select
                          className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                          {...field}
                        >
                          <option value="">{t("selectCondition")}</option>
                          <option value="excellent">{t("excellent")}</option>
                          <option value="good">{t("good")}</option>
                          <option value="fair">{t("fair")}</option>
                          <option value="poor">{t("poor")}</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("category")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("categoryPlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tags")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("tagsPlaceholder")} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t("tagsHelp")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Status Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t("statusInformation")}</CardTitle>
              <CardDescription>{t("statusInformationDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="isCompleted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-medium">
                      {t("puzzleCompleted")}
                    </FormLabel>
                  </FormItem>
                )}
              />

              {form.watch("isCompleted") && (
                <FormField
                  control={form.control}
                  name="completedDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("completedDate")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="acquisitionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("acquisitionDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("notesPlaceholder")}
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? tCommon("loading") : t("addPuzzle")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}