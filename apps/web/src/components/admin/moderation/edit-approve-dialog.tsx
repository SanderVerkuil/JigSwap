"use client";

// Edit & Approve: a minimal pre-filled subset of the definition form (title /
// description / brand / pieceCount / difficulty / tags — validation reused
// from the puzzle form schema) that saves the update mutation and then
// approves with `edited: true` so the audit stamp records
// definition_edited_approved.

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
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "use-intl";
import { z } from "zod";
import type { PendingSubmission } from "./submission-detail";

const editApproveSchema = puzzleFormSchema.pick({
  title: true,
  description: true,
  brand: true,
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
}: {
  submission: PendingSubmission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: EditApproveValues) => Promise<void>;
  busy: boolean;
}) {
  const t = useTranslations("admin.moderation.editDialog");
  const tForm = useTranslations("forms.puzzle-form");
  const tCommon = useTranslations("common");

  const form = useForm<EditApproveValues>({
    resolver: zodResolver(editApproveSchema),
    defaultValues: toDefaults(submission),
  });

  // Re-seed when the dialog opens for a (possibly different) submission.
  useEffect(() => {
    if (open) form.reset(toDefaults(submission));
  }, [open, submission, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
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
                      <Input
                        {...field}
                        placeholder={tForm("brand.placeholder")}
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
          <Button type="submit" form="edit-approve-form" disabled={busy}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
