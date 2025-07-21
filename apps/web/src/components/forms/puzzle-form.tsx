"use client";

import { useUser } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Plus, X } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import {
  puzzleFormDefaultValues,
  puzzleFormSchema,
  type PuzzleFormData,
} from "./puzzle-form-schema";

// Common puzzle piece counts
const COMMON_PIECE_COUNTS = [
  { value: "500", label: "500 pieces" },
  { value: "1000", label: "1000 pieces" },
  { value: "1500", label: "1500 pieces" },
  { value: "2000", label: "2000 pieces" },
  { value: "3000", label: "3000 pieces" },
  { value: "4000", label: "4000 pieces" },
  { value: "5000", label: "5000 pieces" },
  { value: "custom", label: "Custom amount" },
];

interface PuzzleFormProps {
  id: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
}

export function PuzzleForm({
  id,
  onSuccess,
  onCancel,
  defaultValues = puzzleFormDefaultValues,
}: PuzzleFormProps) {
  const { user } = useUser();
  const createPuzzle = useMutation(api.puzzles.createPuzzle);

  // Get the current user from the database
  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  // Get admin categories
  const categories = useQuery(api.adminCategories.getActiveAdminCategories);

  const form = useForm<PuzzleFormData>({
    resolver: zodResolver(puzzleFormSchema),
    defaultValues,
  });

  // State for custom piece count input
  const [showCustomPieceCount, setShowCustomPieceCount] = React.useState(false);
  const [customPieceCount, setCustomPieceCount] = React.useState(
    defaultValues.pieceCount?.toString() || "",
  );

  // Initialize custom piece count state based on default values
  React.useEffect(() => {
    const currentValue = defaultValues.pieceCount;
    if (currentValue) {
      const isCommonValue = COMMON_PIECE_COUNTS.some(
        (option) => parseInt(option.value) === currentValue,
      );
      if (!isCommonValue) {
        setShowCustomPieceCount(true);
        setCustomPieceCount(currentValue.toString());
      }
    }
  }, [defaultValues.pieceCount]);

  // Handle piece count selection
  const handlePieceCountChange = (value: string) => {
    if (value === "custom") {
      setShowCustomPieceCount(true);
      // Don't reset to 0, keep the current value if it exists
      if (!customPieceCount) {
        form.setValue("pieceCount", 0);
      }
    } else {
      setShowCustomPieceCount(false);
      form.setValue("pieceCount", parseInt(value));
    }
  };

  // Handle custom piece count input
  const handleCustomPieceCountChange = (value: string) => {
    setCustomPieceCount(value);
    const numValue = parseInt(value) || 0;
    form.setValue("pieceCount", numValue);
  };

  // Get the current piece count value for the select
  const getCurrentPieceCountValue = () => {
    const currentValue = form.watch("pieceCount");
    if (showCustomPieceCount) {
      return "custom";
    }
    const commonValue = COMMON_PIECE_COUNTS.find(
      (option) => parseInt(option.value) === currentValue,
    );
    return commonValue ? commonValue.value : "custom";
  };

  const onSubmit = async (data: PuzzleFormData) => {
    if (!convexUser) {
      toast.error("User not found");
      return;
    }

    try {
      // Convert category string to ID if it's a valid category ID
      const categoryId =
        data.category && categories?.find((cat) => cat._id === data.category)
          ? (data.category as Id<"adminCategories">)
          : undefined;

      await createPuzzle({
        ...data,
        category: categoryId,
        ownerId: convexUser._id,
      });

      toast.success("Puzzle created successfully!");
      onSuccess?.();
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      toast.error("Failed to create puzzle");
    }
  };

  const [tags, setTags] = React.useState<string[]>(defaultValues.tags || []);
  const [newTag, setNewTag] = React.useState("");

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      const updatedTags = [...tags, newTag.trim()];
      setTags(updatedTags);
      form.setValue("tags", updatedTags);
      setNewTag("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    const updatedTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(updatedTags);
    form.setValue("tags", updatedTags);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <Form {...form}>
      <form
        id={id}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
      >
        {/* Basic Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Basic Information</h3>

          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title *</FormLabel>
                <FormControl>
                  <Input placeholder="Enter puzzle title" {...field} />
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
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe your puzzle..."
                    className="min-h-[100px]"
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
                  <FormLabel>Brand</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Ravensburger, Buffalo Games"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pieceCount"
              render={() => (
                <FormItem>
                  <FormLabel>Piece Count *</FormLabel>
                  <div className="space-y-2">
                    <Select
                      value={getCurrentPieceCountValue()}
                      onValueChange={handlePieceCountChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select piece count" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COMMON_PIECE_COUNTS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {showCustomPieceCount && (
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Enter custom piece count"
                          value={customPieceCount}
                          onChange={(e) =>
                            handleCustomPieceCountChange(e.target.value)
                          }
                          min="1"
                        />
                      </FormControl>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Puzzle Details */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Puzzle Details</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="difficulty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Difficulty</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select difficulty" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                      <SelectItem value="expert">Expert</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="condition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Condition *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="excellent">Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
                    </SelectContent>
                  </Select>
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
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories?.map((category) => (
                        <SelectItem key={category._id} value={category._id}>
                          {category.name.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormItem>
            <FormLabel>Tags</FormLabel>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Add a tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTag}
                  disabled={!newTag.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FormItem>
        </div>

        {/* Images */}
        {/* <div className="space-y-4">
          <h3 className="text-lg font-semibold">Images</h3>
          <FormField
            control={form.control}
            name="images"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Images *</FormLabel>
                <FormControl>
                  <Input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => {
                      // TODO: Implement image upload logic
                      // For now, we'll just set placeholder URLs
                      const files = Array.from(e.target.files || []);
                      const imageUrls = files.map((file) =>
                        URL.createObjectURL(file),
                      );
                      field.onChange(imageUrls);
                    }}
                  />
                </FormControl>
                <FormDescription>
                  Upload images of your puzzle. At least one image is required.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div> */}

        {/* Additional Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Additional Information</h3>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Any additional notes about your puzzle..."
                    className="min-h-[100px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center space-x-2">
            <FormField
              control={form.control}
              name="isCompleted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Mark as completed</FormLabel>
                    <FormDescription>
                      Check this if you have completed this puzzle
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating..." : "Create Puzzle"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
