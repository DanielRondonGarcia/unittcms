import { Button } from '@heroui/react';
import type { ApiError } from '@/utils/apiResult';

export type RequestStateMessages = {
  loading: string;
  requestError: string;
  retry: string;
  retryAfter: string;
  correlationId: string;
};

export function LoadingState({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-24 items-center justify-center p-6 text-sm text-default-500"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center p-6 text-sm text-default-500" role="status">
      {message}
    </div>
  );
}

export function RequestErrorState({
  error,
  messages,
  onRetry,
}: {
  error: ApiError;
  messages: RequestStateMessages;
  onRetry?: () => void | Promise<void>;
}) {
  return (
    <div
      className="m-4 flex min-w-0 flex-col gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-200"
      role="alert"
    >
      <p className="font-semibold">{messages.requestError}</p>
      <p className="break-words text-sm">{error.message}</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
        {error.status > 0 && <span className="font-mono">HTTP {error.status}</span>}
        {error.correlationId && (
          <span className="min-w-0 break-all">
            {messages.correlationId}: <code>{error.correlationId}</code>
          </span>
        )}
        {error.retryAfterSeconds !== undefined && (
          <span>
            {messages.retryAfter}: {error.retryAfterSeconds}s
          </span>
        )}
      </div>
      {onRetry && (
        <Button size="sm" color="danger" variant="flat" className="self-start" onPress={onRetry}>
          {messages.retry}
        </Button>
      )}
    </div>
  );
}
