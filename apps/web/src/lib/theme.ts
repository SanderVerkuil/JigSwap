import type { Theme } from './theme-cookies';

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    // For SSR, we default to light theme to prevent hydration mismatch
    // The client-side theme provider will handle the actual system preference
    return 'light';
  }
  return theme;
}
