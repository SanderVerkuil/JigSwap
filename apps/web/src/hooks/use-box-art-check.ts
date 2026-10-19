import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Box art the member uploaded is served to no one, the uploader included, until the server's
// check has passed (catalog/boxArtInCheck); until then the puzzle shows its placeholder. These
// hooks tell the UPLOADER why: a toast right after saving, and a "being checked" label on the
// placeholder of their own puzzles. Nobody else is told anything.

/**
 * After a form saved `image` as box art: when it is still being checked, toast that the puzzle
 * shows its placeholder until then. Never throws (the save itself already succeeded).
 */
export function useBoxArtCheckNotice() {
  const convex = useConvex();
  const t = useTranslations("puzzles.boxArtCheck");
  return async (image: string | undefined) => {
    if (!image) return;
    try {
      const inCheck = await convex.query(gateway.catalog.isMyBoxArtInCheck, {
        image,
      });
      if (inCheck) toast.info(t("toast"), { duration: 8000 });
    } catch {
      // Informational only.
    }
  };
}

/** The ids of the member's own puzzles whose box art is still being checked. */
export function useBoxArtInCheck(): ReadonlySet<string> {
  const { data } = useQuery(
    convexQuery(gateway.catalog.listMyBoxArtInCheck, {}),
  );
  return useMemo(() => new Set<string>(data ?? []), [data]);
}
