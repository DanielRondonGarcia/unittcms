import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HealthPage from './HealthPage';

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Table: ({ children, 'aria-label': ariaLabel }: { children?: React.ReactNode; 'aria-label'?: string }) => (
      <section aria-label={ariaLabel}>{children}</section>
    ),
    TableBody: passthrough,
    TableRow: passthrough,
    TableHeader: passthrough,
    TableCell: passthrough,
    TableColumn: passthrough,
    Chip: passthrough,
  };
});

describe('localized health status', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('renders Spanish loading text and an accessible API status label', () => {
    const markup = renderToStaticMarkup(
      <HealthPage
        locale="es"
        messages={{
          health_check: 'Comprobación de estado',
          status: 'Estado',
          ok: 'Correcto',
          error: 'Error',
          api_server: 'Servidor de API',
          unittcms_version: 'Versión de UnitTCMS',
          loading: 'Cargando...',
          apiServerStatus: 'Estado del servidor de API',
          healthColumn: 'Métrica de estado',
        }}
      />
    );

    expect(markup).toContain('Cargando...');
    expect(markup).toContain('aria-label="Estado del servidor de API"');
    expect(markup).not.toContain('Loading...');
    expect(markup).not.toContain('API server status');
  });
});
