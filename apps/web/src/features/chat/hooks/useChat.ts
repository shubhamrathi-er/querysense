import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '../api/chat.api';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useChatStore } from '@/stores/chat.store';
import { useToast } from '@/components/ui/toast';
import type { ProgressStep, Message, Conversation } from '../types';
import { QUERY_STEPS } from '../types';

/** Inline-rename state machine for a single conversation row. */
export const useConversationRename = (conversation: Conversation) => {
  const update = useUpdateConversation();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState('');

  const start = () => {
    setValue(conversation.title ?? '');
    setRenaming(true);
  };
  const cancel = () => setRenaming(false);
  const submit = async () => {
    const next = value.trim();
    setRenaming(false);
    if (!next || next === (conversation.title ?? '')) return;
    try {
      await update.mutateAsync({ conversationId: conversation.id, title: next });
      toast.success('Chat renamed.');
    } catch {
      toast.error('Failed to rename chat.');
    }
  };

  return { renaming, value, setValue, start, cancel, submit };
};

export const useConversations = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useQuery({
    queryKey: ['conversations', workspaceId],
    queryFn: () => chatApi.getConversations(workspaceId),
    enabled: !!workspaceId,
  });
};

export const useConversation = (conversationId: string) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => chatApi.getConversation(workspaceId, conversationId),
    enabled: !!workspaceId && !!conversationId,
    staleTime: 0,
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (connectionId: string) =>
      chatApi.createConversation(workspaceId, connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
    },
  });
};

export const useUpdateConversation = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({
      conversationId,
      ...data
    }: {
      conversationId: string;
      title?: string;
      pinned?: boolean;
    }) => chatApi.updateConversation(workspaceId, conversationId, data),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
      void queryClient.invalidateQueries({
        queryKey: ['conversation', variables.conversationId],
      });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (conversationId: string) =>
      chatApi.deleteConversation(workspaceId, conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
    },
  });
};

// SSE-based SQL generation with step progress
export const useGenerateSQL = (conversationId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  const [isPending, setIsPending] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const generate = useCallback(async (
    content: string,
    connectionId: string,
  ): Promise<{ type: string; message: Message; sql?: string }> => {
    setIsPending(true);

    return new Promise((resolve, reject) => {
      const cleanup = chatApi.generateSQL(
        workspaceId,
        conversationId,
        content,
        connectionId,
        () => {}, // step callback — no longer needed for UI
        (result) => {
          setIsPending(false);
          void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
          void queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
          resolve(result);
        },
        (errorMsg) => {
          setIsPending(false);
          reject(new Error(errorMsg));
        },
      );
      cleanupRef.current = cleanup;
    });
  }, [workspaceId, conversationId, queryClient]);

  const cancel = useCallback(() => {
    cleanupRef.current?.();
    setIsPending(false);
  }, []);

  return { generate, isPending, cancel };
};

export const useRecordImport = (conversationId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({
      userContent,
      assistantContent,
    }: {
      userContent: string;
      assistantContent: string;
    }) =>
      chatApi.recordImport(
        workspaceId,
        conversationId,
        userContent,
        assistantContent,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
    },
  });
};

export const useChooseInterpretation = (conversationId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({ messageId, sql }: { messageId: string; sql: string }) =>
      chatApi.chooseInterpretation(workspaceId, conversationId, messageId, sql),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
    },
  });
};

export const useExecuteSQL = (conversationId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const { setMessageResult } = useChatStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({
      messageId,
      sql,
      connectionId,
      page,
      pageSize,
    }: {
      messageId: string;
      sql: string;
      connectionId: string;
      page?: number;
      pageSize?: number;
    }) =>
      chatApi.executeSQL(
        workspaceId,
        conversationId,
        messageId,
        sql,
        connectionId,
        page,
        pageSize,
      ),
    onSuccess: (result, variables) => {
      setMessageResult(variables.messageId, result);
      // If the AI auto-repaired the query, refetch so the SQL block shows the
      // corrected version that actually ran.
      if (result.repaired) {
        void queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId],
        });
      }
    },
  });
};