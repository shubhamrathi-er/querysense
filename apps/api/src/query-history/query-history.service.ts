import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface QueryHistoryQuery {
  page?: number;
  pageSize?: number;
  connectionId?: string;
  status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
  search?: string;
}

@Injectable()
export class QueryHistoryService {
  constructor(private prisma: PrismaService) {}

  async list(workspaceId: string, q: QueryHistoryQuery) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const pageSize = q.pageSize && q.pageSize > 0 ? Math.min(q.pageSize, 100) : 25;

    const where: Prisma.QueryHistoryWhereInput = {
      connection: { workspaceId },
      ...(q.connectionId ? { connectionId: q.connectionId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { sql: { contains: q.search } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.queryHistory.count({ where }),
      this.prisma.queryHistory.findMany({
        where,
        orderBy: { executedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          connection: { select: { id: true, name: true } },
          message: { select: { conversationId: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        sql: r.sql,
        executedAt: r.executedAt,
        executionTimeMs: r.executionTimeMs,
        rowCount: r.rowCount,
        status: r.status,
        errorMessage: r.errorMessage,
        connectionId: r.connectionId,
        connectionName: r.connection.name,
        conversationId: r.message?.conversationId ?? null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async stats(workspaceId: string) {
    const where: Prisma.QueryHistoryWhereInput = {
      connection: { workspaceId },
    };
    const [total, success, error, timeout, agg] = await this.prisma.$transaction(
      [
        this.prisma.queryHistory.count({ where }),
        this.prisma.queryHistory.count({ where: { ...where, status: 'SUCCESS' } }),
        this.prisma.queryHistory.count({ where: { ...where, status: 'ERROR' } }),
        this.prisma.queryHistory.count({ where: { ...where, status: 'TIMEOUT' } }),
        this.prisma.queryHistory.aggregate({
          where: { ...where, status: 'SUCCESS' },
          _avg: { executionTimeMs: true },
        }),
      ],
    );

    return {
      total,
      success,
      error,
      timeout,
      avgMs: Math.round(agg._avg.executionTimeMs ?? 0),
    };
  }
}
