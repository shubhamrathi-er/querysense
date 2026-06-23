import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';

// interface RequestWithUser extends Request {
//   user: { id: string; email: string };
//   workspaceMember?: { role: string };
// }
interface WorkspaceParams {
  workspaceId: string;
}

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request<WorkspaceParams>>();
    const user = request.user;
    const workspaceId = request.params['workspaceId'];

    if (!workspaceId) return true;

    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user?.id as string,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    request.workspaceMember = { role: member.role };
    return true;
  }
}
