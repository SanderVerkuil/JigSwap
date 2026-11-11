import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

export function DocHelpful({ slug }: { slug: string }) {
  const submit = useMutation({
    mutationFn: useConvexMutation(gateway.docs.submitFeedback),
  });
  // The backend stores only the locales the app ships.
  const locale = useLocale() === "nl" ? "nl" : "en";
  const t = useTranslations("marketing.docs");
  const [state, setState] = React.useState<
    "idle" | "negative" | "done" | "doneNegative"
  >("idle");
  const [comment, setComment] = React.useState("");
  const sending = submit.isPending;

  const vote = async (helpful: boolean) => {
    if (!helpful) {
      setState("negative");
      return;
    }
    if (sending) return;
    try {
      await submit.mutateAsync({ slug, helpful: true, locale });
      setState("done");
    } catch {
      // Keep the buttons usable so the reader can retry.
      toast.error(t("helpfulError"));
    }
  };

  const sendNegative = async () => {
    if (sending) return;
    try {
      await submit.mutateAsync({
        slug,
        helpful: false,
        comment: comment.trim() || undefined,
        locale,
      });
      setState("doneNegative");
    } catch {
      toast.error(t("helpfulError"));
    }
  };

  // The thanks takes the question's place, once; a toast on top of it thanked the reader twice.
  if (state === "done" || state === "doneNegative") {
    return (
      <div
        role="status"
        className="mt-10 rounded-md bg-mk-sky-soft dark:bg-mk-muted px-5 py-4 text-[16px] text-mk-text-strong font-medium"
      >
        {t(state === "done" ? "helpfulThanks" : "helpfulThanksNegative")}
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-md bg-mk-sky-soft dark:bg-mk-muted px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[16px] text-mk-text-body font-medium">
          {t("helpfulQuestion")}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => vote(true)}
          >
            <ThumbsUp className="size-4" /> {t("helpfulYes")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => vote(false)}
          >
            <ThumbsDown className="size-4" /> {t("helpfulNo")}
          </Button>
        </div>
      </div>
      {state === "negative" && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("helpfulPlaceholder")}
            aria-label={t("helpfulCommentLabel")}
            maxLength={2000}
            className="bg-mk-card"
            rows={3}
          />
          <Button
            variant="brand"
            size="sm"
            className="self-start"
            disabled={sending}
            onClick={sendNegative}
          >
            {t("helpfulSend")}
          </Button>
        </div>
      )}
    </div>
  );
}
