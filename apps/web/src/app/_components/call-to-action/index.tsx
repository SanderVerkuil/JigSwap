"use client";

import { Button } from "@/components/ui/button";
import { Authenticated, Unauthenticated } from "convex/react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function CallToAction() {
  const t = useTranslations();

  return (
    <section className="py-20 px-4 bg-jigsaw-primary text-white">
      <div className="container mx-auto text-center">
        <h2 className="text-3xl font-bold mb-4">{t("callToAction.title")}</h2>
        <p className="text-xl mb-8 opacity-90">
          {t("callToAction.description")}
        </p>
        <Unauthenticated>
          <Link href="/sign-up">
            <Button size="lg" variant="secondary">
              {t("callToAction.startJourney")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </Unauthenticated>
        <Authenticated>
          <Link href="/dashboard">
            <Button size="lg" variant="secondary">
              {t("callToAction.goToDashboard")}
            </Button>
          </Link>
        </Authenticated>
      </div>
    </section>
  );
}
