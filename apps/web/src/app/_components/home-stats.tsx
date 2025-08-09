"use client";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

export function HomeStats() {
  const t = useTranslations();
  const stats = useQuery(api.users.getGlobalStats, {});

  return (
    <section className="px-4 py-20">
      <div className="container mx-auto">
        <Card>
          <CardContent className="py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-3xl font-bold">
                {stats?.totalUsers ?? "—"}
              </div>
              <div className="text-muted-foreground">
                {t("home.stats.users")}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold">
                {stats?.totalPuzzles ?? "—"}
              </div>
              <div className="text-muted-foreground">
                {t("home.stats.puzzles")}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold">
                {stats?.totalOwnedPuzzles ?? "—"}
              </div>
              <div className="text-muted-foreground">
                {t("home.stats.ownedPuzzles")}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold">—</div>
              <div className="text-muted-foreground">
                {t("home.stats.exchangesComing")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
