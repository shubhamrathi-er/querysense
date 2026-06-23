import { Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsController } from './connections.controller';
import { SchemaDiscoveryService } from './schema-discovery.service';
import { CsvImportService } from './csv-import.service';
import { SchemaAuditService } from './schema-audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [
    ConnectionsService,
    SchemaDiscoveryService,
    CsvImportService,
    SchemaAuditService,
    EncryptionService,
  ],
  controllers: [ConnectionsController],
  exports: [ConnectionsService, SchemaDiscoveryService, EncryptionService],
})
export class ConnectionsModule {}
