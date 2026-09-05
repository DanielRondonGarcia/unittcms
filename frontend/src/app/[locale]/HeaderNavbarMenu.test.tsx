import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let HeaderNavbarMenu: typeof import('./HeaderNavbarMenu').default;

const mocks = vi.hoisted(() => ({
  pathname: '/en/projects',
  routerPush: vi.fn(),
  storeToken: vi.fn(),
  removeToken: vi.fn(),
  spanishOnPress: undefined as (() => void) | undefined,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('@/src/i18n/routing', () => ({
  Link: () => null,
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');

  return {
    TokenContext: createContext({
      token: { user: null },
      isAdmin: () => false,
      isSignedIn: () => false,
      setToken: vi.fn(),
      storeTokenToLocalStorage: mocks.storeToken,
      removeTokenFromLocalStorage: mocks.removeToken,
    }),
  };
});

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: unknown }) => children;

  return {
    Navbar: passthrough,
    NavbarContent: passthrough,
    NavbarMenu: passthrough,
    NavbarMenuToggle: () => null,
    NavbarBrand: passthrough,
    NavbarItem: passthrough,
    Link: passthrough,
    Listbox: passthrough,
    ListboxItem: ({ title, onPress }: { title?: string; onPress?: () => void }) => {
      if (title === 'Español') mocks.spanishOnPress = onPress;
      return null;
    },
  };
});

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/ThemeSwitch', () => ({ ThemeSwitch: () => null }));
vi.mock('@/components/icons', () => ({ GithubIcon: () => null }));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@/config/config', () => ({ default: { isDemoSite: false } }));
vi.mock('@/utils/registrationAvailable', () => ({ fetchRegistrationEnabled: () => Promise.resolve(true) }));
vi.mock('./DropdownAccount', () => ({ default: () => null }));
vi.mock('./DropdownLanguage', () => ({ default: () => null }));

const messages = {
  projects: 'Projects',
  admin: 'Admin',
  docs: 'Docs',
  roadmap: 'Roadmap',
  account: 'Account',
  profileSettings: 'Profile settings',
  signUp: 'Sign up',
  signIn: 'Sign in',
  signOut: 'Sign out',
  links: 'Links',
  languages: 'Languages',
  accountActionsSignedIn: 'account actions when sign in',
  accountActionsSignedOut: 'account actions when sign out',
  languageMenu: 'locales',
  linksAria: 'Links',
  accountLinksAria: 'Account links',
  languageLinksAria: 'Language links',
  github: 'GitHub',
};

function renderMenu() {
  renderToStaticMarkup(<HeaderNavbarMenu messages={messages} locale="en" />);
}

describe('anonymous locale switching', () => {
  beforeAll(async () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    HeaderNavbarMenu = (await import('./HeaderNavbarMenu')).default;
  });

  beforeEach(() => {
    mocks.pathname = '/en/projects';
    mocks.routerPush.mockClear();
    mocks.storeToken.mockClear();
    mocks.removeToken.mockClear();
    mocks.spanishOnPress = undefined;
  });

  it('pushes the equivalent Spanish route without persisting a preference', () => {
    renderMenu();

    expect(mocks.spanishOnPress).toBeTypeOf('function');
    mocks.spanishOnPress?.();

    expect(mocks.routerPush).toHaveBeenCalledWith('/projects', { locale: 'es' });
    expect(mocks.storeToken).not.toHaveBeenCalled();
    expect(mocks.removeToken).not.toHaveBeenCalled();
  });

  it('keeps the root route unprefixed when switching from the root page', () => {
    mocks.pathname = '/';
    renderMenu();

    expect(mocks.spanishOnPress).toBeTypeOf('function');
    mocks.spanishOnPress?.();

    expect(mocks.routerPush).toHaveBeenCalledWith('/', { locale: 'es' });
  });
});
