import { IsOptional, IsUUID } from 'class-validator';

export class AssignAccountClientDto {
  @IsOptional()
  @IsUUID()
  clientId?: string | null;
}
