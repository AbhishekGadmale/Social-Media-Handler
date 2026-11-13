import {
  Equals,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name!: string;

  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  password!: string;

  @IsDefined()
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms of Service and Privacy Policy',
  })
  termsAccepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100, {
    message: 'Organization name must not exceed 100 characters',
  })
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Workspace name must not exceed 100 characters' })
  workspaceName?: string;
}
