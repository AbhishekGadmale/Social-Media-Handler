import {
  IsString,
  IsOptional,
  IsUUID,
  IsObject,
  IsDateString,
  IsIn,
  ValidateIf,
  IsNotEmpty,
  Matches,
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

  @ValidateIf((o) => o.decision === 'CONFIRM_PUBLISHED')
  @IsString()
  @IsNotEmpty({
    message: 'externalPostId is required when confirming as published',
  })
  @Matches(/\S/, { message: 'externalPostId cannot be whitespace only' })
  externalPostId?: string;

  @IsString()
  @IsOptional()
  canonicalUrl?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'reason cannot be whitespace only' })
  reason: string;
}
