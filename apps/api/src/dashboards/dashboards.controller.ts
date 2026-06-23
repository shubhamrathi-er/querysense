import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardsService } from './dashboards.service';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { CreateWidgetDto } from './dto/create-widget.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Dashboards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/dashboards')
export class DashboardsController {
  constructor(private dashboardsService: DashboardsService) {}

  @Get()
  @ApiOperation({ summary: 'List all dashboards' })
  findAll(@Param('workspaceId') workspaceId: string): Promise<unknown> {
    return this.dashboardsService.findAll(workspaceId);
  }

  @Get(':dashboardId')
  @ApiOperation({ summary: 'Get dashboard with widgets' })
  findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
  ): Promise<unknown> {
    return this.dashboardsService.findOne(dashboardId, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create dashboard' })
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDashboardDto,
  ): Promise<unknown> {
    return this.dashboardsService.create(workspaceId, user.id, dto);
  }

  @Patch(':dashboardId')
  @ApiOperation({ summary: 'Update dashboard' })
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: Partial<CreateDashboardDto>,
  ): Promise<unknown> {
    return this.dashboardsService.update(dashboardId, workspaceId, dto);
  }

  @Delete(':dashboardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete dashboard' })
  delete(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
  ): Promise<unknown> {
    return this.dashboardsService.delete(dashboardId, workspaceId);
  }

  // ─── Widgets ────────────────────────────────────────────

  @Post(':dashboardId/widgets')
  @ApiOperation({ summary: 'Add widget to dashboard' })
  createWidget(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateWidgetDto,
  ): Promise<unknown> {
    return this.dashboardsService.createWidget(dashboardId, workspaceId, dto);
  }

  @Patch(':dashboardId/widgets/:widgetId')
  @ApiOperation({ summary: 'Update widget' })
  updateWidget(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: Partial<CreateWidgetDto>,
  ): Promise<unknown> {
    return this.dashboardsService.updateWidget(
      widgetId,
      dashboardId,
      workspaceId,
      dto,
    );
  }

  @Delete(':dashboardId/widgets/:widgetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete widget' })
  deleteWidget(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ): Promise<unknown> {
    return this.dashboardsService.deleteWidget(
      widgetId,
      dashboardId,
      workspaceId,
    );
  }

  @Post(':dashboardId/widgets/:widgetId/refresh')
  @ApiOperation({ summary: 'Refresh widget data' })
  refreshWidget(
    @Param('workspaceId') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Query('connectionId') connectionId: string,
  ): Promise<unknown> {
    return this.dashboardsService.refreshWidget(
      widgetId,
      dashboardId,
      workspaceId,
      connectionId,
    );
  }
}
