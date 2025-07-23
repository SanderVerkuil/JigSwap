"use client";

import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { InstanceDetailsStep } from "./instance-details-step";
import { ProductCreateStep } from "./product-create-step";
import { ProductSearchStep } from "./product-search-step";
import { StepContent, Stepper } from "./stepper";

// Form validation schema
const puzzleFormSchema = z.object({
  // Product fields (for creating new products)
  title: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  pieceCount: z.number().optional(),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()),

  // Instance fields
  productId: z.union([z.string(), z.null()]).optional(),
  condition: z.enum(["excellent", "good", "fair", "poor"]),
  isAvailable: z.boolean(),
  acquisitionDate: z.number().optional(),
  notes: z.string().optional(),
});

type PuzzleFormData = z.infer<typeof puzzleFormSchema>;

interface PuzzleProduct {
  _id: Id<"puzzleProducts">;
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  description?: string;
  tags?: string[];
}

interface PuzzleFormContextValue {
  currentStep: number;
  selectedProduct: PuzzleProduct | null;
  isCreatingProduct: boolean;
  isSubmitting: boolean;
  isValid: boolean;
  canProceed: boolean;
  handleProductSelected: (product: PuzzleProduct) => void;
  handleCreateNew: () => void;
  handleBackToSearch: () => void;
  handleStepClick: (step: number) => void;
  handleNext: () => void;
  handleBack: () => void;
  handleSubmit: () => void;
  handleCancel: () => void;
}

const PuzzleFormContext = createContext<PuzzleFormContextValue | null>(null);

const usePuzzleForm = () => {
  const context = useContext(PuzzleFormContext);
  if (!context) {
    throw new Error("usePuzzleForm must be used within PuzzleForm.Root");
  }
  return context;
};

interface PuzzleFormRootProps {
  onSuccess?: (data: {
    productId: Id<"puzzleProducts">;
    instanceId: Id<"puzzleInstances">;
  }) => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
  children: React.ReactNode;
}

