import { describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';

vi.mock('next-intl/server', () => ({
  getRequestConfig: (callback: unknown) => callback,
}));

import requestConfig, { resolveLocale } from './request';

describe('request locale resolution contract', () => {
  it('falls back to English for an unsupported request locale', () => {
    expect(resolveLocale('fr')).toBe('en');
  });

  it('falls back to English when the request has no locale', () => {
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('keeps a registered Spanish locale', () => {
    expect(resolveLocale('es')).toBe('es');
  });

  it('loads the English catalog after rejecting an unsupported locale', async () => {
    const config = await requestConfig({ locale: 'fr', requestLocale: Promise.resolve('fr') });

    expect(config.locale).toBe('en');
    expect(config.messages).toEqual(en);
  });
});
