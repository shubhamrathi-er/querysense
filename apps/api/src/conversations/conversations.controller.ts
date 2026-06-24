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
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type express from 'express';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ExecuteSqlDto } from './dto/execute-sql.dto';
import { ChooseInterpretationDto } from './dto/choose-interpretation.dto';
import { ImportRecordDto } from './dto/import-record.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/conversations')
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Get()
  findAll(@Param('workspaceId') workspaceId: string): Promise<unknown> {
    return this.conversationsService.findAll(workspaceId);
  }

  @Get(':conversationId')
  findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ): Promise<unknown> {
    return this.conversationsService.findOne(conversationId, workspaceId);
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateConversationDto,
  ): Promise<unknown> {
    return this.conversationsService.create(workspaceId, dto);
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: 'Rename or pin/unpin a conversation' })
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<unknown> {
    return this.conversationsService.update(conversationId, workspaceId, dto);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ): Promise<unknown> {
    return this.conversationsService.delete(conversationId, workspaceId);
  }

  // SSE: Generate SQL with step-by-step progress stream
  @Post(':conversationId/messages')
  @ApiOperation({ summary: 'Generate SQL with SSE progress stream' })
  async generateSQL(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: express.Response,
  ): Promise<void> {
    await this.conversationsService.generateSQLStream(
      conversationId,
      workspaceId,
      dto,
      res,
    );
  }

  // Record a data import (CSV/JSON/… upload) in the conversation history
  @Post(':conversationId/import-record')
  @ApiOperation({ summary: 'Append a data-import record to the conversation' })
  recordImport(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: ImportRecordDto,
  ): Promise<unknown> {
    return this.conversationsService.recordImport(
      conversationId,
      workspaceId,
      dto,
    );
  }

  // Pick one interpretation of an ambiguous question → promote it to runnable SQL
  @Post(':conversationId/messages/:messageId/choose-interpretation')
  @ApiOperation({ summary: 'Choose an interpretation for an ambiguous question' })
  chooseInterpretation(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ChooseInterpretationDto,
  ): Promise<unknown> {
    return this.conversationsService.chooseInterpretation(
      conversationId,
      workspaceId,
      messageId,
      dto.sql,
    );
  }

  // Execute SQL with pagination
  @Post(':conversationId/messages/:messageId/execute')
  @ApiOperation({ summary: 'Execute SQL with server-side pagination' })
  executeSQL(
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ExecuteSqlDto,
  ): Promise<unknown> {
    return this.conversationsService.executeSQL(
      conversationId,
      workspaceId,
      messageId,
      dto,
    );
  }
}
