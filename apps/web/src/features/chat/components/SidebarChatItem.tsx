'use client';

import Link from 'next/link';
import { MessageSquare, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversationRename } from '../hooks/useChat';
import { ChatActionsMenu } from './ChatActionsMenu';
import { RenameInput } from './RenameInput';
import type { Conversation } from '../types';

interface Props {
  conversation: Conversation;
  isActive: boolean;
  onDeleted?: () => void;
}

export function SidebarChatItem({ conversation, isActive, onDeleted }: Props) {
  const rename = useConversationRename(conversation);

  if (rename.renaming) {
    return (
      <div className="px-2 py-1">
        <RenameInput
          value={rename.value}
          onChange={rename.setValue}
          onCommit={rename.submit}
          onCancel={rename.cancel}
          className="w-full text-xs px-1.5 py-1"
        />
      </div>
    );
  }

  return (
    <div className="relative group">
      <Link
        href={`/dashboard/chat/${conversation.id}`}
        className={cn(
          'flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-lg text-xs transition-colors',
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <MessageSquare className="w-3 h-3 shrink-0" />
        <span className="truncate flex-1">
          {conversation.title ?? 'New Conversation'}
        </span>
        {conversation.pinned && (
          <Pin className="w-3 h-3 shrink-0 text-primary/70 fill-primary/70" />
        )}
      </Link>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <ChatActionsMenu
          conversation={conversation}
          onRename={rename.start}
          onDeleted={onDeleted}
          align="start"
          side="right"
          triggerClassName="p-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </div>
    </div>
  );
}
