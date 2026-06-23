import { create } from 'zustand';
import type { Message, QueryResult } from '@/features/chat/types';

interface ChatState {
  // Active conversation ID persisted across navigation
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;

  // Selected connection per conversation
  connectionPerConversation: Record<string, string>;
  setConnectionForConversation: (convId: string, connId: string) => void;
  getConnectionForConversation: (convId: string) => string | undefined;

  // Client-side message state (query results, status)
  messageResults: Record<string, QueryResult>;
  setMessageResult: (messageId: string, result: QueryResult) => void;

  // Edited SQL per message (before execution)
  editedSQL: Record<string, string>;
  setEditedSQL: (messageId: string, sql: string) => void;
  getEditedSQL: (messageId: string, originalSql: string) => string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  connectionPerConversation: {},
  setConnectionForConversation: (convId, connId) =>
    set((s) => ({
      connectionPerConversation: {
        ...s.connectionPerConversation,
        [convId]: connId,
      },
    })),
  getConnectionForConversation: (convId) =>
    get().connectionPerConversation[convId],

  messageResults: {},
  setMessageResult: (messageId, result) =>
    set((s) => ({
      messageResults: { ...s.messageResults, [messageId]: result },
    })),

  editedSQL: {},
  setEditedSQL: (messageId, sql) =>
    set((s) => ({
      editedSQL: { ...s.editedSQL, [messageId]: sql },
    })),
  getEditedSQL: (messageId, originalSql) =>
    get().editedSQL[messageId] ?? originalSql,
}));