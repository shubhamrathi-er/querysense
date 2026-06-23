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
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from './guards/workspace-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List all workspaces for current user' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.workspacesService.findAllForUser(user.id);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: 'Get workspace details' })
  findOne(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.findOne(workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new workspace' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(user.id, dto);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: 'Update workspace' })
  update(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(workspaceId, user.id, dto);
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete workspace' })
  delete(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.workspacesService.delete(workspaceId, user.id);
  }
}
