import { IsEnum, IsNotEmpty } from 'class-validator';
import { WorkspaceRole } from '@agency-os/database';

export class UpdateMemberRoleDto {
  @IsNotEmpty()
  @IsEnum(WorkspaceRole, {
    message:
      'role must be a valid WorkspaceRole (OWNER, MANAGER, EDITOR, CLIENT_APPROVER, VIEWER)',
  })
  role!: WorkspaceRole;
}
