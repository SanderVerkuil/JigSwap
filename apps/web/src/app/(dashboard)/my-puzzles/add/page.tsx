"use client";

import { PuzzleForm, PuzzleFormData } from "@/components/forms/puzzle-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// Schema for the instance form
const instanceFormSchema = z.object({
  condition: z.enum(["new_sealed", "like_new", "good", "fair", "poor"]),
  availability: z.object({
    forTrade: z.boolean(),
    forSale: z.boolean(),
    forLend: z.boolean(),
  }),
  acquisitionDate: z.string().optional(),
  notes: z
    .string()
    .max(1000, "Notes must be less than 1000 characters")
    .optional(),
});

type InstanceFormData = z.infer<typeof instanceFormSchema>;

export default function AddPuzzlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedPuzzle, setSelectedPuzzle] = useState<{
    _id: Id<"puzzles">;
    title: string;
    brand?: string;
    pieceCount: number;
    image?: string | null;
  } | null>(null);
  const [createPuzzleOpen, setCreatePuzzleOpen] = useState(false);
  const [isCreatingPuzzle, setIsCreatingPuzzle] = useState(false);
  const [isCreatingOwnedPuzzle, setIsCreatingOwnedPuzzle] = useState(false);

  const createInstance = useMutation(api.puzzles.createOwnedPuzzle);
  const createPuzzle = useMutation(api.puzzles.createPuzzle);
  const generateUploadUrl = useMutation(api.puzzles.generateUploadUrl);

  // Get puzzle suggestions based on search
  const puzzleSuggestions = useQuery(
    api.puzzles.getPuzzleSuggestions,
    searchValue.length > 0 ? { searchTerm: searchValue, limit: 10 } : "skip",
  );

  // Check if there's a puzzleId in URL params
  const puzzleIdFromUrl = searchParams.get("puzzleId") as Id<"puzzles"> | null;

  // If puzzleId is provided, fetch that specific puzzle
  const specificPuzzle = useQuery(
    api.puzzles.getPuzzleById,
    puzzleIdFromUrl ? { puzzleId: puzzleIdFromUrl } : "skip",
  );

  // Set selected puzzle from URL if available
  useEffect(() => {
    if (puzzleIdFromUrl && specificPuzzle && !selectedPuzzle) {
      setSelectedPuzzle({
        _id: specificPuzzle._id,
        title: specificPuzzle.title,
        brand: specificPuzzle.brand,
        pieceCount: specificPuzzle.pieceCount,
        image: specificPuzzle.image ?? undefined,
      });
    }
  }, [puzzleIdFromUrl, specificPuzzle, selectedPuzzle]);

  const instanceForm = useForm<InstanceFormData>({
    resolver: zodResolver(instanceFormSchema),
    defaultValues: {
      condition: "good",
      availability: {
        forTrade: true,
        forSale: true,
        forLend: true,
      },
    },
  });

  const handlePuzzleSelect = (puzzle: {
    _id: Id<"puzzles">;
    title: string;
    brand?: string;
    pieceCount: number;
    image?: string | null;
  }) => {
    setSelectedPuzzle(puzzle);
    setSearchOpen(false);
    setSearchValue(puzzle.title);
  };

  const handleCreatePuzzle = async (data: PuzzleFormData) => {
    setIsCreatingPuzzle(true);
    try {
      // Handle image upload if provided
      let imageId: Id<"_storage"> | undefined;
      if (data.image) {
        const uploadUrl = await generateUploadUrl();
        const uploadResult = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": data.image.type },
          body: data.image,
        });
        if (!uploadResult.ok) throw new Error("Failed to upload image");
        imageId = await uploadResult.json();
      }

      const puzzleId = await createPuzzle({
        title: data.title,
        description: data.description,
        brand: data.brand,
        pieceCount: data.pieceCount,
        difficulty: data.difficulty,
        category: data.category as Id<"adminCategories"> | undefined,
        tags: data.tags,
        image: imageId,
      });

      // Set the newly created puzzle as selected
      setSelectedPuzzle({
        _id: puzzleId,
        title: data.title,
        brand: data.brand,
        pieceCount: data.pieceCount,
        image: imageId,
      });
      setSearchValue(data.title);
      setCreatePuzzleOpen(false);
      toast.success(t("puzzleCreated"));
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      toast.error(t("puzzleCreationFailed"));
    } finally {
      setIsCreatingPuzzle(false);
    }
  };

  const handleCreateInstance = async (data: InstanceFormData) => {
    if (!selectedPuzzle) {
      toast.error(t("noPuzzleSelected"));
      return;
    }

    setIsCreatingOwnedPuzzle(true);
    try {
      const ownedPuzzleId = await createInstance({
        puzzleId: selectedPuzzle._id,
        condition: data.condition,
        availability: {
          forTrade: data.availability.forTrade,
          forSale: data.availability.forSale,
          forLend: data.availability.forLend,
        },
        acquisitionDate: data.acquisitionDate
          ? new Date(data.acquisitionDate).getTime()
          : undefined,
        notes: data.notes,
      });

      toast.success(t("puzzleAdded"));
      router.push("/puzzles");
    } catch (error) {
      console.error("Failed to create puzzle instance:", error);
      toast.error(t("puzzleCreationFailed"));
    } finally {
      setIsCreatingOwnedPuzzle(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{t("addPuzzle")}</h1>
          <p className="text-muted-foreground">{t("addPuzzleDescription")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("selectPuzzle")}</CardTitle>
            <CardDescription>{t("selectPuzzleDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Puzzle Search Combobox */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("searchPuzzle")}</label>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={searchOpen}
                    className="w-full justify-between"
                  >
                    {selectedPuzzle
                      ? selectedPuzzle.title
                      : t("searchPlaceholder")}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput
                      placeholder={t("searchPlaceholder")}
                      value={searchValue}
                      onValueChange={setSearchValue}
                    />
                    <CommandList>
                      <CommandEmpty>
                        <div className="p-4 text-center">
                          <p className="text-sm text-muted-foreground mb-4">
                            {t("noPuzzlesFound")}
                          </p>
                          <Dialog
                            open={createPuzzleOpen}
                            onOpenChange={setCreatePuzzleOpen}
                          >
                            <DialogTrigger asChild>
                              <Button size="sm">
                                <Plus className="mr-2 h-4 w-4" />
                                {t("createNewPuzzle")}
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>
                                  {t("createNewPuzzle")}
                                </DialogTitle>
                                <DialogDescription>
                                  {t("createNewPuzzleDescription")}
                                </DialogDescription>
                              </DialogHeader>
                              <PuzzleForm
                                onSubmit={handleCreatePuzzle}
                                onCancel={() => setCreatePuzzleOpen(false)}
                                pending={isCreatingPuzzle}
                              >
                                <div className="max-h-[60vh] overflow-y-auto pb-6">
                                  <PuzzleForm.Content />
                                </div>
                                <PuzzleForm.Actions />
                              </PuzzleForm>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {puzzleSuggestions?.map((puzzle) => (
                          <CommandItem
                            key={puzzle._id}
                            value={puzzle._id}
                            onSelect={() => handlePuzzleSelect(puzzle)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedPuzzle?._id === puzzle._id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex items-center gap-2">
                              {puzzle.image && (
                                <Image
                                  src={puzzle.image}
                                  alt={puzzle.title}
                                  width={32}
                                  height={32}
                                  className="w-8 h-8 rounded object-cover"
                                />
                              )}
                              <div>
                                <div className="font-medium">
                                  {puzzle.title}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {puzzle.brand && `${puzzle.brand} • `}
                                  {puzzle.pieceCount} {t("pieces")}
                                </div>
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Selected Puzzle Display */}
            {selectedPuzzle && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {selectedPuzzle.image && (
                      <img
                        src={selectedPuzzle.image}
                        alt={selectedPuzzle.title}
                        className="w-16 h-16 rounded object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold">{selectedPuzzle.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedPuzzle.brand && `${selectedPuzzle.brand} • `}
                        {selectedPuzzle.pieceCount} {t("pieces")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Instance Details Form */}
            {selectedPuzzle && (
              <Form {...instanceForm}>
                <form
                  onSubmit={instanceForm.handleSubmit(handleCreateInstance)}
                  className="space-y-4"
                >
                  <FormField
                    control={instanceForm.control}
                    name="condition"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("condition")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("selectCondition")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="excellent">
                              {t("condition.excellent")}
                            </SelectItem>
                            <SelectItem value="good">
                              {t("condition.good")}
                            </SelectItem>
                            <SelectItem value="fair">
                              {t("condition.fair")}
                            </SelectItem>
                            <SelectItem value="poor">
                              {t("condition.poor")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={instanceForm.control}
                    name="acquisitionDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("acquisitionDate")}</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            placeholder={t("acquisitionDatePlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={instanceForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("notes")}</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t("notesPlaceholder")}
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-2 pt-4">
                    <Button
                      type="submit"
                      disabled={isCreatingOwnedPuzzle}
                      className="flex-1"
                    >
                      {isCreatingOwnedPuzzle
                        ? tCommon("saving")
                        : t("addToCollection")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push("/puzzles")}
                    >
                      {tCommon("cancel")}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
