import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  mediaIds?: string[];
}

export class UpdatePostDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  mediaIds?: string[];
}

export class RequestChangesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment!: string;
}
