import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import type {
  AIProvider,
  ChatMessage,
  AICompletionResult,
} from '../interfaces/ai-provider.interface';

interface GroqResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage: {
    total_tokens: number;
  };
  model: string;
}

@Injectable()
export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqProvider.name);
  private readonly apiKey: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('GROQ_API_KEY') ?? '';
  }

  async complete(messages: ChatMessage[]): Promise<AICompletionResult> {
    const start = Date.now();

    const response = await axios.post<GroqResponse>(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 2048,
        temperature: 0.1, // Low temperature = more deterministic SQL
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    return {
      content: response.data.choices[0]?.message.content ?? '',
      tokensUsed: response.data.usage?.total_tokens ?? 0,
      model: `groq/${response.data.model}`,
      latencyMs: Date.now() - start,
    };
  }
}
