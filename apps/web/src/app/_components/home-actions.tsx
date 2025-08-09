"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function HomeActions() {
  const t = useTranslations();

  return (
    <section className="px-4 py-20">
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("home.actions.uploadPuzzlesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              {t("home.actions.uploadPuzzlesDescription")}
            </p>
            <Button asChild>
              <Link href="/puzzles/add">{t("puzzles.addPuzzle")}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("home.actions.collectionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              {t("home.actions.collectionsDescription")}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/my-puzzles">{t("navigation.myPuzzles")}</Link>
              </Button>
              <Button asChild>
                <Link href="/collections">
                  {t("collections.manageCollections")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("browse.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{t("browse.subtitle")}</p>
            <Button asChild>
              <Link href="/browse">{t("home.browsePuzzles")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
