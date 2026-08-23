import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import PasswordResetDialog from './PasswordResetDialog';

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Button: passthrough,
    Modal: passthrough,
    ModalContent: passthrough,
    ModalHeader: passthrough,
    ModalBody: passthrough,
    ModalFooter: passthrough,
    Input: ({ label }: { label?: string }) => <label>{label}</label>,
  };
});

describe('localized password reset dialog', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('renders translated password field labels', () => {
    const markup = renderToStaticMarkup(
      <PasswordResetDialog
        isOpen={true}
        onCancel={() => {}}
        onReset={() => {}}
        messages={{
          userManagement: 'Gestión de usuarios',
          avatar: 'Avatar',
          id: 'ID',
          email: 'Correo electrónico',
          username: 'Nombre de usuario',
          role: 'Rol',
          noUsersFound: 'No se encontraron usuarios',
          administrator: 'Administrador',
          user: 'Usuario',
          quitAdmin: 'Abandonar administración',
          quit: 'Abandonar',
          quitConfirm: 'Confirmar',
          close: 'Cerrar',
          roleChanged: 'Rol cambiado',
          lostAdminAuth: 'Autoridad perdida',
          atLeast: 'Al menos uno',
          resetPassword: 'Restablecer contraseña',
          reset: 'Restablecer',
          invalidPassword: 'Contraseña no válida',
          passwordNotMatch: 'Las contraseñas no coinciden',
          newPassword: 'Nueva contraseña',
          confirmNewPassword: 'Confirmar nueva contraseña',
          passwordUpdated: 'Contraseña actualizada',
          successTitle: 'Éxito',
          errorTitle: 'Error',
          passwordUpdatedTitle: 'Contraseña actualizada',
          roleActions: 'Acciones de rol',
          resetActions: 'Acciones estáticas',
          usersTable: 'Tabla de usuarios',
        }}
      />
    );

    expect(markup).toContain('Nueva contraseña');
    expect(markup).toContain('Confirmar nueva contraseña');
    expect(markup).not.toContain('New Password');
    expect(markup).not.toContain('Confirm New Password');
  });
});
