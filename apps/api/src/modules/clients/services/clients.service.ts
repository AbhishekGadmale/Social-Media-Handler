import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  AuditAction,
  generateId,
} from '@agency-os/database';
import { AuditService } from '../../core/audit.service';
import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async createClient(
    workspaceId: string,
    actorId: string,
    dto: CreateClientDto,
  ) {
    const trimmedName = dto.name.trim();
    if (!trimmedName) {
      throw new BadRequestException('Client name cannot be empty');
    }

    const client = await this.prisma.client.create({
      data: {
        id: generateId(),
        workspaceId,
        name: trimmedName,
        brandDisplayName: dto.brandDisplayName
          ? dto.brandDisplayName.trim() || null
          : null,
        brandLogoUrl: dto.brandLogoUrl ? dto.brandLogoUrl.trim() || null : null,
        brandAccentColor: dto.brandAccentColor
          ? dto.brandAccentColor.trim() || null
          : null,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId,
      action: AuditAction.CLIENT_CREATED,
      targetType: 'CLIENT',
      targetId: client.id,
      metadata: { name: client.name },
    });

    return client;
  }

  async listClients(workspaceId: string) {
    const clients = await this.prisma.client.findMany({
      where: { workspaceId },
      include: {
        _count: {
          select: {
            accounts: true,
            members: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return clients.map((c) => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      brandDisplayName: c.brandDisplayName,
      brandLogoUrl: c.brandLogoUrl,
      brandAccentColor: c.brandAccentColor,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      accountCount: c._count.accounts,
      scopedMemberCount: c._count.members,
    }));
  }

  async getClient(workspaceId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, workspaceId },
      include: {
        _count: {
          select: {
            accounts: true,
            members: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return {
      id: client.id,
      workspaceId: client.workspaceId,
      name: client.name,
      brandDisplayName: client.brandDisplayName,
      brandLogoUrl: client.brandLogoUrl,
      brandAccentColor: client.brandAccentColor,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      accountCount: client._count.accounts,
      scopedMemberCount: client._count.members,
    };
  }

  async updateClient(
    workspaceId: string,
    clientId: string,
    actorId: string,
    dto: UpdateClientDto,
  ) {
    const existing = await this.prisma.client.findFirst({
      where: { id: clientId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    const data: Prisma.ClientUpdateInput = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Client name cannot be empty');
      }
      data.name = trimmed;
    }
    if (dto.brandDisplayName !== undefined) {
      data.brandDisplayName =
        dto.brandDisplayName.trim() === '' ? null : dto.brandDisplayName.trim();
    }
    if (dto.brandLogoUrl !== undefined) {
      data.brandLogoUrl =
        dto.brandLogoUrl.trim() === '' ? null : dto.brandLogoUrl.trim();
    }
    if (dto.brandAccentColor !== undefined) {
      data.brandAccentColor =
        dto.brandAccentColor.trim() === '' ? null : dto.brandAccentColor.trim();
    }

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data,
    });

    await this.audit.logAction({
      workspaceId,
      actorId,
      action: AuditAction.CLIENT_UPDATED,
      targetType: 'CLIENT',
      targetId: clientId,
      metadata: { name: updated.name },
    });

    return updated;
  }

  async deleteClient(workspaceId: string, clientId: string, actorId: string) {
    const existing = await this.prisma.client.findFirst({
      where: { id: clientId, workspaceId },
    });

    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    const scopedMemberCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, clientId },
    });

    if (scopedMemberCount > 0) {
      throw new ConflictException(
        "Remove or reassign this client's approver first.",
      );
    }

    await this.prisma.client.delete({
      where: { id: clientId },
    });

    await this.audit.logAction({
      workspaceId,
      actorId,
      action: AuditAction.CLIENT_DELETED,
      targetType: 'CLIENT',
      targetId: clientId,
      metadata: { name: existing.name },
    });

    return { success: true };
  }
}
