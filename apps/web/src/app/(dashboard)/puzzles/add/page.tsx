"use client";

import {
  PuzzleProductForm,
  PuzzleProductFormData,
} from "@/components/forms/puzzle-product-form";
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
  condition: z.enum(["excellent", "good", "fair", "poor"]),
  isAvailable: z.boolean(),
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
  const [selectedProduct, setSelectedProduct] = useState<{
    _id: Id<"puzzleProducts">;
    title: string;
    brand?: string;
    pieceCount: number;
    image?: string;
  } | null>(null);
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isCreatingInstance, setIsCreatingInstance] = useState(false);

  const createInstance = useMutation(api.puzzles.createPuzzleInstance);
  const createProduct = useMutation(api.puzzles.createPuzzleProduct);
  const generateUploadUrl = useMutation(api.puzzles.generateUploadUrl);

  // Get product suggestions based on search
  const productSuggestions = useQuery(
    api.puzzles.getPuzzleProductSuggestions,
    searchValue.length > 0 ? { searchTerm: searchValue, limit: 10 } : "skip",
  );

  // Check if there's a productId in URL params
  const productIdFromUrl = searchParams.get(
    "productId",
  ) as Id<"puzzleProducts"> | null;

  // If productId is provided, fetch that specific product
  const specificProduct = useQuery(
    api.puzzles.getPuzzleProductById,
    productIdFromUrl ? { productId: productIdFromUrl } : "skip",
  );

  // Set selected product from URL if available
  useEffect(() => {
    if (productIdFromUrl && specificProduct && !selectedProduct) {
      setSelectedProduct({
        _id: specificProduct._id,
        title: specificProduct.title,
        brand: specificProduct.brand,
        pieceCount: specificProduct.pieceCount,
        image: specificProduct.image ?? undefined,
      });
    }
  }, [productIdFromUrl, specificProduct, selectedProduct]);

  const instanceForm = useForm<InstanceFormData>({
    resolver: zodResolver(instanceFormSchema),
    defaultValues: {
      condition: "good",
      isAvailable: true,
    },
  });

  const handleProductSelect = (product: {
    _id: Id<"puzzleProducts">;
    title: string;
    brand?: string;
    pieceCount: number;
    image?: string;
  }) => {
    setSelectedProduct(product);
    setSearchOpen(false);
    setSearchValue(product.title);
  };

  const handleCreateProduct = async (data: PuzzleProductFormData) => {
    setIsCreatingProduct(true);
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

      const productId = await createProduct({
        title: data.title,
        description: data.description,
        brand: data.brand,
        pieceCount: data.pieceCount,
        difficulty: data.difficulty,
        category: data.category as Id<"adminCategories"> | undefined,
        tags: data.tags,
        image: imageId,
      });

      // Set the newly created product as selected
      setSelectedProduct({
        _id: productId,
        title: data.title,
        brand: data.brand,
        pieceCount: data.pieceCount,
        image: imageId,
      });
      setSearchValue(data.title);
      setCreateProductOpen(false);
      toast.success(t("productCreated"));
    } catch (error) {
      console.error("Failed to create product:", error);
      toast.error(t("productCreationFailed"));
    } finally {
      setIsCreatingProduct(false);
    }
  };

  const handleCreateInstance = async (data: InstanceFormData) => {
    if (!selectedProduct) {
      toast.error(t("noProductSelected"));
      return;
    }

    setIsCreatingInstance(true);
    try {
      const instanceId = await createInstance({
        productId: selectedProduct._id,
        condition: data.condition,
        isAvailable: data.isAvailable,
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
      setIsCreatingInstance(false);
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
            {/* Product Search Combobox */}
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
                    {selectedProduct
                      ? selectedProduct.title
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
                            {t("noProductsFound")}
                          </p>
                          <Dialog
                            open={createProductOpen}
                            onOpenChange={setCreateProductOpen}
                          >
                            <DialogTrigger asChild>
                              <Button size="sm">
                                <Plus className="mr-2 h-4 w-4" />
                                {t("createNewProduct")}
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>
                                  {t("createNewProduct")}
                                </DialogTitle>
                                <DialogDescription>
                                  {t("createNewProductDescription")}
                                </DialogDescription>
                              </DialogHeader>
                              <PuzzleProductForm
                                onSubmit={handleCreateProduct}
                                onCancel={() => setCreateProductOpen(false)}
                                pending={isCreatingProduct}
                              >
                                <PuzzleProductForm.Content />
                                <PuzzleProductForm.Actions />
                              </PuzzleProductForm>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {productSuggestions?.map((product) => (
                          <CommandItem
                            key={product._id}
                            value={product._id}
                            onSelect={() => handleProductSelect(product)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedProduct?._id === product._id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex items-center gap-2">
                              {product.image && (
                                <Image
                                  src={product.image}
                                  alt={product.title}
                                  width={32}
                                  height={32}
                                  className="w-8 h-8 rounded object-cover"
                                />
                              )}
                              <div>
                                <div className="font-medium">
                                  {product.title}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {product.brand && `${product.brand} • `}
                                  {product.pieceCount} {t("pieces")}
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

            {/* Selected Product Display */}
            {selectedProduct && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {selectedProduct.image && (
                      <img
                        src={selectedProduct.image}
                        alt={selectedProduct.title}
                        className="w-16 h-16 rounded object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold">{selectedProduct.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedProduct.brand && `${selectedProduct.brand} • `}
                        {selectedProduct.pieceCount} {t("pieces")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Instance Details Form */}
            {selectedProduct && (
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
                      disabled={isCreatingInstance}
                      className="flex-1"
                    >
                      {isCreatingInstance
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
