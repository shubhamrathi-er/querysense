import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type express from 'express';
import { DataMigrationService } from './data-migration.service';
import { MigrationValidationService } from './validation/migration-validation.service';
import {
  MigrationPlanDto,
  MigrationRunDto,
  ValidateMigrationDto,
  SuggestColumnsDto,
  PreviewTableDto,
  RerunDto,
  AssistDto,
} from './dto/migration.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';

@ApiTags('Migrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/migrations')
export class MigrationsController {
  constructor(
    private migrationService: DataMigrationService,
    private validationService: MigrationValidationService,
  ) {}

  @Post('validate')
  @ApiOperation({ summary: 'Run the migration validation engine (no writes)' })
  validate(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ValidateMigrationDto,
  ) {
    return this.validationService.validate(workspaceId, dto);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Post-migration verification (counts + checksums)' })
  verify(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ValidateMigrationDto,
  ) {
    return this.validationService.verify(workspaceId, {
      sourceConnectionId: dto.sourceConnectionId,
      targetConnectionId: dto.targetConnectionId,
      tables: dto.tables,
      tableMappings: dto.tableMappings,
    });
  }

  @Get('history')
  @ApiOperation({ summary: 'List past migration runs for the workspace' })
  history(
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ) {
    return this.migrationService.listRuns(workspaceId, limit ? Number(limit) : 50);
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Get a single migration run (full detail)' })
  historyDetail(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.migrationService.getRun(workspaceId, id);
  }

  @Get('history/:id/integrity')
  @ApiOperation({ summary: 'Post-migration integrity report for a run (counts + checksums)' })
  integrity(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.migrationService.integrityForRun(workspaceId, id);
  }

  @Post('history/:id/rollback')
  @ApiOperation({ summary: 'Roll back a run by dropping the tables it created' })
  rollback(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.migrationService.rollbackRun(workspaceId, id);
  }

  @Post('assistant')
  @ApiOperation({ summary: 'Ask the AI migration assistant' })
  assistant(
    @Param('workspaceId') _workspaceId: string,
    @Body() dto: AssistDto,
  ) {
    return this.migrationService.assist(dto.question, dto.context);
  }

  @Post('history/:id/rerun')
  @ApiOperation({ summary: 'Resume or retry a past migration run (SSE progress)' })
  async rerun(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: RerunDto,
    @Res() res: express.Response,
  ): Promise<void> {
    const prep = await this.migrationService.prepareRerun(workspaceId, id, dto.mode);
    if (!prep.ok) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      res.write(`event: error\ndata: ${JSON.stringify({ message: prep.message })}\n\n`);
      res.end();
      return;
    }
    await this.migrationService.run(workspaceId, prep.dto, res);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview sample rows from a source table (read-only)' })
  preview(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: PreviewTableDto,
  ) {
    return this.validationService.previewTable(
      workspaceId,
      dto.sourceConnectionId,
      dto.table,
      dto.limit ?? 50,
    );
  }

  @Post('suggest-columns')
  @ApiOperation({ summary: 'Suggest a source→target column mapping (AI + heuristic)' })
  suggestColumns(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: SuggestColumnsDto,
  ) {
    return this.migrationService.suggestColumnMapping(workspaceId, dto);
  }

  @Post('plan')
  @ApiOperation({ summary: 'Preview a migration (no writes)' })
  plan(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: MigrationPlanDto,
  ) {
    return this.migrationService.plan(
      workspaceId,
      dto.sourceConnectionId,
      dto.targetConnectionId,
    );
  }

  @Post('script')
  @ApiOperation({ summary: 'Generate a migration SQL script' })
  script(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: MigrationRunDto,
  ) {
    return this.migrationService.generateScript(workspaceId, {
      sourceConnectionId: dto.sourceConnectionId,
      targetConnectionId: dto.targetConnectionId,
      tables: dto.tables,
      createTables: dto.createTables ?? true,
      conflict: dto.conflict ?? 'skip',
      tableMappings: dto.tableMappings,
      columnMappings: dto.columnMappings,
      addColumns: dto.addColumns,
      createMissingColumns: dto.createMissingColumns ?? true,
      rowFilters: dto.rowFilters,
      incremental: dto.incremental,
      transforms: dto.transforms,
    });
  }

  @Post('run')
  @ApiOperation({ summary: 'Run the migration (SSE progress)' })
  async run(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: MigrationRunDto,
    @Res() res: express.Response,
  ): Promise<void> {
    await this.migrationService.run(
      workspaceId,
      {
        sourceConnectionId: dto.sourceConnectionId,
        targetConnectionId: dto.targetConnectionId,
        tables: dto.tables,
        createTables: dto.createTables ?? true,
        conflict: dto.conflict ?? 'skip',
        skipValidation: dto.skipValidation ?? false,
        tableMappings: dto.tableMappings,
        columnMappings: dto.columnMappings,
        addColumns: dto.addColumns,
        createMissingColumns: dto.createMissingColumns ?? true,
        rowFilters: dto.rowFilters,
        incremental: dto.incremental,
        transforms: dto.transforms,
      },
      res,
    );
  }
}
