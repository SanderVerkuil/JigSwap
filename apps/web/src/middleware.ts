import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, locales } from "../i18n";

function getLocale(request: NextRequest): string {
  // First, check if there's a locale cookie
  const localeCookie = request.cookies.get("locale")?.value;

  if (
    localeCookie &&
    locales.includes(localeCookie as (typeof locales)[number])
  ) {
    return localeCookie;
  }

  // If no cookie, check Accept-Language header
  const acceptLanguage = request.headers.get("accept-language");

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
      console.warn("Error matching locale in middleware:", error);
    }
  }

  // Fallback to default locale
  return defaultLocale;
}

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/profile(.*)",
  "/puzzles/new",
  "/puzzles/edit/(.*)",
  "/trades(.*)",
  "/messages(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Handle locale detection and set cookie if needed
  const locale = getLocale(req);
  const response = NextResponse.next();

  // Set locale cookie if it doesn't exist or is different
  const currentLocaleCookie = req.cookies.get("locale")?.value;
  if (!currentLocaleCookie || currentLocaleCookie !== locale) {
    response.cookies.set("locale", locale, {
      httpOnly: false, // Allow client-side access for language switcher
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  // Handle protected routes
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
