import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export function resolveLocale(requestedLocale?: string) {
  const locale = requestedLocale as (typeof routing.locales)[number];

  return requestedLocale && routing.locales.includes(locale) ? locale : routing.defaultLocale;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
