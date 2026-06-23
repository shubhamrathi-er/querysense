import { Module } from '@nestjs/common';
import { QueryHistoryService } from './query-history.service';
import { QueryHistoryController } from './query-history.controller';

@Module({
  controllers: [QueryHistoryController],
  providers: [QueryHistoryService],
})
export class QueryHistoryModule {}
