import { validate } from 'class-validator';
import { LoginDto } from '../src/modules/auth/dto/login.dto';
import { OAuthCallbackQueryDto } from '../src/modules/oauth/dto/oauth-callback-query.dto';
import { ParseUUIDPipe, ParseEnumPipe, ArgumentMetadata } from '@nestjs/common';
import { SocialProvider } from '@agency-os/database';
import { ParseSocialProviderPipe } from '../src/modules/oauth/pipes/parse-social-provider.pipe';

describe('Validation Tests', () => {
  describe('LoginDto', () => {
    it('should validate a correct login request', async () => {
      const dto = new LoginDto();
      dto.email = 'test@example.com';
      dto.password = 'password123';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject malformed email', async () => {
      const dto = new LoginDto();
      dto.email = 'not-an-email';
      dto.password = 'password123';
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should reject missing password', async () => {
      const dto = new LoginDto();
      dto.email = 'test@example.com';
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });
  });

  describe('OAuthCallbackQueryDto', () => {
    it('should validate correct callback query with code and state', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.code = 'valid-code';
      dto.state = 'valid-state';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate correct callback query with code, state, iss, and scope', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.code = 'valid-code';
      dto.state = 'valid-state';
      dto.iss = 'https://accounts.google.com';
      dto.scope = 'email profile';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate provider error callback with error and state', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.error = 'access_denied';
      dto.state = 'valid-state';
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject missing code on successful path (no error)', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.state = 'valid-state';
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('code');
    });

    it('should reject missing state', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.code = 'valid-code';
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('state');
    });

    it('should reject unexpected arbitrary property', async () => {
      const dto = new OAuthCallbackQueryDto();
      dto.code = 'valid-code';
      dto.state = 'valid-state';
      (dto as any).unexpectedField = 'malicious';
      // forbidNonWhitelisted requires the validate function to be configured with it,
      // but we test this by ensuring the DTO doesn't define it.
      // Wait, class-validator 'validate' doesn't fail on unexpected unless whitelist: true
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('unexpectedField');
    });
  });

  describe('ParseUUIDPipe', () => {
    let pipe: ParseUUIDPipe;

    beforeEach(() => {
      pipe = new ParseUUIDPipe();
    });

    it('should accept valid UUID v4', async () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const result = await pipe.transform(uuid, {} as ArgumentMetadata);
      expect(result).toBe(uuid);
    });

    it('should accept valid UUID v7', async () => {
      // Example UUIDv7
      const uuid = '018e6988-34f3-7a2e-8d59-bb48e142e88a';
      const result = await pipe.transform(uuid, {} as ArgumentMetadata);
      expect(result).toBe(uuid);
    });

    it('should reject invalid UUID', async () => {
      await expect(
        pipe.transform('invalid-uuid', {} as ArgumentMetadata),
      ).rejects.toThrow();
    });
  });

  describe('ParseSocialProviderPipe', () => {
    let pipe: ParseSocialProviderPipe;

    beforeEach(() => {
      pipe = new ParseSocialProviderPipe();
    });

    it('should accept lowercase supported provider and transform to enum', () => {
      const result = pipe.transform('youtube');
      expect(result).toBe(SocialProvider.YOUTUBE);
    });

    it('should accept uppercase supported provider', () => {
      const result = pipe.transform('YOUTUBE');
      expect(result).toBe(SocialProvider.YOUTUBE);
    });

    it('should reject unsupported provider', () => {
      expect(() => pipe.transform('UNSUPPORTED_PROVIDER')).toThrow();
    });

    it('should reject malformed provider', () => {
      expect(() => pipe.transform('youtube123')).toThrow();
    });
  });
});
