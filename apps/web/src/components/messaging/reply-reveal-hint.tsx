"use client";

import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useTranslations } from "use-intl";

// SEC-08: in an exchange's own thread, the owner's first message shows the requester their name,
// handle and received reviews for that trade (never their email). Before that reply, tell the
// owner so, above the composer. exchange.replyDisclosure answers only the exchange's owner, and
// says revealsYou only while a reply would reveal something new; anyone else sees nothing here.
export function ReplyRevealHint({
  exchangeId,
  partnerName,
}: {
  // The Exchange aggregateId, as the inbox thread's subject carries it.
  exchangeId: string;
  partnerName: string;
}) {
  const t = useTranslations("messages");
  const { data } = useQuery(
    convexQuery(gateway.exchange.replyDisclosure, { exchangeId }),
  );
  if (!data?.revealsYou) return null;
  return (
    <p
      role="note"
      className="text-muted-foreground flex shrink-0 items-start gap-2 px-4 pb-1.5 text-xs"
    >
      <Eye className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{t("replyRevealHint", { name: partnerName })}</span>
    </p>
  );
}
