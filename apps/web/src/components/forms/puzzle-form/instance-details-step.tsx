"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  FormControl,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";

interface InstanceDetailsStepProps {
  selectedProduct?: {
    _id: string;
    title: string;
    brand?: string;
    pieceCount: number;
    difficulty?: string;
  };
}

export function InstanceDetailsStep({
  selectedProduct,
}: InstanceDetailsStepProps) {
  const t = useTranslations("puzzles.form.instance");
  const { control, watch } = useFormContext();
  const isAvailable = watch("isAvailable");

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">{t("title")}</h2>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {selectedProduct && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium mb-2">{t("selectedPuzzle")}</h3>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium">{selectedProduct.title}</span>
              {selectedProduct.brand && (
                <Badge variant="secondary">{selectedProduct.brand}</Badge>
              )}
              <Badge variant="outline">
                {selectedProduct.pieceCount} pieces
              </Badge>
              {selectedProduct.difficulty && (
                <Badge variant="outline">{selectedProduct.difficulty}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <FormField
          control={control}
          name="condition"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("condition")}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectCondition")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="excellent">
                    {t("conditionOptions.excellent")}
                  </SelectItem>
                  <SelectItem value="good">
                    {t("conditionOptions.good")}
                  </SelectItem>
                  <SelectItem value="fair">
                    {t("conditionOptions.fair")}
                  </SelectItem>
                  <SelectItem value="poor">
                    {t("conditionOptions.poor")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="isAvailable"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">
                  {t("availableForSwap")}
                </FormLabel>
                <div className="text-sm text-muted-foreground">
                  {t("availableDescription")}
                </div>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="acquisitionDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("acquisitionDate")}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  onChange={(e) => {
                    const date = e.target.value;
                    field.onChange(date ? new Date(date).getTime() : undefined);
                  }}
                  value={
                    field.value
                      ? new Date(field.value).toISOString().split("T")[0]
                      : ""
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("personalNotes")}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("notesPlaceholder")}
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {isAvailable && (
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
            {t("availableInfo.title")}
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            {t("availableInfo.description")}
          </p>
        </div>
      )}
    </div>
  );
}
