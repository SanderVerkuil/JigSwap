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
  const locale = useLocale();
  const t = useTranslations("marketing.docs");
  const [state, setState] = React.useState<"idle" | "negative" | "done">(
    "idle",
  );
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
      toast.success(t("helpfulThanks"));
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
      setState("done");
      toast.success(t("helpfulThanksNegative"));
    } catch {
      toast.error(t("helpfulError"));
    }
  };

  if (state === "done") {
    return (
      <div className="mt-10 rounded-[14px] bg-mk-muted border border-mk-border px-5 py-4 text-[14.5px] text-mk-green-600 font-medium">
        {t("helpfulThanks")}
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-[14px] bg-mk-muted border border-mk-border px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14.5px] text-mk-text-body font-medium">
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
