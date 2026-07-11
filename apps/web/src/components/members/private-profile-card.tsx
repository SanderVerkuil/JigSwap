"use client";

// The quiet private-profile card (shared shape between the logged-out teaser and
// the logged-in interstitial): full identity above, one sentence of mutuality
// framing, no blurred-content silhouettes — respectful, never a paywall tease.

import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { useTranslations } from "use-intl";

export function PrivateProfileCard({ displayName }: { displayName: string }) {
  const t = useTranslations("members");
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed p-8 text-center">
      <Lock className="text-muted-foreground h-5 w-5" />
      <p className="font-semibold">
        {t("privateTitle", { name: displayName })}
      </p>
      <p className="text-muted-foreground text-sm">{t("privateSub")}</p>
    </Card>
  );
}
