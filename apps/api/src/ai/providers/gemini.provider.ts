import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import type {
  AIProvider,
  ChatMessage,
  AICompletionResult,
} from '../interfaces/ai-provider.interface';

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  usageMetadata?: {
    totalTokenCount: number;
  };
}

@Injectable()
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY') ?? '';
  }

  async complete(messages: ChatMessage[]): Promise<AICompletionResult> {
    const start = Date.now();

    // Gemini uses a different message format — convert from OpenAI style
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const contents = userMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await axios.post<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        system_instruction: systemMsg
          ? { parts: [{ text: systemMsg.content }] }
          : undefined,
        contents,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      },
      { timeout: 30000 },
    );

    const text = response.data.candidates[0]?.content.parts[0]?.text ?? '';

    return {
      content: text,
      tokensUsed: response.data.usageMetadata?.totalTokenCount ?? 0,
      model: 'gemini/gemini-2.0-flash',
      latencyMs: Date.now() - start,
    };
  }
}
