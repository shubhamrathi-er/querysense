import {
  Controller,
  Post,
  Body,
  Param,
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
