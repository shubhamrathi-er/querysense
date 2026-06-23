'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useCreateConversation,
  useConversations,
} from '@/features/chat/hooks/useChat';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function NewChatPage() {
  const router = useRouter();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const { data: conversations, isLoading: conversationsLoading } =
    useConversations();
  const createConversation = useCreateConversation();
  const created = useRef(false);

  useEffect(() => {
    // Wait for connections + conversations to load first
    if (connectionsLoading || conversationsLoading) return;
    // Don't run twice
    if (created.current) return;

    const activeConnection = connections?.find((c) => c.status === 'ACTIVE');

    if (!activeConnection) return; // Show error state below

    created.current = true;

    // Reuse an existing empty conversation instead of creating another one,
    // so repeatedly clicking "New Chat" without asking anything keeps the same
    // chat open rather than piling up unused conversations.
    const emptyConversation = conversations?.find(
      (c) => (c._count?.messages ?? 0) === 0,
    );
    if (emptyConversation) {
      router.replace(`/dashboard/chat/${emptyConversation.id}`);
      return;
    }

    // Use mutateAsync + the resolved promise rather than the per-call
    // onSuccess callback: in TanStack Query v5 those callbacks are skipped if
    // the component unmounts before the mutation settles (which React
    // StrictMode simulates in dev), leaving the page stuck on the spinner even
    // though the conversation was created.
    void createConversation
      .mutateAsync(activeConnection.id)
      .then((conversation) => {
        router.replace(`/dashboard/chat/${conversation.id}`);
      })
      .catch(() => {
        created.current = false; // Allow retry
        router.replace('/dashboard/chat');
      });
  }, [
    connections,
    connectionsLoading,
    conversations,
    conversationsLoading,
    createConversation,
    router,
  ]);

  // No active connection
  const hasActiveConnection = connections?.some((c) => c.status === 'ACTIVE');
  if (!connectionsLoading && !hasActiveConnection) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h3 className="font-semibold">No active connection</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Sync a database connection before starting a chat.
          </p>
          <Link
            href="/dashboard/connections"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            Go to Connections
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Creating conversation...</span>
      </div>
    </div>
  );
}