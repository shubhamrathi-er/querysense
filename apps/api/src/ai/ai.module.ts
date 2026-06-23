import { Module } from '@nestjs/common';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { SqlValidatorService } from './sql-validator.service';
import { SqlGuardService } from './sql-guard.service';
import { GroqProvider } from './providers/groq.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

@Module({
  providers: [
    AiOrchestratorService,
    SqlValidatorService,
    SqlGuardService,
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
  ],
  exports: [AiOrchestratorService, SqlValidatorService, SqlGuardService],
})
export class AiModule {}
