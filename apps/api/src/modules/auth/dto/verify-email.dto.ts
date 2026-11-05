import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'Token must be a string' })
  @IsNotEmpty({ message: 'Verification token is required' })
  @MinLength(32, { message: 'Token must be at least 32 characters long' })
  @MaxLength(128, { message: 'Token must not exceed 128 characters' })
  token!: string;
}
