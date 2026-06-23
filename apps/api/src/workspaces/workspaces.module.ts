import { Module } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceMemberGuard } from './guards/workspace-member.guard';

@Module({
  providers: [WorkspacesService, WorkspaceMemberGuard],
  controllers: [WorkspacesController],
  exports: [WorkspacesService, WorkspaceMemberGuard],
})
export class WorkspacesModule {}
