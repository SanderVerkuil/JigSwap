'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { ReactNode } from 'react';
import { useTheme } from '@/components/theme-provider';
import { resolveTheme } from '@/lib/theme';

export function ClerkClientProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <ClerkProvider
      appearance={resolveTheme(theme) === 'dark' ? dark : undefined}
    >
      {children}
    </ClerkProvider>
  );
}
