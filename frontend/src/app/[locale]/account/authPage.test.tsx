// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthPage from './authPage';

type InputChange = (event: { target: { value: string } }) => void;

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  fetchRegistrationEnabled: vi.fn(),
  setToken: vi.fn(),
  storeToken: vi.fn(),
  routerPush: vi.fn(),
  inputs: new Map<string, InputChange>(),
  buttons: new Map<string, () => void | Promise<void>>(),
}));

vi.mock('./authControl', () => ({
  signIn: mocks.signIn,
  signUp: mocks.signUp,
  signInAsGuest: vi.fn(),
}));

vi.mock('@/utils/registrationAvailable', () => ({
  fetchRegistrationEnabled: mocks.fetchRegistrationEnabled,
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return {
    TokenContext: createContext({ setToken: mocks.setToken, storeTokenToLocalStorage: mocks.storeToken }),
  };
});

vi.mock('@/src/i18n/routing', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  return {
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void | Promise<void> }) => {
      if (typeof children === 'string' && onPress) mocks.buttons.set(children, onPress);
      return <button onClick={onPress}>{children}</button>;
    },
    Card: passthrough,
    CardHeader: passthrough,
    CardBody: passthrough,
    Input: ({ label, onChange }: { label?: string; onChange?: InputChange }) => {
      if (label && onChange) mocks.inputs.set(label, onChange);
      return null;
    },
  };
});

vi.mock('@/config/config', () => ({ default: { isDemoSite: false, apiServer: 'http://api.test' } }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/icons', () => ({ OpenIdIcon: () => null }));
vi.mock('lucide-react', () => ({ ChevronRight: () => null, Eye: () => null, EyeOff: () => null }));

const messageKeys =
  'title linkTitle submitTitle signInAsGuest signInWithSso or email username password confirmPassword invalidEmail invalidPassword usernameEmpty passwordDoesNotMatch EmailAlreadyExist emailNotExist signupError registrationDisabled signinError demoPageWarning'.split(
    ' '
  );
const messages = Object.fromEntries(messageKeys.map((key) => [key, key])) as Parameters<typeof AuthPage>[0]['messages'];

function tokenWithLocale(locale: string | null) {
  return {
    access_token: 'jwt',
    expires_at: 1,
    user: { id: 1, email: 'user@example.com', password: '', username: 'user', role: 1, avatarPath: null, locale },
  };
}

async function setInput(label: string, value: string) {
  await act(async () => {
    mocks.inputs.get(label)?.({ target: { value } });
  });
}

async function renderAndSubmit(isSignup: boolean, locale: 'en' | 'es', returnedLocale: string | null) {
  mocks.signIn.mockResolvedValue(tokenWithLocale(returnedLocale));
  mocks.signUp.mockResolvedValue(tokenWithLocale(returnedLocale));
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(<AuthPage isSignup={isSignup} messages={messages} locale={locale} ssoEnabled={false} />);
  });
  await setInput(messages.email, 'user@example.com');
  await setInput(messages.password, 'password123');
  if (isSignup) {
    await setInput(messages.username, 'user');
    await setInput(messages.confirmPassword, 'password123');
  }
  await act(async () => {
    await mocks.buttons.get(messages.submitTitle)?.();
  });

  return root;
}

describe('authentication locale fallback', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRegistrationEnabled.mockResolvedValue(true);
    mocks.inputs.clear();
    mocks.buttons.clear();
  });

  it('uses the stored Spanish locale after sign-in', async () => {
    const root = await renderAndSubmit(false, 'en', 'es');

    expect(mocks.routerPush).toHaveBeenCalledWith('/account', { locale: 'es' });
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('falls back to the active Spanish locale after signup has no stored preference', async () => {
    const root = await renderAndSubmit(true, 'es', null);

    expect(mocks.routerPush).toHaveBeenCalledWith('/account', { locale: 'es' });
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
