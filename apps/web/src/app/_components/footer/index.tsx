"use client";

import { HeaderLogo } from "@/components/common/header-logo";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="border-t py-8 px-4">
      <div className="container mx-auto text-center text-muted-foreground">
        <div className="flex items-center justify-center space-x-2 mb-4">
          <HeaderLogo />
        </div>
        <p className="text-sm">{t("footer.description")}</p>
        <div className="mt-4 flex justify-center space-x-6 text-sm">
          <Link href="/about" className="hover:text-foreground">
            {t("footer.about")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            {t("footer.terms")}
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            {t("footer.contact")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
