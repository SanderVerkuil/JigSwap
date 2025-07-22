"use client";

import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { type PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleFormStatusInfoProps {
  form: UseFormReturn<PuzzleFormData>;
}

export function PuzzleFormStatusInfo({ form }: PuzzleFormStatusInfoProps) {
  const t = useTranslations("puzzles");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">{t("statusInformation")}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          {t("statusInformationDescription")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Acquisition Date */}
        <FormField
          control={form.control}
          name="acquisitionDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("acquisitionDate")}</FormLabel>
              <FormDescription>
                {t("acquisitionDateDescription")}
              </FormDescription>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  value={
                    field.value
                      ? new Date(field.value).toISOString().split("T")[0]
                      : ""
                  }
                  onChange={(e) => {
                    const date = e.target.value;
                    field.onChange(date ? new Date(date).getTime() : undefined);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("notes")}</FormLabel>
              <FormControl>
                <Textarea placeholder={t("notesPlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
