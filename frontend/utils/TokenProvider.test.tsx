// @vitest-environment happy-dom

import React, { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TokenProvider, { TokenContext } from './TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchMyRoles: vi.fn(),
  isProjectMember: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('./token', () => ({
  isSignedIn: (token: { access_token: string }) => Boolean(token.access_token),
  isAdmin: () => false,
  isProjectMember: mocks.isProjectMember,
  isProjectOnwer: () => false,
  isProjectManager: () => false,
  isProjectDeveloper: () => false,
  isProjectReporter: () => false,
  checkSignInPage: () => ({ ok: true }),
  fetchMyRoles: mocks.fetchMyRoles,
}));

vi.mock('./errorHandler', () => ({ logError: vi.fn() }));
vi.mock('@heroui/react', () => ({ addToast: vi.fn() }));
vi.mock('@/src/i18n/routing', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  usePathname: () => '/es/account',
}));

function LocaleProbe() {
  const { token } = useContext(TokenContext);
  return <output>{token.user?.locale ?? 'none'}</output>;
}

function ProjectMemberProbe() {
  const { isProjectMember } = useContext(TokenContext);
  return <output>{String(isProjectMember(10))}</output>;
}

describe('signed-in locale restoration', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.fetchMyRoles.mockReset();
    mocks.fetchMyRoles.mockResolvedValue([]);
    mocks.isProjectMember.mockReset();
    mocks.isProjectMember.mockReturnValue(false);
    mocks.routerPush.mockReset();
  });

  it('restores a stored Spanish locale before continuing the authenticated session', async () => {
    localStorage.setItem(
      'unittcms-auth-token',
      JSON.stringify({
        access_token: 'jwt',
        expires_at: 1,
        user: { id: 1, email: 'user@example.com', username: 'user', role: 1, avatarPath: null, locale: 'es' },
      })
    );
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenProvider locale="es">
          <LocaleProbe />
        </TokenProvider>
      );
    });

    expect(container.textContent).toBe('es');
    expect(mocks.fetchMyRoles).toHaveBeenCalledWith('jwt');
    await act(async () => root.unmount());
  });

  it('exposes the typed project membership helper through context', async () => {
    mocks.isProjectMember.mockReturnValue(true);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenProvider locale="en">
          <ProjectMemberProbe />
        </TokenProvider>
      );
    });

    expect(container.textContent).toBe('true');
    expect(mocks.isProjectMember).toHaveBeenLastCalledWith([], 10);
    await act(async () => root.unmount());
  });
});
