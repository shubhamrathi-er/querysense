import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { AiModule } from '../ai/ai.module';
import { EncryptionService } from '../common/encryption/encryption.service';

@Module({
  imports: [AiModule],
  providers: [ConversationsService, EncryptionService],
  controllers: [ConversationsController],
  exports: [ConversationsService],
})
export class ConversationsModule {}
