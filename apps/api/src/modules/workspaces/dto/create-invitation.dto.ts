import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { WorkspaceRole } from '@agency-os/database';

export class CreateInvitationDto {
  @IsNotEmpty()
  @IsEmail()
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsNotEmpty()
  @IsEnum(WorkspaceRole, {
    message:
      'role must be a valid WorkspaceRole (OWNER, MANAGER, EDITOR, CLIENT_APPROVER, VIEWER)',
  })
  role!: WorkspaceRole;
}
