import {
  IsString,
  IsOptional,
  MaxLength,
  Matches,
  ValidateIf,
  IsUrl,
} from 'class-validator';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_obj, val) => val !== '' && val !== null && val !== undefined)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'brandLogoUrl must be a valid http or https URL' },
  )
  brandLogoUrl?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_obj, val) => val !== '' && val !== null && val !== undefined)
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message:
      'brandAccentColor must be a valid 6-character hex color code (e.g. #111827)',
  })
  brandAccentColor?: string;
}
