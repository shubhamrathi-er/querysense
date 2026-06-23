import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ConnectionsModule } from './connections/connections.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AiModule } from './ai/ai.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { AuditModule } from './audit/audit.module';
import { ImportModule } from './import/import.module';
import { MigrationsModule } from './migrations/migrations.module';
import { QueryHistoryModule } from './query-history/query-history.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    ConnectionsModule,
    ConversationsModule,
    AiModule,
    DashboardsModule,
    AuditModule,
    ImportModule,
    MigrationsModule,
    QueryHistoryModule,
  ],
})
export class AppModule {}
