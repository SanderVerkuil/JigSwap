import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useLocale } from "use-intl";

export function DocHelpful({ slug }: { slug: string }) {
  const submit = useMutation(gateway.docs.submitFeedback);
  const locale = useLocale();
  const [state, setState] = React.useState<"idle" | "negative" | "done">(
    "idle",
  );
  const [comment, setComment] = React.useState("");

  const vote = async (helpful: boolean) => {
    if (helpful) {
      await submit({ slug, helpful: true, locale });
      setState("done");
      toast.success("Thanks for the feedback!");
    } else {
      setState("negative");
    }
  };

  const sendNegative = async () => {
    await submit({
      slug,
      helpful: false,
      comment: comment.trim() || undefined,
      locale,
    });
    setState("done");
    toast.success("Thanks — we'll use this to improve.");
  };

  if (state === "done") {
    return (
      <div className="mt-10 rounded-[14px] bg-mk-muted border border-mk-border px-5 py-4 text-[14.5px] text-mk-green-600 font-medium">
        Thanks for the feedback!
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-[14px] bg-mk-muted border border-mk-border px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14.5px] text-mk-text-body font-medium">
          Was this page helpful?
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => vote(true)}>
            <ThumbsUp className="size-4" /> Yes
          </Button>
          <Button variant="outline" size="sm" onClick={() => vote(false)}>
            <ThumbsDown className="size-4" /> Not really
          </Button>
        </div>
      </div>
      {state === "negative" && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What was missing or unclear? (optional)"
            className="bg-mk-card"
            rows={3}
          />
          <Button
            variant="brand"
            size="sm"
            className="self-start"
            onClick={sendNegative}
          >
            Send feedback
          </Button>
        </div>
      )}
    </div>
  );
}
