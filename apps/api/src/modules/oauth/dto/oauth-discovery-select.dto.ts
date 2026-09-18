import {
  IsArray,
  IsString,
  ArrayNotEmpty,
  ArrayUnique,
  ArrayMaxSize,
} from 'class-validator';

export class OAuthDiscoverySelectDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @ArrayUnique()
  profileIds!: string[];
}
