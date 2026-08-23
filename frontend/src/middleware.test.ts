import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import middleware, { config } from './middleware';

describe('middleware route matcher contract', () => {
  function redirectPath(response: Response) {
    const location = response.headers.get('location');
    return location ? new URL(location).pathname : null;
  }

  it('matches Spanish-prefixed application routes', () => {
    expect(config.matcher).toContain('/(de|en|es|pt-BR|zh-CN|ja)/:path*');
  });

  it('keeps the unprefixed SSO callback route matched', () => {
    expect(config.matcher).toContain('/account/sso-callback');
  });

  it('passes an explicitly prefixed Spanish request through middleware', async () => {
    const response = await middleware(new NextRequest('http://localhost/es/projects'));

    expect(response.status).toBe(200);
  });

  it('negotiates Spanish from Accept-Language', async () => {
    const response = await middleware(
      new NextRequest('http://localhost/', { headers: { 'accept-language': 'es-ES,es;q=0.9' } })
    );

    expect(redirectPath(response)).toBe('/es');
  });

  it('prefers the NEXT_LOCALE cookie for Spanish', async () => {
    const response = await middleware(new NextRequest('http://localhost/', { headers: { cookie: 'NEXT_LOCALE=es' } }));

    expect(redirectPath(response)).toBe('/es');
  });

  it('falls back to English for an unsupported negotiated locale', async () => {
    const response = await middleware(
      new NextRequest('http://localhost/', { headers: { 'accept-language': 'fr-FR,fr;q=0.9' } })
    );

    expect(redirectPath(response)).toBe('/en');
  });

  it('preserves English as the default without locale hints', async () => {
    const response = await middleware(new NextRequest('http://localhost/'));

    expect(redirectPath(response)).toBe('/en');
  });

  it('retains the existing locale redirect for the unprefixed SSO callback', async () => {
    const response = await middleware(new NextRequest('http://localhost/account/sso-callback?token=test'));

    expect(redirectPath(response)).toBe('/en/account/sso-callback');
  });
});
