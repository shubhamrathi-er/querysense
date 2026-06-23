'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { QueryProgress } from './QueryProgress';
import { MessageSquare } from 'lucide-react';
import type { Message } from '../types';

interface Props {
  messages: Message[];
  isLoading: boolean;
  conversationId: string;
  connectionId: string;
  /** Transient interactive content rendered after the messages (e.g. CSV importer). */
  extra?: ReactNode;
}

export function MessageList({
  messages,
  isLoading,
  conversationId,
  connectionId,
  extra,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, extra]);

  if (messages.length === 0 && !isLoading && !extra) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">
            Ask a question about your data to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      {messages.map((message) =>
        message.role === 'USER' ? (
          <UserMessage key={message.id} content={message.content} createdAt={message.createdAt} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            conversationId={conversationId}
            connectionId={connectionId}
          />
        ),
      )}

      {/* Static step progress — shown while loading */}
      {isLoading && <QueryProgress isLoading={isLoading} />}

      {/* Transient interactive panels (e.g. CSV importer) */}
      {extra}

      <div ref={bottomRef} />
    </div>
  );
}