// "Share a copy": pick one of your own copies and share it into the circle. Shown to members whose
// seat may share (Exchange or Admin, read live from viewerPermission); the server enforces the same
// rule and that the copy is yours. Used in the manage dialog and on the circle page.
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

export function CircleShareSection({
  circleId,
  memberId,
}: {
  circleId: string;
  // The viewer's Convex member id; the copy list waits until it is known.
  memberId: string | undefined;
}) {
  const t = useTranslations("circles");
  const [shareCopyId, setShareCopyId] = useState<string>("");

  const { data: myCopies } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      memberId
        ? { ownerId: memberId as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );
  const shareCopy = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.shareCopyToCircle),
  });

  const handleShare = async () => {
    if (!shareCopyId) return;
    try {
      await shareCopy.mutateAsync({ circleId, copyId: shareCopyId });
      setShareCopyId("");
    } catch (error) {
      console.error("Failed to share copy:", error);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="font-medium">{t("manage.shareCopy")}</h3>
      <p className="text-xs text-muted-foreground">
        {t.rich("manage.shareDescription", {
          scope: (chunks) => <span className="font-medium">{chunks}</span>,
        })}
      </p>
      <div className="flex items-center gap-2">
        <Select value={shareCopyId} onValueChange={setShareCopyId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t("manage.chooseCopy")} />
          </SelectTrigger>
          <SelectContent>
            {(myCopies ?? [])
              .filter((copy) => copy.aggregateId)
              .map((copy) => (
                <SelectItem key={copy._id} value={copy.aggregateId as string}>
                  {copy.puzzle?.title ??
                    copy.snapshot?.title ??
                    t("manage.copyFallback")}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button onClick={handleShare} disabled={!shareCopyId}>
          {t("manage.share")}
        </Button>
      </div>
    </section>
  );
}
