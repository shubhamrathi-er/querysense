'use client';

import { use, useEffect } from 'react';
import { ChatInterface } from '@/features/chat/components/ChatInterface';
import { useChatStore } from '@/stores/chat.store';

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default function ChatPage({ params }: Props) {
  const { conversationId } = use(params);
  const { setActiveConversationId } = useChatStore();

  // Persist which conversation is active
  useEffect(() => {
    setActiveConversationId(conversationId);
    return () => setActiveConversationId(null);
  }, [conversationId, setActiveConversationId]);

  return (
    <div className="flex flex-col h-full">
      <ChatInterface conversationId={conversationId} />
    </div>
  );
}