"use client";

import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import { Form } from "@/components/ui/form";
import { PuzzleFormBasicInfo } from "./puzzle-form-basic-info";
import { PuzzleFormCompletions } from "./puzzle-form-completions";
import { usePuzzleForm } from "./puzzle-form-context";
import { PuzzleFormStatusInfo } from "./puzzle-form-status-info";

export function PuzzleFormForm() {
  const { form, id, shouldShowOtherSections, onSuggestionUsed, onSubmit } =
    usePuzzleForm();

  // Get admin categories
  const categories = useQuery(api.adminCategories.getActiveAdminCategories);

  return (
    <Form {...form}>
      <form
        id={id}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-8"
      >
        {/* Basic Information */}
        <div className="space-y-6">
          <PuzzleFormBasicInfo
            form={form}
            categories={categories}
            onSuggestionUsed={onSuggestionUsed}
          />
        </div>

        {/* Status Information - only show when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
            <PuzzleFormStatusInfo form={form} />
          </div>
        )}

        {/* Completion Tracking - only show when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
            <PuzzleFormCompletions form={form} />
          </div>
        )}
      </form>
    </Form>
  );
}
