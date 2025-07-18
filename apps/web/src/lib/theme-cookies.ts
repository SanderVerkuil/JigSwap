'use server';

import { cookies } from 'next/headers';

export type Theme = 'dark' | 'light' | 'system';

const THEME_COOKIE_NAME = 'jigswap-ui-theme';

export async function getThemeFromCookies(): Promise<Theme> {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_COOKIE_NAME)?.value as Theme;
  return theme || 'system';
}

export async function setThemeCookie(theme: Theme) {
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, theme);
}
