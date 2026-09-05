/** @vitest-environment happy-dom */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettingsPage from './ProfileSettingsPage';

const mocks = vi.hoisted(() => ({
  listAccessTokens: vi.fn(),
  createAccessToken: vi.fn(),
  revokeAccessToken: vi.fn(),
  updateLocale: vi.fn(),
  setToken: vi.fn(),
  storeToken: vi.fn(),
  logError: vi.fn(),
  addToast: vi.fn(),
  tokenScopeSelection: undefined as ((value: { currentKey: string }) => void) | undefined,
  tokenExpiryChange: undefined as ((event: { target: { value: string } }) => void) | undefined,
}));

vi.mock('@/utils/usersControl', () => ({
  updateLocale: mocks.updateLocale,
  listAccessTokens: mocks.listAccessTokens,
  updateUsername: vi.fn(),
  updatePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  createAccessToken: mocks.createAccessToken,
  revokeAccessToken: mocks.revokeAccessToken,
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

vi.mock('@/utils/errorHandler', () => ({ logError: mocks.logError }));

vi.mock('@/src/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/account/settings',
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  return {
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void | Promise<void> }) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    Input: ({
      label,
      name,
      onChange,
      isDisabled,
      isInvalid,
      errorMessage,
      isReadOnly,
      size,
      ...rest
    }: {
      label?: React.ReactNode;
      name?: string;
      onChange?: React.ChangeEventHandler<HTMLInputElement>;
      isDisabled?: boolean;
      isInvalid?: boolean;
      errorMessage?: React.ReactNode;
      isReadOnly?: boolean;
      size?: string;
      [key: string]: unknown;
    }) => {
      void isInvalid;
      void errorMessage;
      void size;
      if (name === 'mcp-token-expiry-days') mocks.tokenExpiryChange = onChange as never;
      return (
        <label>
          {label}
          <input
            {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
            name={name}
            disabled={isDisabled}
            readOnly={isReadOnly}
            onChange={onChange}
          />
        </label>
      );
    },
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
      if (ariaLabel === 'Token scope') mocks.tokenScopeSelection = onSelectionChange;
      return (
        <select
          aria-label={ariaLabel}
          onChange={(event) => onSelectionChange?.({ currentKey: event.currentTarget.value })}
        >
          {children}
        </select>
      );
    },
    SelectItem: ({ children }: { children?: React.ReactNode }) => <option>{children}</option>,
    addToast: mocks.addToast,
  };
});

vi.mock('@/components/UserAvatar', () => ({ default: () => null }));
vi.mock('lucide-react', () => ({ Globe: () => null }));

const messages = {
  profileSettings: 'Profile settings',
  changeUsername: 'Change username',
  newUsername: 'New username',
  updateUsername: 'Update username',
  usernameUpdated: 'Username updated',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  confirmNewPassword: 'Confirm new password',
  updatePassword: 'Update password',
  passwordUpdated: 'Password updated',
  changeLocale: 'Change locale',
  updateLocale: 'Save locale',
  localeUpdated: 'Locale updated',
  changeAvatar: 'Change avatar',
  uploadAvatar: 'Upload avatar',
  removeAvatar: 'Remove avatar',
  avatarUpdated: 'Avatar updated',
  avatarRemoved: 'Avatar removed',
  maxFileSize5mb: 'Maximum file size is 5 MB',
  onlyImagesAllowed: 'Only images are allowed',
  currentPasswordIncorrect: 'Current password is incorrect',
  updateError: 'Update failed',
  invalidPassword: 'Password is invalid',
  passwordNotMatch: 'Passwords do not match',
  usernameEmpty: 'Username is required',
  invalidLocale: 'Locale is invalid',
  successTitle: 'Success',
  warningTitle: 'Warning',
  errorTitle: 'Error',
  changeLocaleAria: 'Change locale',
  accessTokens: 'MCP access tokens',
  accessTokensDescription: 'Create scoped tokens for MCP access.',
  tokenName: 'Token name',
  tokenScope: 'Token scope',
  tokenScopeRead: 'Read',
  tokenScopeReadWrite: 'Read and write',
  tokenExpiryDays: 'Expiry days',
  tokenCreate: 'Create token',
  tokenCreated: 'Token created',
  tokenSecretWarning: 'Copy this secret now. It will not be shown again.',
  tokenHeaderGuidance: 'Use this token in the Authorization header.',
  tokenUsageExample: 'Example MCP initialize request.',
  tokenQueryStringWarning: 'Query-string tokens are not accepted.',
  tokenDismissSecret: 'Dismiss secret',
  tokenMetadata: 'Token metadata',
  tokenPrefix: 'Prefix',
  tokenCreatedAt: 'Created',
  tokenExpiresAt: 'Expires',
  tokenLastUsed: 'Last used',
  tokenStatus: 'Status',
  tokenStatusActive: 'Active',
  tokenStatusRevoked: 'Revoked',
  tokenStatusExpired: 'Expired',
  tokenRevoke: 'Revoke',
  tokenRevokeConfirm: 'Revoke this token?',
  tokenNoTokens: 'No tokens',
  tokenCreateSuccess: 'Token created successfully',
  tokenRevokeSuccess: 'Token revoked successfully',
  tokenLoadError: 'Tokens could not be loaded',
  tokenCreateError: 'Token could not be created',
  tokenRevokeError: 'Token could not be revoked',
  tokenExpiryInvalid: 'Expiry must be between 1 and 90 days',
  tokenScopeInvalid: 'Select a valid token scope',
  tokenNameInvalid: 'Token name is invalid',
  tokenLastUsedNever: 'Never',
} as Parameters<typeof ProfileSettingsPage>[0]['messages'];

