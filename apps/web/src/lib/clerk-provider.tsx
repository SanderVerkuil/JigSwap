"use client";

import * as locales from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
import { ReactNode } from "react";

const matchedLocale = {
  en: locales.enUS,
  es: locales.esES,
  fr: locales.frFR,
  de: locales.deDE,
  it: locales.itIT,
  nl: locales.nlNL,
};

export function ClerkClientProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const currentLocale = useLocale();

  const locale =
    matchedLocale[currentLocale as keyof typeof matchedLocale] || locales.enUS;

  return (
    <ClerkProvider
      appearance={{
        baseTheme: resolvedTheme === "dark" ? dark : undefined,
        variables: {
          colorPrimary: "var(--jigsaw-primary)",
          colorBackground: "var(--card)",
          colorInputBackground: "var(--card)",
          colorInputText: "var(--foreground)",
        },
      }}
      localization={locale}
    >
      {children}
    </ClerkProvider>
  );
}
