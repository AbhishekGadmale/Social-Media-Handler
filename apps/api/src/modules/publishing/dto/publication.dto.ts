import {
  IsString,
  IsOptional,
  IsUUID,
  IsObject,
  IsDateString,
  IsIn,
} from 'class-validator';

export class AddPublicationTargetDto {
  @IsUUID()
  socialAccountId: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsObject()
  @IsOptional()
  providerOptions?: Record<string, any>;
}

export class UpdatePublicationTargetDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsObject()
  @IsOptional()
  providerOptions?: Record<string, any>;
}

export class SchedulePublicationDto {
  @IsDateString()
  scheduledAt: string;
}

export class ReconcilePublicationDto {
  @IsIn(['CONFIRM_PUBLISHED', 'CONFIRM_FAILED'])
  decision: 'CONFIRM_PUBLISHED' | 'CONFIRM_FAILED';

  @IsString()
  @IsOptional()
  externalPostId?: string;

  @IsString()
  @IsOptional()
  canonicalUrl?: string;

  @IsString()
  reason: string;
}
