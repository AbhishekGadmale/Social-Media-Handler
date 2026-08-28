import { IsNotEmpty, IsString, IsOptional, ValidateIf } from 'class-validator';

export class OAuthCallbackQueryDto {
  @ValidateIf((o) => !o.error)
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsOptional()
  @IsString()
  iss?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  error?: string;
}
