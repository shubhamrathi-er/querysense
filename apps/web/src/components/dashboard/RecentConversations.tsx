'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { MessageSquare, Plus } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { useConversationRename } from '@/features/chat/hooks/useChat';
import { ChatActionsMenu } from '@/features/chat/components/ChatActionsMenu';
import { RenameInput } from '@/features/chat/components/RenameInput';
import type { Conversation } from '@/features/chat/types';

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const rename = useConversationRename(conversation);
  const messages = conversation._count?.messages ?? 0;

  return (
    <div className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <MessageSquare className="h-4 w-4" />
      </div>

      {rename.renaming ? (
        <div className="min-w-0 flex-1">
          <RenameInput
            value={rename.value}
            onChange={rename.setValue}
            onCommit={rename.submit}
            onCancel={rename.cancel}
            className="w-full px-2 py-1 text-sm"
          />
        </div>
      ) : (
        <Link
          href={`/dashboard/chat/${conversation.id}`}
          className="min-w-0 flex-1"
        >
          <p className="truncate text-sm font-medium text-foreground">
            {conversation.title ?? 'New Conversation'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {messages} message{messages !== 1 ? 's' : ''} · {timeAgo(conversation.updatedAt)}
          </p>
        </Link>
      )}

      {!rename.renaming && (
        <ChatActionsMenu
          conversation={conversation}
          onRename={rename.start}
          align="end"
          side="left"
          triggerClassName="shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      )}
    </div>
  );
}

export function RecentConversations({
  conversations,
  isLoading,
}: {
  conversations: Conversation[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MessageSquare className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">No conversations yet</p>
        <p className="mt-1 max-w-[15rem] text-xs text-muted-foreground">
          Start a chat to query your database in natural language.
        </p>
        <Link
          href="/dashboard/chat/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> New Chat
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-0.5"
    >
      {conversations.map((c) => (
        <ConversationRow key={c.id} conversation={c} />
      ))}
    </motion.div>
  );
}
