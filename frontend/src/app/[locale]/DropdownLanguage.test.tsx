import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import DropdownLanguage from './DropdownLanguage';

vi.mock('@heroui/react', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  DropdownTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Dropdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenu: ({ children, 'aria-label': ariaLabel }: { children?: React.ReactNode; 'aria-label'?: string }) => (
    <div aria-label={ariaLabel}>{children}</div>
  ),
  DropdownItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Globe: () => null,
  ChevronDown: () => null,
}));

describe('localized language dropdown', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('uses the translated language label for its accessible menu name', () => {
    const markup = renderToStaticMarkup(
      <DropdownLanguage locale="es" onChangeLocale={() => {}} languageLabel="Idiomas" />
    );

    expect(markup).toContain('aria-label="Idiomas"');
    expect(markup).not.toContain('aria-label="locales"');
  });
});
