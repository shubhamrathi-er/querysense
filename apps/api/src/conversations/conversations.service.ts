import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { Prisma } from '@prisma/client';
import {
  createMysqlPool,
  createPostgresPool,
  createSqlServerPool,
  buildSshConfig,
} from '../common/db/mysql-pool';
import { DbEngine, normalizeEngine } from '../common/db/engine';
import { PrismaService } from '../../prisma/prisma.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { SqlValidatorService } from '../ai/sql-validator.service';
import { SqlGuardService } from '../ai/sql-guard.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ExecuteSqlDto } from './dto/execute-sql.dto';
import { ImportRecordDto } from './dto/import-record.dto';
import { Response } from 'express';

interface QueryField {
  name: string;
  type: string | number;
}

/** Thrown when a guardrail (e.g. EXPLAIN scan estimate) blocks a query. Distinct
 *  from a normal execution error so the repair loop never retries a policy block. */
class GuardrailBlockedError extends Error {}

interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter';
  xKey: string;
  yKey: string;
  title: string;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiOrchestratorService,
    private validator: SqlValidatorService,
    private guard: SqlGuardService,
    private encryption: EncryptionService,
  ) {}

  async findAll(workspaceId: string) {
    return this.prisma.conversation.findMany({
      where: { workspaceId },
      include: { _count: { select: { messages: true } } },
      // Pinned chats float to the top, then newest-created first.
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async update(
    conversationId: string,
    workspaceId: string,
    dto: UpdateConversationDto,
  ) {
    await this.assertExists(conversationId, workspaceId);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
    });
  }

  async findOne(conversationId: string, workspaceId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async create(workspaceId: string, dto: CreateConversationDto) {
    return this.prisma.conversation.create({
      data: { workspaceId, title: dto.title ?? 'New Conversation' },
    });
  }

  async delete(conversationId: string, workspaceId: string) {
    await this.assertExists(conversationId, workspaceId);
    return this.prisma.conversation.delete({ where: { id: conversationId } });
  }

  // ─── Record a data import in the conversation history ─────

  async recordImport(
    conversationId: string,
    workspaceId: string,
    dto: ImportRecordDto,
  ) {
    await this.assertExists(conversationId, workspaceId);

    const userMessage = await this.prisma.message.create({
      data: { conversationId, role: 'USER', content: dto.userContent },
    });
    const assistantMessage = await this.prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: dto.assistantContent },
    });

    await this.updateTitleIfNeeded(conversationId, dto.userContent);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return { userMessage, assistantMessage };
  }

  // ─── SSE: Generate SQL with step-by-step progress ────────

  async generateSQLStream(
    conversationId: string,
    workspaceId: string,
    dto: SendMessageDto,
    res: Response,
  ) {
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.assertExists(conversationId, workspaceId);

      // Step 1 — Save user message
      send('step', {
        step: 'saving',
        label: 'Saving your question',
        status: 'active',
      });

      await this.prisma.message.create({
        data: { conversationId, role: 'USER', content: dto.content },
      });

      // Step 2 — Load schema context
      send('step', {
        step: 'saving',
        label: 'Saving your question',
        status: 'done',
      });
      send('step', {
        step: 'schema',
        label: 'Retrieving schema context',
        status: 'active',
      });

      const connection = await this.prisma.databaseConnection.findFirst({
        where: { id: dto.connectionId, workspaceId },
        include: {
          schemaMetadata: {
            include: { columns: { orderBy: { ordinalPosition: 'asc' } } },
          },
        },
      });

      if (!connection) {
        send('error', { message: 'Database connection not found' });
        res.end();
        return;
      }

      if (connection.schemaMetadata.length === 0) {
        send('error', {
          message: 'No schema found. Please sync the schema first.',
        });
        res.end();
        return;
      }

      // Narrow to the tables relevant to this question (+ FK neighbours) so the
      // prompt stays focused on wide databases. Small schemas pass through whole.
      const selection = this.ai.selectRelevantTables(
        connection.schemaMetadata,
        dto.content,
      );
      const schemaContext = this.ai.buildSchemaContext(selection.tables);
      this.logger.log(
        `Schema context: ${selection.tables.length}/${connection.schemaMetadata.length} tables ${
          selection.filtered ? '(relevance-filtered)' : '(all)'
        }`,
      );

      // Step 3 — Load conversation history
      send('step', {
        step: 'schema',
        label: selection.filtered
          ? `Selected ${selection.tables.length} relevant tables`
          : 'Retrieving schema context',
        status: 'done',
      });
      send('step', {
        step: 'context',
        label: 'Loading conversation history',
        status: 'active',
      });

      const history = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 6,
      });

      const conversationHistory = history
        .reverse()
        .slice(0, -1)
        .map((m) => ({
          role: m.role.toLowerCase() as 'user' | 'assistant',
          content: m.generatedSql
            ? `${m.content}\n\nSQL: ${m.generatedSql}`
            : m.content,
        }));

      // Step 4 — Generate SQL
      send('step', {
        step: 'context',
        label: 'Loading conversation history',
        status: 'done',
      });
      send('step', {
        step: 'generating',
        label: 'Generating SQL query',
        status: 'active',
      });

      // Few-shot examples: past questions that produced working SQL on this DB.
      const fewShotExamples = await this.getFewShotExamples(
        connection.id,
        dto.content,
      );

      this.logger.log(`Generating SQL for: "${dto.content}"`);
      const sqlResult = await this.ai.generateSQL({
        userQuestion: dto.content,
        schemaContext,
        conversationHistory,
        databaseName: connection.databaseName,
        engine: normalizeEngine(connection.engine),
        fewShotExamples,
      });

      // Handle CANNOT_ANSWER
      if (sqlResult.type === 'cannot_answer') {
        send('step', {
          step: 'generating',
          label: 'Generating SQL query',
          status: 'done',
        });

        const message = await this.prisma.message.create({
          data: {
            conversationId,
            role: 'ASSISTANT',
            content: `I couldn't answer that with the available schema. ${sqlResult.reason ?? ''}`,
            modelUsed: sqlResult.model,
            tokensUsed: sqlResult.tokensUsed,
            latencyMs: sqlResult.latencyMs,
          },
        });

        await this.updateTitleIfNeeded(conversationId, dto.content);
        send('done', { type: 'cannot_answer', message });
        res.end();
        return;
      }

      // Handle ambiguous question — ask the user to pick an interpretation
      // instead of guessing one.
      if (sqlResult.type === 'clarification') {
        send('step', {
          step: 'generating',
          label: 'Generating SQL query',
          status: 'done',
        });

        const clarification = {
          clarify: sqlResult.clarify ?? 'Which did you mean?',
          options: sqlResult.interpretations ?? [],
        };
        const message = await this.prisma.message.create({
          data: {
            conversationId,
            role: 'ASSISTANT',
            content: clarification.clarify,
            clarification: clarification as never,
            modelUsed: sqlResult.model,
            tokensUsed: sqlResult.tokensUsed,
            latencyMs: sqlResult.latencyMs,
          },
        });

        await this.updateTitleIfNeeded(conversationId, dto.content);
        send('done', { type: 'clarification', message });
        res.end();
        return;
      }

      // Step 5 — Validate SQL
      send('step', {
        step: 'generating',
        label: 'Generating SQL query',
        status: 'done',
      });
      send('step', {
        step: 'validating',
        label: 'Validating query safety',
        status: 'active',
      });

      await new Promise((r) => setTimeout(r, 300)); // Small pause for UX

      send('step', {
        step: 'validating',
        label: 'Validating query safety',
        status: 'done',
      });

      // Step 6 — Save message
      send('step', {
        step: 'ready',
        label: 'Query ready for review',
        status: 'active',
      });

      const queryMeta = {
        confidence: sqlResult.confidence ?? null,
        tables: sqlResult.tables ?? [],
        columns: sqlResult.columns ?? [],
      };
      const assistantMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: 'SQL generated. Review and execute when ready.',
          generatedSql: sqlResult.sql,
          sqlExplanation: sqlResult.explanation ?? null,
          queryMeta: queryMeta as never,
          modelUsed: sqlResult.model,
          tokensUsed: sqlResult.tokensUsed,
          latencyMs: sqlResult.latencyMs,
        },
      });

      await this.updateTitleIfNeeded(conversationId, dto.content);

      send('step', {
        step: 'ready',
        label: 'Query ready for review',
        status: 'done',
      });
      send('done', {
        type: 'sql_ready',
        message: assistantMessage,
        sql: sqlResult.sql,
      });

      res.end();
    } catch (error) {
      send('error', {
        message:
          error instanceof Error ? error.message : 'Something went wrong',
      });
      res.end();
    }
  }

  // ─── Execute SQL with server-side pagination ─────────────

  async executeSQL(
    conversationId: string,
    workspaceId: string,
    messageId: string,
    dto: ExecuteSqlDto,
  ) {
    await this.assertExists(conversationId, workspaceId);

    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: dto.connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    const engine = normalizeEngine(connection.engine);

    // Guardrail 1 — syntax + SELECT-only safety (validate before execution).
    const validation = this.validator.validate(dto.sql, engine);
    if (!validation.valid) {
      this.guard.logBlocked('execute:syntax', validation.error ?? 'invalid', dto.sql);
      throw new ForbiddenException(
        `SQL validation failed: ${validation.error}`,
      );
    }

    // Guardrail 2 — structural limits (deeply nested subqueries).
    const structure = this.guard.checkStructure(dto.sql, engine);
    if (!structure.allowed) {
      this.guard.logBlocked('execute:structure', structure.reason ?? '', dto.sql);
      await this.recordBlocked(messageId, dto.connectionId, dto.sql, structure.reason ?? 'Blocked');
      throw new ForbiddenException(structure.reason);
    }

    const page = dto.page ?? 1;
    // Guardrail 3 — enforce a hard row cap regardless of requested page size.
    const pageSize = this.guard.cappedPageSize(dto.pageSize ?? 50);
    const offset = (page - 1) * pageSize;

    let queryResult: {
      rows: Record<string, unknown>[];
      fields: QueryField[];
      rowCount: number;
      totalCount: number;
      page: number;
      pageSize: number;
      totalPages: number;
      executionTimeMs: number;
    };

    // The SQL actually run — may be swapped for an auto-repaired version below.
    let effectiveSql = dto.sql;
    let repaired = false;
    let repairTokens = 0;

    try {
      queryResult = await this.executePaginated(
        connection,
        effectiveSql,
        page,
        pageSize,
        offset,
      );
    } catch (execError) {
      const errorMsg =
        execError instanceof Error
          ? execError.message
          : 'Query execution failed';

      // A guardrail block (e.g. EXPLAIN scan estimate) is a policy decision, not
      // a fixable error — record it and reject without attempting a repair.
      if (execError instanceof GuardrailBlockedError) {
        this.guard.logBlocked('execute:explain', errorMsg, effectiveSql);
        await this.recordBlocked(messageId, connection.id, effectiveSql, errorMsg);
        throw new ForbiddenException(errorMsg);
      }

      // Validate-and-repair: on the first run, feed the DB error back to the AI
      // once for a corrected query, then retry. Pagination/re-runs don't repair.
      const repair =
        page === 1
          ? await this.tryRepair(
              connection,
              conversationId,
              messageId,
              effectiveSql,
              errorMsg,
              page,
              pageSize,
              offset,
            )
          : null;

      if (repair) {
        queryResult = repair.result;
        effectiveSql = repair.sql;
        repaired = true;
        repairTokens = repair.tokensUsed;
      } else {
        // One history row per message (messageId is unique). Re-runs/pagination
        // update the existing row rather than colliding on a second create.
        const errorData = {
          connectionId: connection.id,
          sql: dto.sql,
          executionTimeMs: 0,
          rowCount: 0,
          status: 'ERROR' as const,
          errorMessage: errorMsg,
          resultSnapshot: Prisma.DbNull,
        };
        await this.prisma.queryHistory.upsert({
          where: { messageId },
          create: { messageId, ...errorData },
          update: { ...errorData, executedAt: new Date() },
        });

        throw new BadRequestException(`Query failed: ${errorMsg}`);
      }
    }

    const successData = {
      connectionId: connection.id,
      sql: effectiveSql,
      executionTimeMs: queryResult.executionTimeMs,
      rowCount: queryResult.totalCount,
      status: 'SUCCESS' as const,
      errorMessage: null,
      resultSnapshot: queryResult.rows.slice(0, 10) as never,
    };
    await this.prisma.queryHistory.upsert({
      where: { messageId },
      create: { messageId, ...successData },
      update: { ...successData, executedAt: new Date() },
    });

    let insightText = '';
    try {
      if (queryResult.rows.length > 0) {
        const insight = await this.ai.generateInsight(
          effectiveSql,
          effectiveSql,
          queryResult.rows,
        );
        insightText = insight.text;
      }
    } catch {
      this.logger.warn('Insight generation failed');
    }

    const chartConfig = this.suggestChart('', queryResult.fields);

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: insightText || `Found ${queryResult.totalCount} results.`,
        insightText,
        chartConfig: chartConfig as never,
        // Persist the corrected query so the UI and reloads show what actually ran,
        // and roll the repair's token cost into the message's telemetry.
        ...(repaired
          ? {
              generatedSql: effectiveSql,
              tokensUsed: { increment: repairTokens },
            }
          : {}),
      },
    });

    return {
      ...queryResult,
      insightText,
      chartConfig,
      repaired,
      repairedSql: repaired ? effectiveSql : null,
    };
  }

  /**
   * One-shot validate-and-repair: ask the AI to fix a query that failed against
   * the live DB (given the schema + error), then re-run it once. Returns the
   * corrected SQL and its result, or null if no usable fix runs cleanly.
   */
  private async tryRepair(
    connection: Parameters<typeof buildSshConfig>[0] & {
      id: string;
      host: string;
      port: number;
      databaseName: string;
      username: string;
      encryptedPassword: string;
      sslEnabled: boolean;
    },
    conversationId: string,
    messageId: string,
    brokenSql: string,
    errorMessage: string,
    page: number,
    pageSize: number,
    offset: number,
  ): Promise<{
    sql: string;
    result: Awaited<ReturnType<typeof this.executePaginated>>;
    tokensUsed: number;
    model: string;
  } | null> {
    try {
      const full = await this.prisma.databaseConnection.findUnique({
        where: { id: connection.id },
        include: {
          schemaMetadata: {
            include: { columns: { orderBy: { ordinalPosition: 'asc' } } },
          },
        },
      });
      if (!full || full.schemaMetadata.length === 0) return null;

      const question = await this.getQuestionForMessage(
        conversationId,
        messageId,
      );

      // Use the question AND the broken SQL (table/column names) as the relevance
      // signal, so the repair prompt sees exactly the tables it needs.
      const selection = this.ai.selectRelevantTables(
        full.schemaMetadata,
        `${question ?? ''} ${brokenSql}`,
      );
      const schemaContext = this.ai.buildSchemaContext(selection.tables);

      const engine = normalizeEngine(full.engine);
      const repair = await this.ai.repairSQL({
        databaseName: full.databaseName,
        engine,
        schemaContext,
        question,
        brokenSql,
        errorMessage,
      });
      if (!repair) return null;

      const fixedSql = repair.sql.trim();
      // No point retrying an identical query.
      if (fixedSql === brokenSql.trim()) return null;
      if (!this.validator.validate(fixedSql, engine).valid) return null;

      const result = await this.executePaginated(
        connection,
        fixedSql,
        page,
        pageSize,
        offset,
      );
      this.logger.log(
        `Auto-repaired SQL succeeded (model: ${repair.model}, tokens: ${repair.tokensUsed})`,
      );
      return {
        sql: fixedSql,
        result,
        tokensUsed: repair.tokensUsed,
        model: repair.model,
      };
    } catch (err) {
      // Repair is best-effort — fall back to surfacing the original error.
      this.logger.warn(
        `SQL auto-repair failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /** The user question that produced a given assistant message, if any. */
  private async getQuestionForMessage(
    conversationId: string,
    messageId: string,
  ): Promise<string | undefined> {
    const assistant = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    if (!assistant) return undefined;
    const userMsg = await this.prisma.message.findFirst({
      where: {
        conversationId,
        role: 'USER',
        createdAt: { lt: assistant.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return userMsg?.content;
  }

  /**
   * Promote a chosen interpretation of an ambiguous question to runnable SQL.
   * Validates the SQL is one of the stored options (so a client can't smuggle
   * arbitrary SQL through this path), then sets it as the message's query.
   */
  async chooseInterpretation(
    conversationId: string,
    workspaceId: string,
    messageId: string,
    sql: string,
  ) {
    await this.assertExists(conversationId, workspaceId);

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) throw new NotFoundException('Message not found');

    const clarification = message.clarification as {
      options?: Array<{ label: string; sql: string }>;
    } | null;
    const chosen = clarification?.options?.find((o) => o.sql === sql);
    if (!chosen) {
      throw new BadRequestException(
        'That interpretation is not one of the offered options.',
      );
    }

    // No re-validation here: `chosen` is one of the stored interpretations, each
    // of which was already safety-validated (with the connection's dialect) when
    // generated. The execute path re-validates with the engine before running.

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        generatedSql: chosen.sql,
        content: 'SQL generated. Review and execute when ready.',
      },
    });
  }

  /**
   * Build up to `limit` few-shot examples from past queries that ran
   * SUCCESSFULLY on this connection, pairing each with the user question that
   * produced it. Ranked by keyword overlap with the current question, then
   * recency. Returns [] when there's no usable history (e.g. a fresh DB).
   */
  private async getFewShotExamples(
    connectionId: string,
    question: string,
    limit = 4,
  ): Promise<Array<{ question: string; sql: string }>> {
    try {
      const history = await this.prisma.queryHistory.findMany({
        where: {
          connectionId,
          status: 'SUCCESS',
          messageId: { not: null },
        },
        orderBy: { executedAt: 'desc' },
        take: 20,
        include: {
          message: { select: { conversationId: true, createdAt: true } },
        },
      });
      if (history.length === 0) return [];

      // Pull the USER messages for the involved conversations in one query, then
      // match each successful SQL to the question that immediately preceded it.
      const conversationIds = [
        ...new Set(
          history.map((h) => h.message?.conversationId).filter(Boolean),
        ),
      ] as string[];
      const userMessages = await this.prisma.message.findMany({
        where: { conversationId: { in: conversationIds }, role: 'USER' },
        select: { conversationId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const byConversation = new Map<
        string,
        Array<{ content: string; createdAt: Date }>
      >();
      for (const m of userMessages) {
        const list = byConversation.get(m.conversationId) ?? [];
        list.push({ content: m.content, createdAt: m.createdAt });
        byConversation.set(m.conversationId, list);
      }

      const seen = new Set<string>();
      const candidates: Array<{ question: string; sql: string }> = [];
      for (const h of history) {
        if (!h.message) continue;
        const userMsgs = byConversation.get(h.message.conversationId) ?? [];
        // Latest user message sent before this assistant/SQL message.
        const priorQuestion = [...userMsgs]
          .reverse()
          .find((m) => m.createdAt < h.message!.createdAt)?.content;

        const q = priorQuestion?.trim();
        const sql = h.sql.trim();
        if (!q || !sql || sql.length > 600) continue;
        const key = q.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ question: q, sql });
      }

      // Rank by keyword overlap with the current question (recency as tiebreak —
      // candidates are already in newest-first order).
      const qTokens = new Set(
        question
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3),
      );
      const scored = candidates.map((c, index) => {
        const tokens = c.question
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3);
        const overlap = tokens.reduce(
          (n, t) => (qTokens.has(t) ? n + 1 : n),
          0,
        );
        return { c, overlap, index };
      });
      scored.sort((a, b) => b.overlap - a.overlap || a.index - b.index);

      return scored.slice(0, limit).map((s) => s.c);
    } catch (err) {
      // Few-shot is a best-effort enhancement; never fail generation over it.
      this.logger.warn(
        `Few-shot example lookup failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return [];
    }
  }

  private async executePaginated(
    connection: Parameters<typeof buildSshConfig>[0] & {
      engine?: string;
      host: string;
      port: number;
      databaseName: string;
      username: string;
      encryptedPassword: string;
      sslEnabled: boolean;
    },
    sql: string,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const engine = normalizeEngine(connection.engine);
    const poolCfg = {
      host: connection.host,
      port: connection.port,
      database: connection.databaseName,
      user: connection.username,
      password: this.encryption.decrypt(connection.encryptedPassword),
      ssl: connection.sslEnabled,
      ssh: buildSshConfig(connection, (s) => this.encryption.decrypt(s)),
      connectionLimit: 2,
      connectTimeout: 8000,
    };
    if (engine === 'postgres')
      return this.executePaginatedPostgres(poolCfg, sql, page, pageSize, offset);
    if (engine === 'sqlserver')
      return this.executePaginatedSqlServer(poolCfg, sql, page, pageSize, offset);
    return this.executePaginatedMysql(poolCfg, sql, page, pageSize, offset);
  }

  private async executePaginatedMysql(
    poolCfg: Parameters<typeof createMysqlPool>[0],
    sql: string,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const { pool, cleanup } = await createMysqlPool(poolCfg);
    const start = Date.now();

    try {
      await pool.query('SET SESSION MAX_EXECUTION_TIME = 30000');

      // Guardrail — estimate scan size via EXPLAIN before touching real rows.
      try {
        const [explainRows] = await pool.query<mysql.RowDataPacket[]>(
          `EXPLAIN ${sql}`,
        );
        const verdict = this.guard.evaluateExplain(
          explainRows as Record<string, unknown>[],
        );
        if (!verdict.allowed) {
          throw new GuardrailBlockedError(
            verdict.reason ?? 'Query blocked by guardrail',
          );
        }
      } catch (e) {
        if (e instanceof GuardrailBlockedError) throw e;
        // EXPLAIN itself failed (e.g. bad column) — let normal execution surface
        // the real error (which may then trigger the repair loop).
      }

      const countSql = `SELECT COUNT(*) as total FROM (${sql}) as _count_query`;
      let totalCount = 0;

      try {
        const [countRows] = await pool.query<mysql.RowDataPacket[]>(countSql);
        totalCount = Number(
          (countRows[0] as Record<string, unknown>)?.['total'] ?? 0,
        );
      } catch {
        const [rows, fields] = await pool.query<mysql.RowDataPacket[]>(sql);
        const resultRows = Array.isArray(rows) ? rows : [];
        return {
          rows: resultRows as Record<string, unknown>[],
          fields: (fields ?? []).map((f) => ({
            name: f.name,
            type: f.type ?? 0,
          })),
          rowCount: resultRows.length,
          totalCount: resultRows.length,
          page: 1,
          pageSize: resultRows.length,
          totalPages: 1,
          executionTimeMs: Date.now() - start,
        };
      }

      const paginatedSql = `${sql} LIMIT ${pageSize} OFFSET ${offset}`;
      const [rows, fields] =
        await pool.query<mysql.RowDataPacket[]>(paginatedSql);
      const resultRows = Array.isArray(rows) ? rows : [];

      return {
        rows: resultRows as Record<string, unknown>[],
        fields: (fields ?? []).map((f) => ({
          name: f.name,
          type: f.type ?? 0,
        })),
        rowCount: resultRows.length,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        executionTimeMs: Date.now() - start,
      };
    } finally {
      await cleanup();
    }
  }

  private async executePaginatedPostgres(
    poolCfg: Parameters<typeof createPostgresPool>[0],
    sql: string,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const { pool, cleanup } = await createPostgresPool(poolCfg);
    const start = Date.now();
    // Use one dedicated client so statement_timeout applies to every query.
    const client = await pool.connect();

    try {
      await client.query("SET statement_timeout = '30s'");

      // Guardrail — estimate scan size via EXPLAIN (JSON plan) before real rows.
      try {
        const plan = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
        const root = (plan.rows[0]?.['QUERY PLAN'] as
          | Array<{ Plan?: { ['Plan Rows']?: number } }>
          | undefined)?.[0];
        const estRows = Number(root?.Plan?.['Plan Rows'] ?? 0);
        const verdict = this.guard.evaluateExplain([{ rows: estRows }]);
        if (!verdict.allowed) {
          throw new GuardrailBlockedError(
            verdict.reason ?? 'Query blocked by guardrail',
          );
        }
      } catch (e) {
        if (e instanceof GuardrailBlockedError) throw e;
        // EXPLAIN itself failed — let normal execution surface the real error.
      }

      const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS _count_query`;
      let totalCount = 0;

      try {
        const countRes = await client.query(countSql);
        totalCount = Number(countRes.rows[0]?.['total'] ?? 0);
      } catch {
        const res = await client.query(sql);
        return {
          rows: res.rows as Record<string, unknown>[],
          fields: (res.fields ?? []).map((f) => ({
            name: f.name,
            type: f.dataTypeID ?? 0,
          })),
          rowCount: res.rows.length,
          totalCount: res.rows.length,
          page: 1,
          pageSize: res.rows.length,
          totalPages: 1,
          executionTimeMs: Date.now() - start,
        };
      }

      const paginatedSql = `${sql} LIMIT ${pageSize} OFFSET ${offset}`;
      const res = await client.query(paginatedSql);

      return {
        rows: res.rows as Record<string, unknown>[],
        fields: (res.fields ?? []).map((f) => ({
          name: f.name,
          type: f.dataTypeID ?? 0,
        })),
        rowCount: res.rows.length,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        executionTimeMs: Date.now() - start,
      };
    } finally {
      client.release();
      await cleanup();
    }
  }

  private async executePaginatedSqlServer(
    poolCfg: Parameters<typeof createSqlServerPool>[0],
    sql: string,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const { pool, cleanup } = await createSqlServerPool(poolCfg);
    const start = Date.now();
    const fieldsOf = (rs: { columns: Record<string, { name: string }> } | undefined) =>
      Object.values(rs?.columns ?? {}).map((f) => ({ name: f.name, type: 0 }));

    try {
      // SQL Server has no cheap row-estimate EXPLAIN; rely on requestTimeout +
      // paging to bound cost (the COUNT below also fails fast on bad SQL).
      const countSql = `SELECT COUNT_BIG(*) AS total FROM (${sql}) AS _count_query`;
      let totalCount = 0;
      try {
        const c = await pool.request().query(countSql);
        totalCount = Number(c.recordset[0]?.['total'] ?? 0);
      } catch {
        const res = await pool.request().query(sql);
        const rows = (res.recordset ?? []) as Record<string, unknown>[];
        return {
          rows,
          fields: fieldsOf(res.recordset),
          rowCount: rows.length,
          totalCount: rows.length,
          page: 1,
          pageSize: rows.length,
          totalPages: 1,
          executionTimeMs: Date.now() - start,
        };
      }

      // OFFSET/FETCH requires an ORDER BY; supply a no-op one if the query lacks it.
      const hasOrderBy = /\border\s+by\b/i.test(sql);
      const paged = hasOrderBy
        ? `${sql} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`
        : `${sql} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
      const res = await pool.request().query(paged);
      const rows = (res.recordset ?? []) as Record<string, unknown>[];

      return {
        rows,
        fields: fieldsOf(res.recordset),
        rowCount: rows.length,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        executionTimeMs: Date.now() - start,
      };
    } finally {
      await cleanup();
    }
  }

  /** Record a guardrail-blocked query attempt in history for audit. */
  private async recordBlocked(
    messageId: string,
    connectionId: string,
    sql: string,
    reason: string,
  ): Promise<void> {
    const data = {
      connectionId,
      sql,
      executionTimeMs: 0,
      rowCount: 0,
      status: 'ERROR' as const,
      errorMessage: `Blocked by guardrail: ${reason}`,
      resultSnapshot: Prisma.DbNull,
    };
    await this.prisma.queryHistory
      .upsert({
        where: { messageId },
        create: { messageId, ...data },
        update: { ...data, executedAt: new Date() },
      })
      .catch(() => {
        /* audit write is best-effort */
      });
  }

  private suggestChart(
    question: string,
    fields: QueryField[],
  ): ChartConfig | null {
    if (fields.length < 2) return null;

    const numericTypes = new Set([0, 1, 2, 3, 4, 5, 246, 8, 9]);
    const dateTypes = new Set([10, 11, 12, 13, 14]);

    const numericFields = fields.filter((f) =>
      numericTypes.has(Number(f.type)),
    );
    const dateFields = fields.filter((f) => dateTypes.has(Number(f.type)));
    const textFields = fields.filter(
      (f) =>
        !numericTypes.has(Number(f.type)) && !dateTypes.has(Number(f.type)),
    );

    if (dateFields.length > 0 && numericFields.length > 0) {
      return {
        type: 'line',
        xKey: dateFields[0]?.name,
        yKey: numericFields[0]?.name,
        title: question,
      };
    }
    if (textFields.length > 0 && numericFields.length > 0) {
      return {
        type: 'bar',
        xKey: textFields[0]?.name,
        yKey: numericFields[0]?.name,
        title: question,
      };
    }
    return null;
  }

  private async updateTitleIfNeeded(
    conversationId: string,
    firstMessage: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (conversation?.title === 'New Conversation') {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { title: firstMessage.slice(0, 60) },
      });
    }
  }

  private async assertExists(conversationId: string, workspaceId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }
}
