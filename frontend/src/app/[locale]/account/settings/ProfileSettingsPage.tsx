'use client';
import { useState, useContext, useRef, useEffect } from 'react';
import { Button, Input, Card, CardHeader, CardBody, addToast, CardFooter, Select, SelectItem } from '@heroui/react';
import { Globe } from 'lucide-react';
import { TokenContext } from '@/utils/TokenProvider';
import {
  updateUsername,
  updatePassword,
  uploadAvatar,
  deleteAvatar,
  updateLocale,
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
  AccessTokenMetadata,
  AccessTokenScope,
} from '@/utils/usersControl';
import { LocaleCodeType } from '@/types/locale';
import { logError } from '@/utils/errorHandler';
import UserAvatar from '@/components/UserAvatar';
import { useRouter, usePathname } from '@/src/i18n/routing';
import { locales } from '@/config/selection';
import { LocaleType } from '@/types/locale';

type ProfileSettingsPageMessages = {
  profileSettings: string;
  changeUsername: string;
  newUsername: string;
  updateUsername: string;
  usernameUpdated: string;
  changePassword: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  updatePassword: string;
  passwordUpdated: string;
  changeLocale: string;
  updateLocale: string;
  localeUpdated: string;
  changeAvatar: string;
  uploadAvatar: string;
  removeAvatar: string;
  avatarUpdated: string;
  avatarRemoved: string;
  maxFileSize5mb: string;
  onlyImagesAllowed: string;
  currentPasswordIncorrect: string;
  updateError: string;
  invalidPassword: string;
  passwordNotMatch: string;
  usernameEmpty: string;
  invalidLocale: string;
  successTitle: string;
  warningTitle: string;
  errorTitle: string;
  changeLocaleAria: string;
  accessTokens: string;
  accessTokensDescription: string;
  tokenName: string;
  tokenScope: string;
  tokenScopeRead: string;
  tokenScopeReadWrite: string;
  tokenExpiryDays: string;
  tokenCreate: string;
  tokenCreated: string;
  tokenSecretWarning: string;
  tokenHeaderGuidance: string;
  tokenQueryStringWarning: string;
  tokenDismissSecret: string;
  tokenMetadata: string;
  tokenPrefix: string;
  tokenCreatedAt: string;
  tokenExpiresAt: string;
  tokenLastUsed: string;
  tokenStatus: string;
  tokenStatusActive: string;
  tokenStatusRevoked: string;
  tokenStatusExpired: string;
  tokenRevoke: string;
  tokenRevokeConfirm: string;
  tokenNoTokens: string;
  tokenCreateSuccess: string;
  tokenRevokeSuccess: string;
  tokenLoadError: string;
  tokenCreateError: string;
  tokenRevokeError: string;
  tokenExpiryInvalid: string;
  tokenScopeInvalid: string;
  tokenNameInvalid: string;
  tokenLastUsedNever: string;
};

type Props = {
  messages: ProfileSettingsPageMessages;
  locale: LocaleCodeType;
};

