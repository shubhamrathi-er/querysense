'use client';

import { useState, useMemo } from 'react';
import { useConversations, useConversationRename } from '@/features/chat/hooks/useChat';
import { MessageSquare, Plus, Search, X, Pin } from 'lucide-react';
import Link from 'next/link';
import { timeAgo } from '@/lib/utils';
import { ChatActionsMenu } from '@/features/chat/components/ChatActionsMenu';
import { RenameInput } from '@/features/chat/components/RenameInput';
import type { Conversation } from '@/features/chat/types';

export default function ChatListPage() {
  const { data: conversations, isLoading } = useConversations();
  const [search, setSearch] = useState('');

  // Hide empty/unused conversations (no messages yet) from the list.
  const visible = useMemo(
    () => (conversations ?? []).filter((c) => (c._count?.messages ?? 0) > 0),
    [conversations],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return visible;
    const q = search.toLowerCase();
    return visible.filter((c) => (c.title ?? '').toLowerCase().includes(q));
  }, [visible, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {visible.length} total conversation{visible.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
              {/* Search bar */}
      {visible.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-10 pr-10 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary placeholder:text-muted-foreground transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
        <Link
          href="/dashboard/chat/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Link>
        </div>
      
      </div>

      

      {/* Empty state — no conversations with messages yet */}
      {visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <MessageSquare className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-2">No conversations yet</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-xs">
            Start a new chat to query your database using natural language.
          </p>
          <Link
            href="/dashboard/chat/new"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Start your first chat
          </Link>
        </div>
      )}

      {/* No search results */}
      {visible.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">
            No conversations match <strong className="text-foreground">{search}</strong>
          </p>
          <button
            onClick={() => setSearch('')}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Conversation list */}
      {filtered.length > 0 && (
        <div className="max-h-[80vh] space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {filtered.map((conv) => (
            <ConversationRow key={conv.id} conversation={conv} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  search,
}: {
  conversation: Conversation;
  search: string;
}) {
  const rename = useConversationRename(conversation);
  const messageCount = conversation._count?.messages ?? 0;

  return (
    <div className="group flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3.5 hover:border-primary/30 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MessageSquare className="w-4 h-4 text-primary" />
      </div>

      {rename.renaming ? (
        <div className="flex-1 min-w-0">
          <RenameInput
            value={rename.value}
            onChange={rename.setValue}
            onCommit={rename.submit}
            onCancel={rename.cancel}
            className="w-full text-sm px-2 py-1"
          />
        </div>
      ) : (
        <Link
          href={`/dashboard/chat/${conversation.id}`}
          className="flex-1 flex items-center min-w-0"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate flex items-center gap-1.5">
              {conversation.pinned && (
                <Pin className="w-3 h-3 shrink-0 text-primary/70 fill-primary/70" />
              )}
              <span className="truncate">
                {highlightMatch(conversation.title ?? 'New Conversation', search)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {messageCount} message{messageCount !== 1 ? 's' : ''}
              {' · '}
              {timeAgo(conversation.updatedAt)}
            </p>
          </div>
        </Link>
      )}

      {!rename.renaming && (
        <ChatActionsMenu
          conversation={conversation}
          onRename={rename.start}
          align="start"
          side="right"
          triggerClassName="shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      )}
    </div>
  );
}

// Highlights the matched part of text
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/20 text-primary rounded-sm px-0.5">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}