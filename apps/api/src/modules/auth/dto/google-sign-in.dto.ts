import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GoogleSignInDto {
  @IsString()
  @IsNotEmpty()
  credential: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
