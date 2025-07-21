"use client";

import { HeaderIcon } from "@/components/common/header-icon";
import { Button } from "@/components/ui/button";
import { Unauthenticated } from "convex/react";
import { ArrowRight, Puzzle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function Hero() {
  const t = useTranslations();

  return (
    <section className="relative px-4 overflow-hidden min-h-svh">
      {/* Background with gradient and decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-jigsaw-primary/10 via-jigsaw-secondary/5 to-jigsaw-success/10" />

      {/* Decorative puzzle pieces */}
      <div className="absolute top-10 left-10 w-16 h-16 opacity-20">
        <div className="w-full h-full rounded-lg transform rotate-12">
          <Puzzle className="text-jigsaw-primary w-full h-full" />
        </div>
      </div>
      <div className="absolute top-32 right-20 w-12 h-12 opacity-15">
        <div className="w-full h-full rounded-lg transform -rotate-6">
          <Puzzle className="text-jigsaw-secondary w-full h-full" />
        </div>
      </div>
      <div className="absolute bottom-20 left-1/4 w-20 h-20 opacity-10">
        <div className="w-full h-full rounded-lg transform rotate-45">
          <Puzzle className="text-jigsaw-success w-full h-full" />
        </div>
      </div>
      <div className="absolute top-1/2 right-1/3 w-8 h-8 opacity-20">
        <div className="w-full h-full rounded-lg transform -rotate-12">
          <Puzzle className="text-jigsaw-warning w-full h-full" />
        </div>
      </div>

      {/* Animated floating elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/6 w-2 h-2 bg-jigsaw-primary/30 rounded-full animate-pulse" />
        <div className="absolute top-1/3 right-1/4 w-3 h-3 bg-jigsaw-secondary/40 rounded-full animate-pulse delay-1000" />
        <div className="absolute bottom-1/3 left-1/3 w-2 h-2 bg-jigsaw-success/30 rounded-full animate-pulse delay-2000" />
        <div className="absolute top-2/3 right-1/6 w-2 h-2 bg-jigsaw-warning/40 rounded-full animate-pulse delay-1500" />
      </div>

      {/* Content */}
      <div className="flex items-center justify-center h-svh">
        <div className="container mx-auto text-center relative z-10">
          <div className="mb-6">
            <span className="text-6xl md:text-8xl mb-4 block">
              <HeaderIcon />
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-jigsaw-primary to-jigsaw-primary-accent bg-clip-text text-transparent">
            {t("home.title")}
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto leading-relaxed">
            {t("home.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Unauthenticated>
              <Link href="/sign-up">
                <Button
                  size="lg"
                  variant="default"
                  className="w-full sm:w-auto bg-gradient-to-r from-jigsaw-primary to-jigsaw-primary-accent hover:from-jigsaw-primary/90 hover:to-jigsaw-primary-accent/90 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
                >
                  {t("home.startTrading")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </Unauthenticated>
            <Link href="/browse">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto border-2 border-jigsaw-primary/30 hover:border-jigsaw-primary hover:bg-jigsaw-primary/10 transition-all duration-300 transform hover:scale-105"
              >
                {t("home.browsePuzzles")}
              </Button>
            </Link>
          </div>

          {/* Additional visual elements */}
          <div className="mt-12 flex justify-center space-x-4 opacity-60">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-jigsaw-success rounded-full"></div>
              <span>{t("home.trackProgress")}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-jigsaw-secondary rounded-full"></div>
              <span>{t("home.exchangePuzzles")}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-jigsaw-warning rounded-full"></div>
              <span>{t("home.connectCommunity")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
