/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import HerculesModelSettings from './HerculesModelSettings';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({ fetchModel: vi.fn() }));

vi.mock('@/utils/automationControl', async () => {
  const actual = await vi.importActual<typeof import('@/utils/automationControl')>('@/utils/automationControl');
  return { ...actual, fetchAutomationOrganizationModel: mocks.fetchModel };
});

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('@heroui/react', () => ({
  addToast: vi.fn(),
  Button: ({
    children,
    isDisabled,
    isLoading,
    onPress,
    ...props
  }: {
    children?: React.ReactNode;
    isDisabled?: boolean;
    isLoading?: boolean;
    onPress?: () => void;
    [key: string]: unknown;
  }) => {
    void isDisabled;
    void isLoading;
    void onPress;
    return <button {...props}>{children}</button>;
  },
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Input: ({
    label,
    isDisabled,
    isInvalid,
    errorMessage,
    ...props
  }: {
    label?: React.ReactNode;
    isDisabled?: boolean;
    isInvalid?: boolean;
    errorMessage?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    void isDisabled;
    void isInvalid;
    void errorMessage;
    return (
      <label>
        {label}
        <input {...props} />
      </label>
    );
  },
}));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
  isProjectOwner: () => true,
};

const messages = {
  automationModel: 'Hercules AI model',
  automationModelDescription: 'Configure the organization model.',
  automationModelPlaceholder: 'For example, gpt-4o-mini',
  automationModelLoading: 'Loading AI model',
  automationModelSaved: 'Hercules AI model saved',
  automationModelError: 'The Hercules AI model could not be loaded or saved.',
  automationModelSave: 'Save AI model',
};

describe('HerculesModelSettings', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    mocks.fetchModel.mockReset();
  });

  it('gives the model field a stable name and non-password autocomplete behavior', async () => {
    mocks.fetchModel.mockResolvedValue({ id: 4, name: 'Acme', herculesModel: 'gpt-4o-mini' });
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <HerculesModelSettings projectId="10" messages={messages as never} />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('name')).toBe('hercules-model');
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('spellcheck')).toBe('false');
  });
});
