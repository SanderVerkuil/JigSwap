'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { ReactNode } from 'react';
import { useTheme } from 'next-themes';
import * as locales from '@clerk/localizations';
import { useLocale } from 'next-intl';

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
        baseTheme: resolvedTheme === 'dark' ? dark : undefined,
      }}
      localization={locale}
    >
      {children}
    </ClerkProvider>
  );
}
