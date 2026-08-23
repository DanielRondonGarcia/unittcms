import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ErrorPage from './error';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'UI' && key === 'something_went_wrong') return 'Algo salió mal';
    if (namespace === 'UI' && key === 'try_again') return 'Intentar de nuevo';
    return key;
  },
}));

describe('localized application error page', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('renders the translated error and recovery action', () => {
    const markup = renderToStaticMarkup(<ErrorPage error={new Error('request failed')} reset={() => {}} />);

    expect(markup).toContain('Algo salió mal');
    expect(markup).toContain('Intentar de nuevo');
    expect(markup).not.toContain('Something went wrong');
    expect(markup).not.toContain('Try again');
  });
});