export function PuzzleFormRoot({
  onSuccess,
  onCancel,
  defaultValues,
  children,
}: PuzzleFormRootProps) {
  const t = useTranslations("puzzles.form");
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<PuzzleProduct | null>(
    null,
  );
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);

  const createPuzzleProduct = useMutation(api.puzzles.createPuzzleProduct);
  const createPuzzleInstance = useMutation(api.puzzles.createPuzzleInstance);

  const steps = [
    {
      id: "search",
      title: t("steps.findPuzzle.title"),
      description: t("steps.findPuzzle.description"),
    },
    {
      id: "details",
      title: t("steps.yourCopy.title"),
      description: t("steps.yourCopy.description"),
    },
  ];

  const form = useForm<PuzzleFormData>({
    resolver: zodResolver(puzzleFormSchema),
    defaultValues: {
      isAvailable: true,
      images: [],
      tags: [],
      condition: "good", // Set a default condition
      ...defaultValues,
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting, isValid },
    trigger,
  } = form;

  const handleProductSelected = (product: PuzzleProduct) => {
    setSelectedProduct(product);
    setIsCreatingProduct(false);
    setCurrentStep(1);
    // Set the productId in the form
    form.setValue("productId", product._id);
  };

  const handleCreateNew = () => {
    setIsCreatingProduct(true);
  };

  const handleBackToSearch = () => {
    setIsCreatingProduct(false);
    setSelectedProduct(null);
    form.setValue("productId", undefined);
  };

  const handleStepClick = (step: number) => {
    if (step <= currentStep) {
      setCurrentStep(step);
    }
  };

  const onSubmit = async (data: PuzzleFormData) => {
    console.log("Form submitted with data:", data);
    console.log("Current step:", currentStep);
    console.log("Selected product:", selectedProduct);
    console.log("Is creating product:", isCreatingProduct);

    try {
      let productId: Id<"puzzleProducts">;

      if (isCreatingProduct) {
        // Validate required product fields
        if (!data.title || !data.pieceCount) {
          toast.error(t("error.missingProductFields"));
          return;
        }

        // Create new product
        productId = await createPuzzleProduct({
          title: data.title,
          description: data.description,
          brand: data.brand,
          pieceCount: data.pieceCount,
          difficulty: data.difficulty,
          category: data.category as Id<"adminCategories"> | undefined,
          tags: data.tags,
          images: data.images,
        });
      } else if (selectedProduct) {
        // Use existing product
        productId = selectedProduct._id;
      } else {
        throw new Error(t("error.noProductSelected"));
      }

      // Create puzzle instance
      const instanceId = await createPuzzleInstance({
        productId,
        condition: data.condition,
        isAvailable: data.isAvailable,
        acquisitionDate: data.acquisitionDate,
        notes: data.notes,
      });

      toast.success(t("success.puzzleAdded"));
      onSuccess?.({ productId, instanceId });
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      toast.error(t("error.failedToCreate"));
    }
  };

  const canProceed = (): boolean => {
    if (currentStep === 0) {
      if (selectedProduct !== null) {
        return true;
      }
      if (isCreatingProduct) {
        const title = form.getValues("title");
        const pieceCount = form.getValues("pieceCount");
        return Boolean(title && pieceCount);
      }
      return false;
    }
    // For step 1, check if the required instance fields are filled
    const condition = form.getValues("condition");
    return Boolean(condition);
  };

  const handleNext = () => {
    if (currentStep === 0) {
      if (selectedProduct) {
        setCurrentStep(1);
        // Trigger validation for step 1 fields
        trigger(["condition", "isAvailable"]);
      } else if (isCreatingProduct) {
        const productData = form.getValues();
        if (productData.title && productData.pieceCount) {
          setCurrentStep(1);
          // Trigger validation for step 1 fields
          trigger(["condition", "isAvailable"]);
        }
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFormSubmit = () => {
    handleSubmit(onSubmit)();
  };

  const handleCancel = () => {
    onCancel?.();
  };

  const contextValue: PuzzleFormContextValue = {
    currentStep,
    selectedProduct,
    isCreatingProduct,
    isSubmitting,
    isValid,
    canProceed: canProceed(),
    handleProductSelected,
    handleCreateNew,
    handleBackToSearch,
    handleStepClick,
    handleNext,
    handleBack,
    handleSubmit: handleFormSubmit,
    handleCancel,
  };

  return (
    <PuzzleFormContext.Provider value={contextValue}>
      <FormProvider {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {children}
        </form>
      </FormProvider>
    </PuzzleFormContext.Provider>
  );
}

// Compound Components
export function PuzzleFormTitle() {
  const t = useTranslations("puzzles.form");

  return (
    <div className="text-center">
      <h2 className="text-2xl font-semibold mb-2">{t("title")}</h2>
      <p className="text-muted-foreground">{t("subtitle")}</p>
    </div>
  );
}

export function PuzzleFormContent() {
  const {
    currentStep,
    isCreatingProduct,
    selectedProduct,
    handleProductSelected,
    handleCreateNew,
    handleBackToSearch,
    handleStepClick,
  } = usePuzzleForm();

  const t = useTranslations("puzzles.form");

  const steps = [
    {
      id: "search",
      title: t("steps.findPuzzle.title"),
      description: t("steps.findPuzzle.description"),
    },
    {
      id: "details",
      title: t("steps.yourCopy.title"),
      description: t("steps.yourCopy.description"),
    },
  ];

  return (
    <>
      <Stepper
        steps={steps}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />

      <StepContent>
        {currentStep === 0 && !isCreatingProduct && (
          <ProductSearchStep
            onProductSelected={handleProductSelected}
            onCreateNew={handleCreateNew}
          />
        )}

        {currentStep === 0 && isCreatingProduct && (
          <ProductCreateStep onBack={handleBackToSearch} />
        )}

        {currentStep === 1 && (
          <InstanceDetailsStep selectedProduct={selectedProduct || undefined} />
        )}
      </StepContent>
    </>
  );
}

export function PuzzleFormActions() {
  const {
    currentStep,
    isSubmitting,
    isValid,
    canProceed,
    handleBack,
    handleNext,
    handleSubmit,
    handleCancel,
  } = usePuzzleForm();

  const t = useTranslations("puzzles.form");

  return (
    <div className="flex justify-between pt-6">
      <Button
        type="button"
        variant="outline"
        onClick={handleBack}
        disabled={currentStep === 0}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t("actions.back")}
      </Button>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          {t("actions.cancel")}
        </Button>

        {currentStep < 1 ? (
          <Button type="button" onClick={handleNext} disabled={!canProceed}>
            {t("actions.next")}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button type="submit" disabled={!isValid || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("actions.creating")}
              </>
            ) : (
              t("actions.createPuzzle")
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// Legacy component for backward compatibility
export function PuzzleForm({
  onSuccess,
  onCancel,
  defaultValues,
}: {
  onSuccess?: (data: {
    productId: Id<"puzzleProducts">;
    instanceId: Id<"puzzleInstances">;
  }) => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
}) {
  return (
    <PuzzleFormRoot
      onSuccess={onSuccess}
      onCancel={onCancel}
      defaultValues={defaultValues}
    >
      <PuzzleFormContent />
      <PuzzleFormActions />
    </PuzzleFormRoot>
  );
}

// Export compound components
PuzzleForm.Root = PuzzleFormRoot;
PuzzleForm.Title = PuzzleFormTitle;
PuzzleForm.Form = PuzzleFormContent;
PuzzleForm.Actions = PuzzleFormActions;
