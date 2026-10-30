"use client";

// Edit & Approve: a minimal pre-filled subset of the definition form (title /
// description / brand / pieceCount / difficulty / tags — validation reused
// from the puzzle form schema) that saves the update mutation and then
// approves with `edited: true` so the audit stamp records
// definition_edited_approved. The form is seeded once, when the dialog mounts:
// the route keys each opening by the submission it was opened for, so a live
// update (or a new arrival in the queue) never re-seeds it and wipes the
// admin's edits. If that submission leaves the queue meanwhile
// (`handledElsewhere`), the dialog says so and Save is disabled.
import { SuggestInput } from "@/components/add-puzzle";
import { puzzleFormSchema } from "@/components/forms/puzzle-form/puzzle-form-schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagsInput } from "@/components/ui/extension/tags-input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslations } from "use-intl";
import { z } from "zod";
import type { PendingSubmission } from "./submission-detail";

const editApproveSchema = puzzleFormSchema.pick({
  title: true,
  description: true,
  brand: true,
  publisher: true,
  pieceCount: true,
  difficulty: true,
  tags: true,
});

export type EditApproveValues = z.infer<typeof editApproveSchema>;

function toDefaults(submission: PendingSubmission): EditApproveValues {
  return {
    title: submission.title,
    description: submission.description ?? "",
    brand: submission.brand ?? "",
    publisher: submission.publisher ?? "",
    pieceCount: submission.pieceCount,
    difficulty: submission.difficulty,
    tags: submission.tags ?? [],
  };
}

export function EditApproveDialog({
  submission,
  open,
  onOpenChange,
  onSave,
  busy,
  handledElsewhere,
  onCloseAutoFocus,
}: {
  /** The submission the dialog was opened for; only read when the dialog mounts. */
  submission: PendingSubmission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: EditApproveValues) => Promise<void>;
  busy: boolean;
  /** That submission is no longer pending (decided by someone else): nothing to save. */
  handledElsewhere: boolean;
  /** Where focus goes when the dialog closes (default: back to what opened it). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("admin.moderation.editDialog");
  const tForm = useTranslations("forms.puzzle-form");
  const tCommon = useTranslations("common");

  const form = useForm<EditApproveValues>({
    resolver: zodResolver(editApproveSchema),
    defaultValues: toDefaults(submission),
  });

  // Maker-field autocomplete suggestion pools
  const { data: publisherSuggestions } = useQuery(
    convexQuery(gateway.catalog.allPublishers, {}),
  );
  const { data: brandSuggestions } = useQuery(
    convexQuery(gateway.catalog.allBrands, {}),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {handledElsewhere && (
          <p
            role="alert"
            className="rounded-lg border border-jigsaw-warning/30 bg-jigsaw-warning/10 px-3.5 py-3 text-sm"
          >
            {t("handledElsewhere")}
          </p>
        )}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSave)}
            className="space-y-4"
            id="edit-approve-form"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("title.label")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={tForm("title.placeholder")}
                    />
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
                  <FormLabel>{tForm("description.label")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={tForm("description.placeholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("brand.label")}</FormLabel>
                    <FormControl>
                      <SuggestInput
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        suggestions={
                          brandSuggestions?.filter((b): b is string => !!b) ??
                          []
                        }
                        placeholder={tForm("brand.placeholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="publisher"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("publisher.label")}</FormLabel>
                    <FormControl>
                      <SuggestInput
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        suggestions={publisherSuggestions ?? []}
                        placeholder={tForm("publisher.placeholder")}
                      />
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
                    <FormLabel>{tForm("pieceCount.label")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                          )
                        }
                        placeholder={tForm("pieceCount.placeholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="difficulty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("difficulty.label")}</FormLabel>
                  <FormControl>
                    <Select {...field} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={tForm("difficulty.placeholder")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">
                          {tForm("difficulty.easy")}
                        </SelectItem>
                        <SelectItem value="medium">
                          {tForm("difficulty.medium")}
                        </SelectItem>
                        <SelectItem value="hard">
                          {tForm("difficulty.hard")}
                        </SelectItem>
                        <SelectItem value="expert">
                          {tForm("difficulty.expert")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
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
                  <FormLabel>{tForm("tags.label")}</FormLabel>
                  <FormControl>
                    <TagsInput
                      value={field.value || []}
                      onValueChange={(value) => field.onChange(value)}
                      placeholder={tForm("tags.placeholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            form="edit-approve-form"
            disabled={busy || handledElsewhere}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