export default function ProfileSettingsPage({ messages, locale: defaultLocale }: Props) {
  const context = useContext(TokenContext);

  const router = useRouter();
  const pathname = usePathname();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [locale, setLocale] = useState<LocaleCodeType>(context.token?.user?.locale ?? defaultLocale);
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isUpdatingLocale, setIsUpdatingLocale] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [accessTokens, setAccessTokens] = useState<AccessTokenMetadata[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [tokenScope, setTokenScope] = useState<'read' | 'read+write'>('read');
  const [tokenExpiryDays, setTokenExpiryDays] = useState('30');
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<number | null>(null);

  useEffect(() => {
    if (!context.isSignedIn()) return;

    let isMounted = true;
    const loadTokens = async () => {
      setIsLoadingTokens(true);
      setTokenError('');
      try {
        const tokens = await listAccessTokens(context.token.access_token);
        if (isMounted) setAccessTokens(tokens);
      } catch (error) {
        logError('Error loading access tokens:', error);
        if (isMounted) {
          setTokenError(messages.tokenLoadError);
          addToast({ title: messages.errorTitle, color: 'danger', description: messages.tokenLoadError });
        }
      } finally {
        if (isMounted) setIsLoadingTokens(false);
      }
    };

    void loadTokens();
    return () => {
      isMounted = false;
    };
  }, [context, messages.errorTitle, messages.tokenLoadError]);

  const handleUsernameUpdate = async () => {
    if (!username.trim()) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.usernameEmpty,
      });
      return;
    }

    setIsUpdatingUsername(true);
    try {
      const result = await updateUsername(context.token.access_token, username);
      if (result && result.user) {
        // refresh username
        const newToken = { ...context.token };
        if (newToken.user) {
          newToken.user.username = result.user.username;
        }
        context.setToken(newToken);
        context.storeTokenToLocalStorage(newToken);

        addToast({
          title: messages.successTitle,
          color: 'success',
          description: messages.usernameUpdated,
        });
        setUsername('');
      }
    } catch (error) {
      logError('Error updating username:', error);
      addToast({
        title: messages.errorTitle,
        color: 'danger',
        description: messages.updateError,
      });
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!currentPassword || !newPassword) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.updateError,
      });
      return;
    }

    if (newPassword.length < 8) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.invalidPassword,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.passwordNotMatch,
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await updatePassword(context.token.access_token, currentPassword, newPassword);
      addToast({
        title: messages.successTitle,
        color: 'success',
        description: messages.passwordUpdated,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      logError('Error updating password:', error);
      const errorMessage = error instanceof Error ? error.message : messages.updateError;
      if (errorMessage.includes('incorrect')) {
        addToast({
          title: messages.errorTitle,
          color: 'danger',
          description: messages.currentPasswordIncorrect,
        });
      } else {
        addToast({
          title: messages.errorTitle,
          color: 'danger',
          description: messages.updateError,
        });
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleLocaleUpdate = async () => {
    if (!locales.some((l) => l.code === locale)) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.invalidLocale,
      });
      return;
    }

    setIsUpdatingLocale(true);
    try {
      const result = await updateLocale(context.token.access_token, locale);
      if (result && result.user) {
        // refresh locale
        const newToken = { ...context.token };
        if (newToken.user) {
          newToken.user.locale = result.user.locale;
        }
        context.setToken(newToken);
        context.storeTokenToLocalStorage(newToken);

        addToast({
          title: messages.successTitle,
          color: 'success',
          description: messages.localeUpdated,
        });
        const nextLocale = result.user.locale ?? locale;
        setLocale(nextLocale);
        changeLocale(nextLocale);
      }
    } catch (error) {
      logError('Error updating locale:', error);
      addToast({
        title: messages.errorTitle,
        color: 'danger',
        description: messages.updateError,
      });
    } finally {
      setIsUpdatingLocale(false);
    }
  };

  async function changeLocale(nextLocale: LocaleCodeType) {
    router.push(pathname, { locale: nextLocale });
  }

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.onlyImagesAllowed,
      });
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast({
        title: messages.warningTitle,
        color: 'warning',
        description: messages.maxFileSize5mb,
      });
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const result = await uploadAvatar(context.token.access_token, file);
      if (result && result.user) {
        const newToken = { ...context.token };
        if (newToken.user) {
          newToken.user = result.user;
        }
        context.setToken(newToken);
        context.storeTokenToLocalStorage(newToken);
        addToast({
          title: messages.successTitle,
          color: 'success',
          description: messages.avatarUpdated,
        });
      }
    } catch (error) {
      logError('Error uploading avatar:', error);
      addToast({
        title: messages.errorTitle,
        color: 'danger',
        description: messages.updateError,
      });
    } finally {
      setIsUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAvatarRemove = async () => {
    setIsUploadingAvatar(true);
    try {
      const result = await deleteAvatar(context.token.access_token);
      if (result && result.user) {
        const newToken = { ...context.token };
        if (newToken.user) {
          newToken.user = result.user;
        }
        context.setToken(newToken);
        context.storeTokenToLocalStorage(newToken);
        addToast({
          title: messages.successTitle,
          color: 'success',
          description: messages.avatarRemoved,
        });
      }
    } catch (error) {
      logError('Error removing avatar:', error);
      addToast({
        title: messages.errorTitle,
        color: 'danger',
        description: messages.updateError,
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleAccessTokenCreate = async () => {
    const expiresInDays = Number(tokenExpiryDays);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
      setTokenError(messages.tokenExpiryInvalid);
      addToast({ title: messages.warningTitle, color: 'warning', description: messages.tokenExpiryInvalid });
      return;
    }

    if (tokenName.trim().length > 100) {
      setTokenError(messages.tokenNameInvalid);
      addToast({ title: messages.warningTitle, color: 'warning', description: messages.tokenNameInvalid });
      return;
    }

    const scopes: AccessTokenScope[] = tokenScope === 'read+write' ? ['read', 'write'] : ['read'];
    if (scopes.length === 0) {
      setTokenError(messages.tokenScopeInvalid);
      addToast({ title: messages.warningTitle, color: 'warning', description: messages.tokenScopeInvalid });
      return;
    }

    setIsCreatingToken(true);
    setTokenError('');
    try {
      const created = await createAccessToken(context.token.access_token, {
        name: tokenName.trim() || undefined,
        scopes,
        expiresInDays,
      });
      const { secret, ...metadata } = created;
      setAccessTokens((currentTokens) => [metadata, ...currentTokens]);
      setNewlyCreatedSecret(secret);
      setTokenName('');
      setTokenExpiryDays('30');
      addToast({ title: messages.successTitle, color: 'success', description: messages.tokenCreateSuccess });
    } catch (error) {
      logError('Error creating access token:', error);
      setTokenError(messages.tokenCreateError);
      addToast({ title: messages.errorTitle, color: 'danger', description: messages.tokenCreateError });
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleAccessTokenRevoke = async (token: AccessTokenMetadata) => {
    if (token.revokedAt) return;
    if (!window.confirm(messages.tokenRevokeConfirm)) return;

    setRevokingTokenId(token.id);
    setTokenError('');
    try {
      await revokeAccessToken(context.token.access_token, token.id);
      const revokedAt = new Date().toISOString();
      setAccessTokens((currentTokens) =>
        currentTokens.map((currentToken) =>
          currentToken.id === token.id ? { ...currentToken, revokedAt } : currentToken
        )
      );
      addToast({ title: messages.successTitle, color: 'success', description: messages.tokenRevokeSuccess });
    } catch (error) {
      logError('Error revoking access token:', error);
      setTokenError(messages.tokenRevokeError);
      addToast({ title: messages.errorTitle, color: 'danger', description: messages.tokenRevokeError });
    } finally {
      setRevokingTokenId(null);
    }
  };

  const formatTokenDate = (dateValue: string | null) => {
    if (!dateValue) return messages.tokenLastUsedNever;
    const date = new Date(dateValue);
    return Number.isNaN(date.getTime())
      ? messages.tokenLastUsedNever
      : new Intl.DateTimeFormat(defaultLocale).format(date);
  };

  const tokenStatus = (token: AccessTokenMetadata) => {
    if (token.revokedAt) return messages.tokenStatusRevoked;
    if (new Date(token.expiresAt).getTime() <= Date.now()) return messages.tokenStatusExpired;
    return messages.tokenStatusActive;
  };

  if (!context.isSignedIn()) {
    return null;
  }

  return (
    <div className="container mx-auto max-w-xl pt-6 px-6 flex-grow">
      <h1 className="text-2xl font-bold mb-6">{messages.profileSettings}</h1>

      {/* Change Username */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-large font-semibold">{messages.changeUsername}</h2>
        </CardHeader>
        <CardBody>
          <form>
            <div className="space-y-4">
              <Input
                size="sm"
                autoComplete="username"
                label={messages.newUsername}
                placeholder={context.token?.user?.username || ''}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="dark-form-field"
              />
            </div>
          </form>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button
            color="primary"
            onPress={handleUsernameUpdate}
            isLoading={isUpdatingUsername}
            isDisabled={!username.trim()}
            size="sm"
          >
            {messages.updateUsername}
          </Button>
        </CardFooter>
      </Card>

      {/* Change Password */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-large font-semibold">{messages.changePassword}</h2>
        </CardHeader>
        <CardBody>
          <form>
            <div className="space-y-4">
              {/* hidden username field for accessibility */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={context.token?.user?.username || ''}
                style={{ display: 'none' }}
                tabIndex={-1}
                readOnly
              />
              <Input
                size="sm"
                type="password"
                autoComplete="current-password"
                label={messages.currentPassword}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="dark-form-field"
              />
              <Input
                size="sm"
                type="password"
                autoComplete="new-password"
                label={messages.newPassword}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="dark-form-field"
              />
              <Input
                size="sm"
                type="password"
                autoComplete="new-password"
                label={messages.confirmNewPassword}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="dark-form-field"
              />
            </div>
          </form>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            onPress={handlePasswordUpdate}
            isLoading={isUpdatingPassword}
            isDisabled={!currentPassword || !newPassword || !confirmPassword}
          >
            {messages.updatePassword}
          </Button>
        </CardFooter>
      </Card>

      {/* Change Locale */}
      <Card className="mb-6">
        <CardHeader>
          <Globe size={16} />
          <h2 className="text-large font-semibold ml-2">{messages.changeLocale}</h2>
        </CardHeader>
        <CardBody>
          <form>
            <div className="space-y-4">
              <Select<LocaleType>
                fullWidth
                aria-label={messages.changeLocaleAria}
                selectedKeys={[locale]}
                disabledKeys={[locale]}
                className="dark-form-field"
                onSelectionChange={(value) => {
                  const selectedLocale = locales.find((locale) => locale.code === value.currentKey);
                  if (!selectedLocale) return;
                  setLocale(selectedLocale.code);
                }}
              >
                {locales.map((locale) => (
                  <SelectItem key={locale.code}>{locale.name}</SelectItem>
                ))}
              </Select>
            </div>
          </form>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button
            color="primary"
            onPress={handleLocaleUpdate}
            isLoading={isUpdatingLocale}
            isDisabled={locale === context.token?.user?.locale}
            size="sm"
          >
            {messages.updateLocale}
          </Button>
        </CardFooter>
      </Card>

      {/* Change Avatar */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-large font-semibold">{messages.changeAvatar}</h2>
        </CardHeader>
        <CardBody>
          <form>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <UserAvatar
                  size={96}
                  username={context.token?.user?.username}
                  avatarPath={context.token?.user?.avatarPath}
                />
                <div className="text-sm text-gray-500">{messages.maxFileSize5mb}</div>
              </div>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
            </div>
          </form>
        </CardBody>
        <CardFooter className="flex justify-end">
          {context.token?.user?.avatarPath && (
            <Button
              size="sm"
              color="danger"
              className="me-2"
              onPress={handleAvatarRemove}
              isLoading={isUploadingAvatar}
            >
              {messages.removeAvatar}
            </Button>
          )}
          <Button size="sm" color="primary" onPress={() => fileInputRef.current?.click()} isLoading={isUploadingAvatar}>
            {messages.uploadAvatar}
          </Button>
        </CardFooter>
      </Card>

      {/* MCP access tokens */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-large font-semibold">{messages.accessTokens}</h2>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-gray-500">{messages.accessTokensDescription}</p>
          <div className="space-y-4">
            <Input
              size="sm"
              name="mcp-token-name"
              autoComplete="off"
              label={messages.tokenName}
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              className="dark-form-field"
            />
            <Select
              size="sm"
              aria-label={messages.tokenScope}
              selectedKeys={[tokenScope]}
              className="dark-form-field"
              onSelectionChange={(value) => {
                const selectedScope = value.currentKey;
                if (selectedScope === 'read' || selectedScope === 'read+write') setTokenScope(selectedScope);
              }}
            >
              <SelectItem key="read">{messages.tokenScopeRead}</SelectItem>
              <SelectItem key="read+write">{messages.tokenScopeReadWrite}</SelectItem>
            </Select>
            <Input
              size="sm"
              type="number"
              name="mcp-token-expiry-days"
              autoComplete="off"
              min={1}
              max={90}
              label={messages.tokenExpiryDays}
              value={tokenExpiryDays}
              onChange={(event) => setTokenExpiryDays(event.target.value)}
              className="dark-form-field"
              isInvalid={tokenError === messages.tokenExpiryInvalid}
              errorMessage={tokenError === messages.tokenExpiryInvalid ? messages.tokenExpiryInvalid : undefined}
            />
          </div>
          {tokenError && (
            <p className="mt-3 text-sm text-danger" role="alert" aria-live="polite">
              {tokenError}
            </p>
          )}
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button color="primary" onPress={handleAccessTokenCreate} isLoading={isCreatingToken} size="sm">
            {messages.tokenCreate}
          </Button>
        </CardFooter>
      </Card>

      {newlyCreatedSecret && (
        <Card className="mb-6 border-warning">
          <CardHeader>
            <h2 className="text-large font-semibold">{messages.tokenCreated}</h2>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-warning" role="status" aria-live="polite">
              {messages.tokenSecretWarning}
            </p>
            <Input
              size="sm"
              name="mcp-token-secret"
              autoComplete="off"
              label={messages.tokenCreated}
              value={newlyCreatedSecret}
              isReadOnly
              className="dark-form-field"
            />
            <p className="mt-3 text-sm text-gray-500">{messages.tokenHeaderGuidance}</p>
            <code className="mt-2 block break-all rounded bg-default-100 p-3 text-sm" translate="no">
              Authorization: Bearer &lt;your-token&gt;
            </code>
            <p className="mt-3 text-sm text-gray-500">{messages.tokenQueryStringWarning}</p>
          </CardBody>
          <CardFooter className="flex justify-end">
            <Button color="primary" variant="flat" onPress={() => setNewlyCreatedSecret(null)} size="sm">
              {messages.tokenDismissSecret}
            </Button>
          </CardFooter>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-large font-semibold">{messages.tokenMetadata}</h2>
        </CardHeader>
        <CardBody>
          {isLoadingTokens && (
            <p className="text-sm text-gray-500" role="status" aria-live="polite">
              {messages.tokenMetadata}…
            </p>
          )}
          {!isLoadingTokens && accessTokens.length === 0 && (
            <p className="text-sm text-gray-500">{messages.tokenNoTokens}</p>
          )}
          {!isLoadingTokens && accessTokens.length > 0 && (
            <div className="space-y-4">
              {accessTokens.map((token) => (
                <div key={token.id} className="rounded-lg border border-default-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="break-words font-medium">
                        {token.name || `${messages.tokenPrefix} ${token.tokenPrefix}`}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {messages.tokenPrefix}: {token.tokenPrefix}
                      </p>
                      <dl className="mt-2 space-y-1 text-sm text-gray-500">
                        <div>
                          <dt className="inline font-medium">{messages.tokenStatus}: </dt>
                          <dd className="inline">{tokenStatus(token)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">{messages.tokenCreatedAt}: </dt>
                          <dd className="inline">{formatTokenDate(token.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">{messages.tokenExpiresAt}: </dt>
                          <dd className="inline">{formatTokenDate(token.expiresAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">{messages.tokenLastUsed}: </dt>
                          <dd className="inline">{formatTokenDate(token.lastUsedAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    {!token.revokedAt && new Date(token.expiresAt).getTime() > Date.now() && (
                      <Button
                        color="danger"
                        variant="flat"
                        size="sm"
                        onPress={() => handleAccessTokenRevoke(token)}
                        isLoading={revokingTokenId === token.id}
                      >
                        {messages.tokenRevoke}
                      </Button>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-gray-500">
                    {messages.tokenScope}:{' '}
                    {token.scopes.includes('write') ? messages.tokenScopeReadWrite : messages.tokenScopeRead}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
