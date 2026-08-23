'use client';

import { Alert } from '@heroui/react';

type HistoryMessages = {
  history: string;
  noticeTitle: string;
  unavailable: string;
};

export default function History({ messages }: { messages: HistoryMessages }) {
  return (
    <div className="h-full text-default-500">
      <div className="mb-4">
        <Alert color="secondary" title={messages.noticeTitle} description={messages.unavailable} />
      </div>
    </div>
  );
}
