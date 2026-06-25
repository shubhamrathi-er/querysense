import { Module } from '@nestjs/common';
import { DataMigrationService } from './data-migration.service';
import { MigrationsController } from './migrations.controller';
import { MigrationValidationService } from './validation/migration-validation.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [MigrationsController],
  providers: [DataMigrationService, MigrationValidationService, EncryptionService],
})
export class MigrationsModule {}
