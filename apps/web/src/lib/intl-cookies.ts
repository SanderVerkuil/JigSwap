'use server';

import { cookies } from 'next/headers';

export type Locale = 'nl' | 'en';

const INTL_COOKIE_NAME = 'jigswap-intl';

export async function getLocaleFromCookies(): Promise<Locale | undefined> {
  const cookieStore = await cookies();
  const locale = cookieStore.get(INTL_COOKIE_NAME)?.value as Locale;
  return locale;
}

export async function setLocaleCookie(locale: Locale) {
  const cookieStore = await cookies();
  cookieStore.set(INTL_COOKIE_NAME, locale);
}
