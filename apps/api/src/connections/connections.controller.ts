import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConnectionsService } from './connections.service';
import { CsvImportService } from './csv-import.service';
import { SchemaAuditService } from './schema-audit.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { CsvImportDto } from './dto/csv-import.dto';
import { UpdateDescriptionDto } from './dto/update-description.dto';
import {
  CreateModuleDto,
  UpdateModuleDto,
  AssignModuleDto,
} from './dto/module.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';

@ApiTags('Connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/connections')
export class ConnectionsController {
  constructor(
    private connectionsService: ConnectionsService,
    private csvImportService: CsvImportService,
    private schemaAuditService: SchemaAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all connections in workspace' })
  findAll(@Param('workspaceId') workspaceId: string) {
    return this.connectionsService.findAll(workspaceId);
  }

  @Get(':connectionId')
  @ApiOperation({ summary: 'Get connection with schema' })
  findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connectionsService.findOne(connectionId, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new connection' })
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    return this.connectionsService.create(workspaceId, dto);
  }

  @Patch(':connectionId')
  @ApiOperation({ summary: 'Update connection' })
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.connectionsService.update(connectionId, workspaceId, dto);
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete connection' })
  delete(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connectionsService.delete(connectionId, workspaceId);
  }

  // Test before saving (used in the Add Connection modal)
  @Post('test')
  @ApiOperation({ summary: 'Test connection credentials' })
  testNew(@Body() dto: TestConnectionDto) {
    return this.connectionsService.testConnection(dto);
  }

  // Test an existing saved connection
  @Post(':connectionId/test')
  @ApiOperation({ summary: 'Test existing connection' })
  testExisting(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connectionsService.testExistingConnection(
      connectionId,
      workspaceId,
    );
  }

  // Run a best-practices health audit against the live database
  @Post(':connectionId/audit')
  @ApiOperation({ summary: 'Audit the schema for best-practice issues' })
  audit(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.schemaAuditService.audit(connectionId, workspaceId);
  }

  // Sync schema from the connected database
  @Post(':connectionId/sync')
  @ApiOperation({ summary: 'Sync schema metadata' })
  sync(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connectionsService.syncSchema(connectionId, workspaceId);
  }

  // List base tables + columns for CSV import mapping (live introspection)
  @Get(':connectionId/import/targets')
  @ApiOperation({
    summary: 'List tables/columns available as CSV import targets',
  })
  importTargets(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.csvImportService.getImportTargets(connectionId, workspaceId);
  }

  // Import parsed CSV rows into a new or existing table
  @Post(':connectionId/import/csv')
  @ApiOperation({ summary: 'Import CSV data into a new or existing table' })
  importCsv(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: CsvImportDto,
  ) {
    return this.csvImportService.importCsv(connectionId, workspaceId, dto);
  }

  // ─── Schema descriptions ─────────────────────────────────

  @Post(':connectionId/tables/:tableName/describe')
  @ApiOperation({
    summary: 'AI-generate descriptions for a table + its columns',
  })
  describeTable(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('tableName') tableName: string,
  ) {
    return this.connectionsService.describeTable(
      connectionId,
      workspaceId,
      tableName,
    );
  }

  @Patch(':connectionId/tables/:tableName')
  @ApiOperation({ summary: 'Update a table description' })
  updateTableDescription(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('tableName') tableName: string,
    @Body() dto: UpdateDescriptionDto,
  ) {
    return this.connectionsService.updateTableDescription(
      connectionId,
      workspaceId,
      tableName,
      dto.description,
    );
  }

  @Patch(':connectionId/tables/:tableName/columns/:columnName')
  @ApiOperation({ summary: 'Update a column description' })
  updateColumnDescription(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('tableName') tableName: string,
    @Param('columnName') columnName: string,
    @Body() dto: UpdateDescriptionDto,
  ) {
    return this.connectionsService.updateColumnDescription(
      connectionId,
      workspaceId,
      tableName,
      columnName,
      dto.description,
    );
  }

  // ─── Modules ─────────────────────────────────────────────

  @Post(':connectionId/modules/suggest')
  @ApiOperation({ summary: 'AI-suggest table groupings into modules' })
  suggestModules(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connectionsService.suggestModules(connectionId, workspaceId);
  }

  @Post(':connectionId/modules')
  @ApiOperation({ summary: 'Create a module' })
  createModule(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: CreateModuleDto,
  ) {
    return this.connectionsService.createModule(
      connectionId,
      workspaceId,
      dto.name,
    );
  }

  @Patch(':connectionId/modules/:moduleId')
  @ApiOperation({ summary: 'Update a module' })
  updateModule(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.connectionsService.updateModule(
      connectionId,
      workspaceId,
      moduleId,
      dto,
    );
  }

  @Delete(':connectionId/modules/:moduleId')
  @ApiOperation({ summary: 'Delete a module' })
  deleteModule(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('moduleId') moduleId: string,
  ) {
    return this.connectionsService.deleteModule(
      connectionId,
      workspaceId,
      moduleId,
    );
  }

  @Patch(':connectionId/tables/:tableName/module')
  @ApiOperation({ summary: 'Assign a table to a module (or ungroup)' })
  assignTableModule(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Param('tableName') tableName: string,
    @Body() dto: AssignModuleDto,
  ) {
    return this.connectionsService.assignTableModule(
      connectionId,
      workspaceId,
      tableName,
      dto.moduleId,
    );
  }
}
