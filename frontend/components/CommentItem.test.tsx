import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import CommentItem from './CommentItem';

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <button aria-label={props['aria-label'] as string}>{children}</button>
    ),
    Textarea: passthrough,
    Card: passthrough,
    CardBody: passthrough,
  };
});

vi.mock('./UserAvatar', () => ({ default: () => null }));

describe('localized comment actions', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it('uses translated accessible names for edit and delete actions', () => {
    const markup = renderToStaticMarkup(
      <CommentItem
        comment={{
          id: 1,
          commentableType: 'Case',
          commentableId: 2,
          userId: 3,
          content: 'Contenido',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          User: { id: 3, username: 'usuario', email: 'user@example.com' },
        }}
        isEditing={false}
        canEdit={true}
        editContent=""
        isSubmitting={false}
        messages={{
          comments: 'Comentarios',
          noComments: 'No hay comentarios',
          addComment: 'Añadir comentario',
          save: 'Guardar',
          cancel: 'Cancelar',
          placeholder: 'Escribe un comentario...',
          notIncludedInRun: 'No incluido',
          commentAdded: 'Comentario añadido',
          failedToAddComment: 'No se pudo añadir el comentario',
          commentUpdated: 'Comentario actualizado',
          failedToUpdateComment: 'No se pudo actualizar el comentario',
          commentDeleted: 'Comentario eliminado',
          failedToDeleteComment: 'No se pudo eliminar el comentario',
          editComment: 'Editar comentario',
          deleteComment: 'Eliminar comentario',
          unknownState: 'Estado desconocido',
          success: 'Éxito',
          error: 'Error',
        }}
        onEditContentChange={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />
    );

    expect(markup).toContain('aria-label="Editar comentario"');
    expect(markup).toContain('aria-label="Eliminar comentario"');
    expect(markup).not.toContain('Edit Comment');
    expect(markup).not.toContain('Delete Comment');
  });
});
