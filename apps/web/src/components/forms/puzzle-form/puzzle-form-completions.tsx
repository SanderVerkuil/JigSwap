"use client";

import { Clock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { type PuzzleFormData } from "./puzzle-form-schema";

interface CompletionEntry {
  id: string;
  completedDate: number;
  completionTimeMinutes?: number;
  notes?: string;
}

interface PuzzleFormCompletionsProps {
  form: UseFormReturn<PuzzleFormData>;
}

export function PuzzleFormCompletions({ form }: PuzzleFormCompletionsProps) {
  const t = useTranslations("puzzles");

  const completions = (form.watch("completions") || []) as CompletionEntry[];

  const addCompletion = () => {
    const newCompletion: CompletionEntry = {
      id: Date.now().toString(),
      completedDate: Date.now(),
      completionTimeMinutes: undefined,
      notes: "",
    };
    form.setValue("completions", [...completions, newCompletion]);
  };

  const removeCompletion = (id: string) => {
    form.setValue(
      "completions",
      completions.filter((c) => c.id !== id),
    );
  };

  const updateCompletion = <K extends keyof CompletionEntry>(
    id: string,
    field: K,
    value: CompletionEntry[K],
  ) => {
    form.setValue(
      "completions",
      completions.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">{t("completions.title")}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          {t("completions.description")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Completion Status */}
        <FormField
          control={form.control}
          name="isCompleted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">
                  {t("puzzleCompleted")}
                </FormLabel>
                <FormDescription>
                  {t("completions.statusDescription")}
                </FormDescription>
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

        {/* Completion Entries */}
        {form.watch("isCompleted") && (
          <div className="space-y-4">
            {completions.map((completion, index) => (
              <Card key={completion.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {t("completions.completion")} #{index + 1}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCompletion(completion.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Completion Date */}
                  <FormItem>
                    <FormLabel>{t("completedDate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={
                          completion.completedDate
                            ? new Date(completion.completedDate)
                                .toISOString()
                                .split("T")[0]
                            : ""
                        }
                        onChange={(e) => {
                          const date = e.target.value;
                          updateCompletion(
                            completion.id,
                            "completedDate",
                            date ? new Date(date).getTime() : Date.now(),
                          );
                        }}
                      />
                    </FormControl>
                  </FormItem>

                  {/* Completion Time */}
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {t("completions.timeSpent")} ({t("completions.optional")})
                    </FormLabel>
                    <FormDescription>
                      {t("completions.timeDescription")}
                    </FormDescription>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={completion.completionTimeMinutes || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateCompletion(
                              completion.id,
                              "completionTimeMinutes",
                              value ? parseInt(value) : undefined,
                            );
                          }}
                          className="flex-1"
                        />
                        <span className="flex items-center text-sm text-muted-foreground">
                          {t("completions.minutes")}
                        </span>
                      </div>
                    </FormControl>
                  </FormItem>

                  {/* Completion Notes */}
                  <FormItem>
                    <FormLabel>{t("completions.notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("completions.notesPlaceholder")}
                        value={completion.notes || ""}
                        onChange={(e) => {
                          updateCompletion(
                            completion.id,
                            "notes",
                            e.target.value,
                          );
                        }}
                      />
                    </FormControl>
                  </FormItem>
                </CardContent>
              </Card>
            ))}

            {/* Add Completion Button */}
            <Button
              type="button"
              variant="outline"
              onClick={addCompletion}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("completions.addCompletion")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
