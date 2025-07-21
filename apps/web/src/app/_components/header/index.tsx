"use client";

import { HeaderLogo } from "@/components/common/header-logo";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { ModeToggle } from "@/components/ui/theme-toggle";
import { Authenticated, Unauthenticated } from "convex/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function Header() {
  const t = useTranslations();

  return (
    <div className="fixed top-0 w-full z-50">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 will-change-transform">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <HeaderLogo />
          </div>
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <ModeToggle />
            <Unauthenticated>
              <Link href="/sign-in">
                <Button variant="ghost">{t("navigation.signIn")}</Button>
              </Link>
              <Link href="/sign-up">
                <Button variant="default">{t("navigation.signUp")}</Button>
              </Link>
            </Unauthenticated>
            <Authenticated>
              <Link href="/dashboard">
                <Button variant="ghost">{t("navigation.dashboard")}</Button>
              </Link>
            </Authenticated>
          </div>
        </div>
      </header>
    </div>
  );
}
