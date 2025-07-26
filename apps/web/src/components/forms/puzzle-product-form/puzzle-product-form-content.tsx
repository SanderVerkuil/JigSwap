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
import { LoadingState } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { useState } from "react";
import { FileUpload } from "../file-upload";
import { usePuzzleProductFormContext } from "./puzzle-product-form-context";

const COMMON_PIECE_COUNTS = [
  100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000,
];

export const PuzzleProductFormContent = () => {
  const { form, formId, onSubmit } = usePuzzleProductFormContext();
  const [commonPiece, setCommonPiece] = useState(
    COMMON_PIECE_COUNTS.includes(form.getValues("pieceCount")) ||
      form.getValues("pieceCount") === undefined
      ? form.getValues("pieceCount")
      : "custom",
  );

  const categories = useQuery(api.adminCategories.getAllAdminCategories);

  const t = useTranslations("forms.puzzle-product-form");

  const onCommonPieceChange = (value: string) => {
    setCommonPiece(value);
    if (value !== "custom") {
      form.setValue("pieceCount", Number(value));
    }
  };

  const isFileEnabled = useFeatureFlagEnabled("file-upload");

  if (categories === undefined) {
    return <LoadingState message="Loading form..." />;
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-8"
      >
        {isFileEnabled && (
          <FormField
            control={form.control}
            name="image"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("image.label")}</FormLabel>
                <FormControl>
                  <FileUpload {...field} placeholder={t("image.placeholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("title.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("title.placeholder")} />
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
              <FormLabel>{t("description.label")}</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder={t("description.placeholder")}
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FormField
              control={form.control}
              name="brand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("brand.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("brand.placeholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="pieceCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("pieceCount.label")}</FormLabel>
                <FormControl>
                  <Select
                    value={commonPiece?.toString()}
                    onValueChange={onCommonPieceChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("pieceCount.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_PIECE_COUNTS.map((count) => (
                        <SelectItem key={count} value={count.toString()}>
                          {count}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        {t("pieceCount.custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "") {
                        field.onChange(undefined);
                      } else {
                        field.onChange(Number(value));
                      }
                    }}
                    type="number"
                    placeholder={t("pieceCount.placeholder")}
                    data-common-piece={commonPiece}
                    className="hidden data-[common-piece='custom']:block"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="difficulty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("difficulty.label")}</FormLabel>
                <FormControl>
                  <Select {...field}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("difficulty.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">
                        {t("difficulty.easy")}
                      </SelectItem>
                      <SelectItem value="medium">
                        {t("difficulty.medium")}
                      </SelectItem>
                      <SelectItem value="hard">
                        {t("difficulty.hard")}
                      </SelectItem>
                      <SelectItem value="expert">
                        {t("difficulty.expert")}
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
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("category.label")}</FormLabel>
                <FormControl>
                  <Select {...field}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("category.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories?.map((category) => (
                        <SelectItem key={category._id} value={category._id}>
                          {category.name.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("tags.label")}</FormLabel>
              <FormControl>
                <TagsInput
                  value={field.value || []}
                  onValueChange={(value) => field.onChange(value)}
                  placeholder={t("tags.placeholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
};
