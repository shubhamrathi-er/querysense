import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ImportService } from './import.service';
import { GoogleSheetDto } from './dto/google-sheet.dto';
import { InterpretFilterDto } from './dto/interpret-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../workspaces/guards/workspace-member.guard';

@ApiTags('Import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/import')
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('google-sheet')
  @ApiOperation({ summary: 'Fetch a public Google Sheet as CSV' })
  googleSheet(
    @Param('workspaceId') _workspaceId: string,
    @Body() dto: GoogleSheetDto,
  ) {
    return this.importService.fetchGoogleSheet(dto.url);
  }

  @Post('interpret-filter')
  @ApiOperation({ summary: 'Interpret a context instruction into a row filter' })
  interpretFilter(
    @Param('workspaceId') _workspaceId: string,
    @Body() dto: InterpretFilterDto,
  ) {
    return this.importService.interpretFilter(dto);
  }
}
