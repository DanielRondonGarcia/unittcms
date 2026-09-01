import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import RunLayout from './layout';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock('./RunEditor', () => ({ default: () => null }));
vi.mock('@/components/ResizablePane', () => ({ default: () => null }));

type ResizableProps = {
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
};

describe('run layout', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('passes route-specific sidebar width bounds', () => {
    const layout = RunLayout({
      children: <div />,
      params: { projectId: '1', runId: '2', locale: 'en' },
    });
    const props = (layout as React.ReactElement<ResizableProps>).props;

    expect(props).toMatchObject({
      defaultLeftWidth: 60,
      minLeftWidth: 50,
      minRightWidth: 30,
    });
  });
});
