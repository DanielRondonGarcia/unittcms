import { describe, expect, it } from 'vitest';
import { routing } from './routing';

describe('locale routing contract', () => {
  it('accepts Spanish as a routed locale', () => {
    expect(routing.locales).toContain('es');
  });

  it('keeps English as the default with an always-prefixed URL', () => {
    expect(routing.defaultLocale).toBe('en');
    expect(routing.localePrefix).toEqual({ mode: 'always' });
  });
});
