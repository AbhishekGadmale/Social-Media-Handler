import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { WorkspaceGuard } from '../../auth/guards/workspace.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { RequirePermission } from '../../auth/decorators/permission.decorator';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { ClientsService } from '../services/clients.service';
import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';

@Controller('v1/workspaces/:workspaceId/clients')
@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('clients.manage')
  async createClient(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.createClient(workspaceId, user.id, dto);
  }

  @Get()
  @RequirePermission('clients.view')
  async listClients(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    const clients = await this.clientsService.listClients(workspaceId);
    return { clients };
  }

  @Get(':clientId')
  @RequirePermission('clients.view')
  async getClient(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.getClient(workspaceId, clientId);
  }

  @Patch(':clientId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('clients.manage')
  async updateClient(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.updateClient(
      workspaceId,
      clientId,
      user.id,
      dto,
    );
  }

  @Delete(':clientId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('clients.manage')
  async deleteClient(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @CurrentUser() user: any,
  ) {
    return this.clientsService.deleteClient(workspaceId, clientId, user.id);
  }
}
