import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

// Can be imported from a shared config
export const locales = ['en', 'nl'] as const;
export const defaultLocale = 'en' as const;

export type Locale = typeof locales[number];

// Crowdin OTA distribution function
async function getCrowdinMessages(locale: string) {
  try {
    // For development, fall back to source.json for English
    if (locale === 'en' || process.env.NODE_ENV === 'development') {
      return (await import('./locales/source.json')).default;
    }
    
    // For production, fetch from Crowdin OTA distribution
    const crowdinProjectId = process.env.CROWDIN_PROJECT_ID;
    const crowdinDistributionHash = process.env.CROWDIN_DISTRIBUTION_HASH;
    
    if (!crowdinProjectId || !crowdinDistributionHash) {
      console.warn('Crowdin configuration missing, falling back to source.json');
      return (await import('./locales/source.json')).default;
    }
    
    const response = await fetch(
      `https://distributions.crowdin.net/${crowdinDistributionHash}/content/${locale}.json`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch translations for ${locale}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error loading translations for ${locale}:`, error);
    // Fallback to source.json
    return (await import('./locales/source.json')).default;
  }
}

export default getRequestConfig(async ({ locale }) => {
  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) notFound();

  const messages = await getCrowdinMessages(locale!);

  return {
    messages,
    timeZone: 'Europe/Amsterdam'
  };
});