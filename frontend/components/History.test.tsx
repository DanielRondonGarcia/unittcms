import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import History from './History';

vi.mock('@heroui/react', () => ({
  Alert: ({ title, description }: { title: string; description: string }) => (
    <div>
      {title}
      {description}
    </div>
  ),
}));

describe('localized history panel', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('renders translated history status text', () => {
    const markup = renderToStaticMarkup(
      <History
        messages={{
          history: 'Historial',
          noticeTitle: 'Historial',
          unavailable: 'La función de historial aún no está disponible',
        }}
      />
    );

    expect(markup).toContain('Historial');
    expect(markup).toContain('La función de historial aún no está disponible');
    expect(markup).not.toContain('Sorry');
    expect(markup).not.toContain('History function will be implemented');
  });
});
