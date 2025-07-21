"use client";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { type PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleFormStatusInfoProps {
  form: UseFormReturn<PuzzleFormData>;
}

export function PuzzleFormStatusInfo({ form }: PuzzleFormStatusInfoProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Status Information</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Track your puzzle completion and acquisition details
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
                  I have completed this puzzle
                </FormLabel>
                <FormDescription>
                  Mark this puzzle as completed to track your progress
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

        {/* Completion Date */}
        {form.watch("isCompleted") && (
          <FormField
            control={form.control}
            name="completedDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Completion Date</FormLabel>
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
                      field.onChange(
                        date ? new Date(date).getTime() : undefined,
                      );
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Acquisition Date */}
        <FormField
          control={form.control}
          name="acquisitionDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Acquisition Date (optional)</FormLabel>
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
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Any additional notes about this puzzle"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
