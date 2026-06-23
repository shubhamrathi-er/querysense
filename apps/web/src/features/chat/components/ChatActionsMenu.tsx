'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useUpdateConversation, useDeleteConversation } from '../hooks/useChat';
import type { Conversation } from '../types';

interface Props {
  conversation: Conversation;
  /** Start inline rename in the parent row. */
  onRename: () => void;
  /** Extra classes for the trigger button (e.g. hover/positioning from parent). */
  triggerClassName?: string;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Called after the conversation is deleted (e.g. to navigate away). */
  onDeleted?: () => void;
}

export function ChatActionsMenu({
  conversation,
  onRename,
  triggerClassName,
  align = 'end',
  side = 'bottom',
  onDeleted,
}: Props) {
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();
  const confirm = useConfirm();
  const toast = useToast();

  const title = conversation.title ?? 'New Conversation';

  const togglePin = async () => {
    try {
      await updateConversation.mutateAsync({
        conversationId: conversation.id,
        pinned: !conversation.pinned,
      });
      toast.success(conversation.pinned ? 'Chat unpinned.' : 'Chat pinned.');
    } catch {
      toast.error('Failed to update pin.');
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete chat',
      description: `Delete "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteConversation.mutateAsync(conversation.id);
      toast.success('Chat deleted.');
      onDeleted?.();
    } catch {
      toast.error('Failed to delete chat.');
    }
  };

  // Keep the parent Link/card from reacting to clicks on the trigger.
  const stop = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const itemClass =
    'flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-md cursor-pointer outline-none ' +
    'text-foreground/85 data-[highlighted]:bg-accent data-[highlighted]:text-foreground';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Chat actions"
          onClick={stop}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors',
            'data-[state=open]:bg-accent data-[state=open]:text-foreground',
            triggerClassName,
          )}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onClick={stop}
          className={cn(
            'z-50 min-w-[10rem] p-1 rounded-xl border border-border bg-card shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <DropdownMenu.Item className={itemClass} onSelect={() => onRename()}>
            <Pencil className="w-3.5 h-3.5" /> Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={togglePin}>
            {conversation.pinned ? (
              <>
                <PinOff className="w-3.5 h-3.5" /> Unpin
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5" /> Pin
              </>
            )}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={cn(
              itemClass,
              'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
            )}
            onSelect={handleDelete}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
