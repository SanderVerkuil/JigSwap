import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import createIntlMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n';

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'as-needed'
});

const isProtectedRoute = createRouteMatcher([
  '/(en|nl)/dashboard(.*)',
  '/(en|nl)/profile(.*)',
  '/(en|nl)/puzzles/new',
  '/(en|nl)/puzzles/edit/(.*)',
  '/(en|nl)/trades(.*)',
  '/(en|nl)/messages(.*)',
  '/dashboard(.*)',
  '/profile(.*)',
  '/puzzles/new',
  '/puzzles/edit/(.*)',
  '/trades(.*)',
  '/messages(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  // Handle internationalization first
  const intlResponse = intlMiddleware(req);
  
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
  
  return intlResponse;
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}