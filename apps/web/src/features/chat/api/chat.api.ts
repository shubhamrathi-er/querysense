import { apiClient } from '@/lib/api-client';
import type { Conversation, Message, QueryResult } from '../types';

interface ApiResponse<T> { data: T }

export const chatApi = {
  getConversations: async (workspaceId: string): Promise<Conversation[]> => {
    const res = await apiClient.get(
      `/workspaces/${workspaceId}/conversations`,
    ) as ApiResponse<Conversation[]>;
    return res.data;
  },

  getConversation: async (
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> => {
    const res = await apiClient.get(
      `/workspaces/${workspaceId}/conversations/${conversationId}`,
    ) as ApiResponse<Conversation>;
    return res.data;
  },

  createConversation: async (
    workspaceId: string,
    connectionId: string,
  ): Promise<Conversation> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/conversations`,
      { connectionId, title: 'New Conversation' },
    ) as ApiResponse<Conversation>;
    return res.data;
  },

  deleteConversation: async (
    workspaceId: string,
    conversationId: string,
  ): Promise<void> => {
    await apiClient.delete(
      `/workspaces/${workspaceId}/conversations/${conversationId}`,
    );
  },

  updateConversation: async (
    workspaceId: string,
    conversationId: string,
    data: { title?: string; pinned?: boolean },
  ): Promise<Conversation> => {
    const res = await apiClient.patch(
      `/workspaces/${workspaceId}/conversations/${conversationId}`,
      data,
    ) as ApiResponse<Conversation>;
    return res.data;
  },

  // Step 1: Generate SQL only
 // Step 1: Generate SQL with SSE progress streaming
generateSQL: (
  workspaceId: string,
  conversationId: string,
  content: string,
  connectionId: string,
  onStep: (step: string, label: string, status: string) => void,
  onDone: (result: { type: string; message: Message; sql?: string }) => void,
  onError: (message: string) => void,
): (() => void) => {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('accessToken')
    : null;

  // SSE doesn't support POST natively, use fetch with ReadableStream
  const controller = new AbortController();

  fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify({ content, connectionId }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onError(`Request failed: ${res.statusText}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError('No response stream'); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (currentEvent === 'step') {
              onStep(
                data['step'] as string,
                data['label'] as string,
                data['status'] as string,
              );
            } else if (currentEvent === 'done') {
              onDone(data as { type: string; message: Message; sql?: string });
            } else if (currentEvent === 'error') {
              onError(data['message'] as string);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err.message);
    }
  });

  // Return cleanup function
  return () => controller.abort();
},

  // Step 2: Execute SQL with pagination
  executeSQL: async (
    workspaceId: string,
    conversationId: string,
    messageId: string,
    sql: string,
    connectionId: string,
    page = 1,
    pageSize = 50,
  ): Promise<QueryResult> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/execute`,
      { sql, connectionId, page, pageSize },
    ) as ApiResponse<QueryResult>;
    return res.data;
  },

  // Choose one interpretation of an ambiguous question → returns updated message
  chooseInterpretation: async (
    workspaceId: string,
    conversationId: string,
    messageId: string,
    sql: string,
  ): Promise<Message> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/choose-interpretation`,
      { sql },
    ) as ApiResponse<Message>;
    return res.data;
  },

  // Record a data import (file/paste/Sheets) in the conversation history
  recordImport: async (
    workspaceId: string,
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> => {
    await apiClient.post(
      `/workspaces/${workspaceId}/conversations/${conversationId}/import-record`,
      { userContent, assistantContent },
    );
  },
};