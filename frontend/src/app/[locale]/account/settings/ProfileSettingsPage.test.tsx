// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettingsPage from './ProfileSettingsPage';

const mocks = vi.hoisted(() => ({
  updateLocale: vi.fn(),
  setToken: vi.fn(),
  storeToken: vi.fn(),
  routerPush: vi.fn(),
  selectLocale: undefined as ((value: { currentKey: string }) => void) | undefined,
  updateLocaleButton: undefined as (() => void | Promise<void>) | undefined,
}));

vi.mock('@/utils/usersControl', () => ({
  updateLocale: mocks.updateLocale,
  updateUsername: vi.fn(),
  updatePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return {
    TokenContext: createContext({
      token: {
        access_token: 'jwt',
        expires_at: 1,
        user: { id: 1, email: 'user@example.com', username: 'user', role: 1, avatarPath: null, locale: 'en' },
      },
      isSignedIn: () => true,
      setToken: mocks.setToken,
      storeTokenToLocalStorage: mocks.storeToken,
    }),
  };
});

vi.mock('@/src/i18n/routing', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  usePathname: () => '/account/settings',
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void | Promise<void> }) => {
      if (children === 'Save locale') mocks.updateLocaleButton = onPress;
      return <button onClick={onPress}>{children}</button>;
    },
    Input: () => null,
    Card: passthrough,
    CardHeader: passthrough,
    CardBody: passthrough,
    CardFooter: passthrough,
    Select: ({
      children,
      onSelectionChange,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onSelectionChange?: (value: { currentKey: string }) => void;
      'aria-label'?: string;
    }) => {
      mocks.selectLocale = onSelectionChange;
      return <select aria-label={ariaLabel}>{children}</select>;
    },
    SelectItem: ({ children }: { children?: React.ReactNode }) => <option>{children}</option>,
    addToast: vi.fn(),
  };
});

vi.mock('@/components/UserAvatar', () => ({ default: () => null }));
vi.mock('lucide-react', () => ({ Globe: () => null }));

const messageKeys =
  'profileSettings changeUsername newUsername updateUsername usernameUpdated changePassword currentPassword newPassword confirmNewPassword updatePassword passwordUpdated changeLocale updateLocale localeUpdated changeAvatar uploadAvatar removeAvatar avatarUpdated avatarRemoved maxFileSize5mb onlyImagesAllowed currentPasswordIncorrect updateError invalidPassword passwordNotMatch usernameEmpty invalidLocale'.split(
    ' '
  );
const messages = Object.fromEntries(messageKeys.map((key) => [key, key])) as Parameters<
  typeof ProfileSettingsPage
>[0]['messages'];
messages.updateLocale = 'Save locale';
messages.successTitle = 'Success';
messages.warningTitle = 'Warning';
messages.errorTitle = 'Error';
messages.changeLocaleAria = 'change locale';

describe('profile Spanish locale persistence', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLocale = undefined;
    mocks.updateLocaleButton = undefined;
    mocks.updateLocale.mockResolvedValue({ user: { locale: 'es' } });
  });

  it('updates the signed-in token and route through the existing preference flow', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<ProfileSettingsPage messages={messages} locale="en" />);
    });
    await act(async () => {
      mocks.selectLocale?.({ currentKey: 'es' });
    });
    await act(async () => {
      await mocks.updateLocaleButton?.();
    });

    expect(mocks.updateLocale).toHaveBeenCalledWith('jwt', 'es');
    expect(mocks.setToken).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ locale: 'es' }) })
    );
    expect(mocks.storeToken).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ locale: 'es' }) })
    );
    expect(mocks.routerPush).toHaveBeenCalledWith('/account/settings', { locale: 'es' });
    await act(async () => root.unmount());
  });
});
