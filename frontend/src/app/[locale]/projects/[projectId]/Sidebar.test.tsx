// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    startContent,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
    startContent?: React.ReactNode;
  }) => (
    <button disabled={isDisabled} onClick={onPress}>
      {startContent}
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  PanelLeftClose: () => null,
  PanelLeftOpen: () => null,
  ChartColumnStacked: () => null,
  ClipboardList: () => null,
  FlaskConical: () => null,
  FileText: () => null,
  UserRound: () => null,
  Settings: () => null,
}));

vi.mock('@/src/i18n/routing', () => ({
  usePathname: () => '/projects/1/home',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/utils/useGetCurrentIds', () => ({
  default: () => ({ projectId: '1' }),
}));

const messages = {
  toggleSidebar: 'Toggle sidebar',
  home: 'Home',
  testCases: 'Test cases',
  testRuns: 'Test runs',
  reports: 'Reports',
  members: 'Members',
  settings: 'Settings',
};

describe('Sidebar', () => {
  let root: ReturnType<typeof createRoot> | undefined;

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  it('renders the localized Reports label without a client translation provider', () => {
    const container = document.createElement('div');
    root = createRoot(container);

    act(() => {
      root?.render(<Sidebar messages={messages} locale="en" />);
    });

    expect(container.textContent).toContain('Reports');
  });
});
