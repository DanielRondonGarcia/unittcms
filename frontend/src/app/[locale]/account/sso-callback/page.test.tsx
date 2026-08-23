// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocaleCodeType } from '@/types/locale';

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  searchToken: '',
  setToken: vi.fn(),
  storeToken: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => mocks.searchToken }),
}));

vi.mock('@/src/i18n/routing', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');

  return {
    TokenContext: createContext({
      setToken: mocks.setToken,
      storeTokenToLocalStorage: mocks.storeToken,
    }),
  };
});

let SSOCallbackPage: typeof import('./page').default;

describe('unprefixed SSO callback locale resolution', () => {
  beforeAll(async () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    SSOCallbackPage = (await import('./page')).default;
  });

  beforeEach(() => {
    mocks.routerReplace.mockClear();
    mocks.setToken.mockClear();
    mocks.storeToken.mockClear();
  });

  async function renderCallback(locale: LocaleCodeType, userLocale: string | null) {
    mocks.searchToken = encodeURIComponent(JSON.stringify({ user: { locale: userLocale } }));
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SSOCallbackPage params={{ locale }} />);
    });

    return root;
  }

  async function unmount(root: ReturnType<typeof createRoot>) {
    await act(async () => {
      root.unmount();
    });
  }

  it('uses the stored locale when the callback is unprefixed', async () => {
    const root = await renderCallback('en', 'es');

    expect(mocks.routerReplace).toHaveBeenCalledWith('/projects', { locale: 'es' });
    expect(mocks.setToken).toHaveBeenCalledTimes(1);
    expect(mocks.storeToken).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('uses the negotiated callback locale when no stored locale exists', async () => {
    const root = await renderCallback('es', null);

    expect(mocks.routerReplace).toHaveBeenCalledWith('/projects', { locale: 'es' });
    await unmount(root);
  });
});
