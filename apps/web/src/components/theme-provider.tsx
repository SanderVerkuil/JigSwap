'use client';

import * as React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { setThemeCookie, type Theme } from '@/lib/theme-cookies';
import { resolveTheme } from '@/lib/theme';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'jigswap-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const root = window.document.documentElement;
    const resolvedTheme = resolveTheme(theme);

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      setThemeCookie(theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