const metadata = {
  id: 7,
  name: 'Automation client',
  tokenPrefix: 'mcp_1234',
  scopes: ['read'] as const,
  expiresAt: '2030-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: '2029-01-01T00:00:00.000Z',
};

const roots: Root[] = [];
const originalConfirm = window.confirm;

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

async function renderPage() {
  const container = document.createElement('div');
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<ProfileSettingsPage messages={messages} locale="en" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function unmountRoot(root: Root) {
  await act(async () => root.unmount());
  const index = roots.indexOf(root);
  if (index >= 0) roots.splice(index, 1);
}

describe('ProfileSettingsPage MCP access-token lifecycle', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenScopeSelection = undefined;
    mocks.tokenExpiryChange = undefined;
    mocks.listAccessTokens.mockResolvedValue([]);
    mocks.createAccessToken.mockResolvedValue({
      ...metadata,
      id: 8,
      name: 'Created token',
      tokenPrefix: 'mcp_5678',
      secret: 'mcp-secret-once',
    });
    mocks.revokeAccessToken.mockResolvedValue(undefined);
    window.confirm = vi.fn(() => true);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.confirm = originalConfirm;
  });

  it('reveals a created secret once, removes it on dismissal, and keeps it out of metadata state', async () => {
    mocks.listAccessTokens.mockResolvedValue([metadata]);
    const { container } = await renderPage();

    await act(async () => {
      mocks.tokenScopeSelection?.({ currentKey: 'read+write' });
      mocks.tokenExpiryChange?.({ target: { value: '45' } });
    });
    await act(async () => {
      buttonByText(container, messages.tokenCreate).click();
      await Promise.resolve();
    });

    expect(mocks.createAccessToken).toHaveBeenCalledWith('jwt', {
      name: undefined,
      scopes: ['read', 'write'],
      expiresInDays: 45,
    });
    expect(container.querySelector<HTMLInputElement>('[name="mcp-token-secret"]')?.value).toBe('mcp-secret-once');
    expect(container.textContent).toContain(messages.tokenSecretWarning);
    expect(container.textContent).toContain('/api/mcp');
    expect(container.textContent).toContain('Authorization: Bearer <token>');
    expect(container.textContent).toContain('"jsonrpc": "2.0"');
    expect(mocks.storeToken).not.toHaveBeenCalledWith(expect.objectContaining({ secret: 'mcp-secret-once' }));

    await act(async () => {
      buttonByText(container, messages.tokenDismissSecret).click();
    });

    expect(container.querySelector('[name="mcp-token-secret"]')).toBeNull();
    expect(container.textContent).not.toContain('mcp-secret-once');
    expect(container.textContent).toContain('mcp_1234');
  });

  it('rejects an out-of-range expiry before the API and accepts the read/write scope choice', async () => {
    const { container } = await renderPage();

    await act(async () => {
      mocks.tokenExpiryChange?.({ target: { value: '91' } });
    });
    await act(async () => {
      buttonByText(container, messages.tokenCreate).click();
    });

    expect(mocks.createAccessToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain(messages.tokenExpiryInvalid);

    await act(async () => {
      mocks.tokenExpiryChange?.({ target: { value: '30' } });
      mocks.tokenScopeSelection?.({ currentKey: 'read+write' });
    });
    await act(async () => {
      buttonByText(container, messages.tokenCreate).click();
      await Promise.resolve();
    });

    expect(mocks.createAccessToken).toHaveBeenCalledWith('jwt', {
      name: undefined,
      scopes: ['read', 'write'],
      expiresInDays: 30,
    });
  });

  it('reloads metadata for a fresh Settings mount without restoring a secret', async () => {
    const firstToken = { ...metadata, name: 'First token' };
    const secondToken = { ...metadata, id: 8, name: 'Reloaded token' };
    mocks.listAccessTokens.mockResolvedValueOnce([firstToken]).mockResolvedValueOnce([secondToken]);

    const first = await renderPage();
    expect(mocks.listAccessTokens).toHaveBeenCalledWith('jwt');
    expect(first.container.textContent).toContain('First token');
    await unmountRoot(first.root);

    const second = await renderPage();
    expect(mocks.listAccessTokens).toHaveBeenCalledTimes(2);
    expect(second.container.textContent).toContain('Reloaded token');
    expect(second.container.querySelector('[name="mcp-token-secret"]')).toBeNull();
  });

  it('requires revoke confirmation and marks the confirmed token as revoked', async () => {
    mocks.listAccessTokens.mockResolvedValue([metadata]);
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    const { container } = await renderPage();

    await act(async () => {
      buttonByText(container, messages.tokenRevoke).click();
    });
    expect(confirm).toHaveBeenCalledWith(messages.tokenRevokeConfirm);
    expect(mocks.revokeAccessToken).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText(container, messages.tokenRevoke).click();
      await Promise.resolve();
    });

    expect(mocks.revokeAccessToken).toHaveBeenCalledWith('jwt', metadata.id);
    expect(container.textContent).toContain(messages.tokenStatusRevoked);
    expect(
      Array.from(container.querySelectorAll('button')).some((button) => button.textContent === messages.tokenRevoke)
    ).toBe(false);
  });

  it('renders API error states for metadata loading, creation, and revocation without logging secrets', async () => {
    mocks.listAccessTokens.mockRejectedValueOnce(new Error('metadata unavailable'));
    const loadFailure = await renderPage();
    expect(loadFailure.container.textContent).toContain(messages.tokenLoadError);
    expect(mocks.logError.mock.calls.flat().join(' ')).not.toContain('mcp-secret-once');
    await unmountRoot(loadFailure.root);

    mocks.listAccessTokens.mockResolvedValue([metadata]);
    mocks.createAccessToken.mockRejectedValueOnce(new Error('creation unavailable'));
    const createFailure = await renderPage();
    await act(async () => {
      buttonByText(createFailure.container, messages.tokenCreate).click();
      await Promise.resolve();
    });
    expect(createFailure.container.textContent).toContain(messages.tokenCreateError);
    expect(mocks.logError.mock.calls.flat().join(' ')).not.toContain('mcp-secret-once');
    await unmountRoot(createFailure.root);

    mocks.listAccessTokens.mockResolvedValue([metadata]);
    mocks.revokeAccessToken.mockRejectedValueOnce(new Error('revocation unavailable'));
    const revokeFailure = await renderPage();
    await act(async () => {
      buttonByText(revokeFailure.container, messages.tokenRevoke).click();
      await Promise.resolve();
    });
    expect(revokeFailure.container.textContent).toContain(messages.tokenRevokeError);
    expect(revokeFailure.container.textContent).toContain(messages.tokenStatusActive);
    expect(mocks.logError.mock.calls.flat().join(' ')).not.toContain('mcp-secret-once');
  });
});
