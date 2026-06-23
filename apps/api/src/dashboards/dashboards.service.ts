import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SqlValidatorService } from '../ai/sql-validator.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { CreateWidgetDto } from './dto/create-widget.dto';
import * as mysql from 'mysql2/promise';

@Injectable()
export class DashboardsService {
  constructor(
    private prisma: PrismaService,
    private validator: SqlValidatorService,
    private encryption: EncryptionService,
  ) {}

  // ─── Dashboards ───────────────────────────────────────────

  async findAll(workspaceId: string) {
    return this.prisma.dashboard.findMany({
      where: { workspaceId },
      include: {
        _count: { select: { widgets: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(dashboardId: string, workspaceId: string) {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: dashboardId, workspaceId },
      include: {
        widgets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    return dashboard;
  }

  async create(workspaceId: string, userId: string, dto: CreateDashboardDto) {
    return this.prisma.dashboard.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description,
        isPublic: dto.isPublic ?? false,
      },
    });
  }

  async update(
    dashboardId: string,
    workspaceId: string,
    dto: Partial<CreateDashboardDto>,
  ) {
    await this.assertExists(dashboardId, workspaceId);
    return this.prisma.dashboard.update({
      where: { id: dashboardId },
      data: dto,
    });
  }

  async delete(dashboardId: string, workspaceId: string) {
    await this.assertExists(dashboardId, workspaceId);
    return this.prisma.dashboard.delete({ where: { id: dashboardId } });
  }

  // ─── Widgets ──────────────────────────────────────────────

  async createWidget(
    dashboardId: string,
    workspaceId: string,
    dto: CreateWidgetDto,
  ) {
    await this.assertExists(dashboardId, workspaceId);

    // Validate SQL before saving
    const validation = this.validator.validate(dto.sql);
    if (!validation.valid) {
      throw new ForbiddenException(`Invalid SQL: ${validation.error}`);
    }

    return this.prisma.dashboardWidget.create({
      data: {
        dashboardId,
        title: dto.title,
        widgetType: dto.widgetType,
        sql: dto.sql,
        chartConfig: (dto.chartConfig ?? null) as never,
        position: dto.position as never,
      },
    });
  }

  async updateWidget(
    widgetId: string,
    dashboardId: string,
    workspaceId: string,
    dto: Partial<CreateWidgetDto>,
  ) {
    await this.assertExists(dashboardId, workspaceId);

    if (dto.sql) {
      const validation = this.validator.validate(dto.sql);
      if (!validation.valid) {
        throw new ForbiddenException(`Invalid SQL: ${validation.error}`);
      }
    }

    return this.prisma.dashboardWidget.update({
      where: { id: widgetId },
      data: {
        title: dto.title,
        sql: dto.sql,
        chartConfig: (dto.chartConfig ?? undefined) as never,
        position: (dto.position ?? undefined) as never,
      },
    });
  }

  async deleteWidget(
    widgetId: string,
    dashboardId: string,
    workspaceId: string,
  ) {
    await this.assertExists(dashboardId, workspaceId);
    return this.prisma.dashboardWidget.delete({ where: { id: widgetId } });
  }

  async refreshWidget(
    widgetId: string,
    dashboardId: string,
    workspaceId: string,
    connectionId: string,
  ) {
    await this.assertExists(dashboardId, workspaceId);

    const widget = await this.prisma.dashboardWidget.findUnique({
      where: { id: widgetId },
    });
    if (!widget) throw new NotFoundException('Widget not found');

    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const password = this.encryption.decrypt(connection.encryptedPassword);

    const pool = mysql.createPool({
      host: connection.host,
      port: connection.port,
      database: connection.databaseName,
      user: connection.username,
      password,
      ssl: connection.sslEnabled ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 2,
    });

    try {
      const [rows, fields] = await pool.query<mysql.RowDataPacket[]>(
        widget.sql,
      );
      return {
        rows: (rows as Record<string, unknown>[]).slice(0, 500),
        fields: (fields ?? []).map((f) => ({
          name: f.name,
          type: f.type ?? 0,
        })),
        rowCount: rows.length,
      };
    } finally {
      await pool.end();
    }
  }

  private async assertExists(dashboardId: string, workspaceId: string) {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: dashboardId, workspaceId },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    return dashboard;
  }
}
