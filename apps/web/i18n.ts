import { getLocaleFromCookies } from "@/lib/intl-cookies";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Can be imported from a shared config
export const locales = ["en", "nl"] as const;
export const defaultLocale = "en" as const;

export type Locale = (typeof locales)[number];

// Function to detect locale from cookies and Accept-Language header
export async function getLocale(): Promise<string> {
  // First, check if there's a locale cookie
  const localeCookie = await getLocaleFromCookies();

  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return localeCookie;
  }

  // If no cookie, check Accept-Language header
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language");

  if (acceptLanguage) {
    try {
      // Use negotiator to parse Accept-Language header
      const negotiator = new Negotiator({
        headers: { "accept-language": acceptLanguage },
      });
      const languages = negotiator.languages();

      // Use @formatjs/intl-localematcher to find the best match
      const matchedLocale = match(
        languages,
        locales as readonly string[],
        defaultLocale,
      );

      return matchedLocale;
    } catch (error) {
      console.warn("Error matching locale:", error);
    }
  }

  // Fallback to default locale
  return defaultLocale;
}

// Crowdin OTA distribution function
async function getCrowdinMessages(locale: string) {
  try {

    return (await import(`./locales/${locale}.json`)).default;
  } catch (error) {
    console.error(`Error loading translations for ${locale}:`, error);
    // Fallback to source.json
    return (await import("./locales/source.json")).default;
  }
}

export default getRequestConfig(async () => {
  // Detect locale from cookies/headers
  const locale = await getLocale();

  // Validate that the detected locale is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getCrowdinMessages(locale);

  return {
    locale,
    messages,
    timeZone: "Europe/Amsterdam",
  };
});
