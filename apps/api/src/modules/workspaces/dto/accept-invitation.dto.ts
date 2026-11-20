import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptInvitationDto {
  @IsNotEmpty()
  @IsString()
  token!: string;
}
