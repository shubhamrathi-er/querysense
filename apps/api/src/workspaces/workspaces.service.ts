import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService) {}

  async findAllForUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: {
          select: { connections: true, members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
        _count: {
          select: { connections: true, conversations: true },
        },
      },
    });

    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const slug = await this.generateUniqueSlug(dto.name);

    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        creatorId: userId,
        members: {
          create: {
            userId,
            role: 'OWNER',
            joinedAt: new Date(),
          },
        },
      },
    });
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.assertOwnerOrAdmin(workspaceId, userId);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: dto,
    });
  }

  async delete(workspaceId: string, userId: string) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  private async assertOwner(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member || member.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the workspace owner can perform this action',
      );
    }
  }

  private async assertOwnerOrAdmin(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);

    let slug = base;
    let counter = 0;
    while (await this.prisma.workspace.findUnique({ where: { slug } })) {
      counter++;
      slug = `${base}-${counter}`;
    }
    return slug;
  }
}
