export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionResult {
  content: string;
  tokensUsed: number;
  model: string;
  latencyMs: number;
}

export interface AIProvider {
  complete(messages: ChatMessage[]): Promise<AICompletionResult>;
  name: string;
}
