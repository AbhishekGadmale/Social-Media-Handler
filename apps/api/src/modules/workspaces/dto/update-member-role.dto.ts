import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { WorkspaceRole } from '@agency-os/database';

export class UpdateMemberRoleDto {
  @IsNotEmpty()
  @IsEnum(WorkspaceRole, {
    message:
      'role must be a valid WorkspaceRole (OWNER, MANAGER, EDITOR, CLIENT_APPROVER, VIEWER)',
  })
  role!: WorkspaceRole;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;
}
