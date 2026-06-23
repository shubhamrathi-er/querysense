import { Module } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';
import { AiModule } from '../ai/ai.module';
import { EncryptionService } from '../common/encryption/encryption.service';

@Module({
  imports: [AiModule],
  providers: [DashboardsService, EncryptionService],
  controllers: [DashboardsController],
})
export class DashboardsModule {}
