/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Comments from './Comments';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  setComment: undefined as ((value: string) => void) | undefined,
}));

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
  }) => (
    <button disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  ),
  Textarea: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => {
    mocks.setComment = onValueChange;
    return (
      <textarea value={value} placeholder={placeholder} onChange={(event) => onValueChange?.(event.target.value)} />
    );
  },
  Card: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  CardBody: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Spinner: () => <span>loading</span>,
  addToast: mocks.addToast,
}));

vi.mock('./CommentItem', () => ({ default: () => null }));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('@/utils/commentControl', () => ({
  fetchComments: mocks.fetchComments,
  createComment: mocks.createComment,
  updateComment: mocks.updateComment,
  deleteComment: mocks.deleteComment,
}));

const messages = {
  comments: 'Comentarios',
  noComments: 'No hay comentarios',
  addComment: 'Añadir comentario',
  save: 'Guardar',
  cancel: 'Cancelar',
  placeholder: 'Escribe un comentario...',
  notIncludedInRun: 'No incluido en la ejecución',
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
};

const contextValue = {
  token: {
    access_token: 'token',
    expires_at: 0,
    user: {
      id: 1,
      email: 'user@example.com',
      password: '',
      username: 'usuario',
      role: 0,
      avatarPath: null,
      locale: 'es',
    },
  },
  isSignedIn: () => true,
  isProjectReporter: () => true,
};

describe('localized comment toasts', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.addToast.mockClear();
    mocks.setComment = undefined;
    mocks.fetchComments.mockResolvedValue([]);
    mocks.createComment.mockResolvedValue({
      id: 2,
      commentableType: 'Case',
      commentableId: 1,
      userId: 1,
      content: 'Nuevo comentario',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      User: contextValue.token.user,
    });
  });

  it('uses the translated success title when a comment is added', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <Comments projectId="1" commentableType="Case" commentableId={1} messages={messages} />
        </TokenContext.Provider>
      );
      await Promise.resolve();
    });

    expect(mocks.setComment).toBeTypeOf('function');
    await act(async () => {
      mocks.setComment?.('Nuevo comentario');
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.addComment
    );
    expect(addButton).not.toBeNull();
    await act(async () => {
      addButton?.click();
      await Promise.resolve();
    });

    expect(mocks.addToast).toHaveBeenCalledWith({
      title: messages.success,
      color: 'success',
      description: messages.commentAdded,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
