import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import type {
  AIProvider,
  ChatMessage,
  AICompletionResult,
} from '../interfaces/ai-provider.interface';

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage: {
    total_tokens: number;
  };
  model: string;
}

@Injectable()
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterProvider.name);
  private readonly apiKey: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('OPENROUTER_API_KEY') ?? '';
  }

  async complete(messages: ChatMessage[]): Promise<AICompletionResult> {
    const start = Date.now();

    const response = await axios.post<OpenRouterResponse>(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages,
        max_tokens: 2048,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
        },
        timeout: 30000,
      },
    );

    return {
      content: response.data.choices[0]?.message.content ?? '',
      tokensUsed: response.data.usage?.total_tokens ?? 0,
      model: `openrouter/${response.data.model}`,
      latencyMs: Date.now() - start,
    };
  }
}
