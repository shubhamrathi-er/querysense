import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QueryHistoryService } from './query-history.service';
import { QueryHistoryQueryDto } from './dto/query-history-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';

@ApiTags('Query History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/query-history')
export class QueryHistoryController {
  constructor(private service: QueryHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'List executed queries (paginated, filterable)' })
  list(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryHistoryQueryDto,
  ) {
    return this.service.list(workspaceId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Query history summary stats' })
  stats(@Param('workspaceId') workspaceId: string) {
    return this.service.stats(workspaceId);
  }
}
