import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PasswordPolicyService } from './password-policy.service';
import { PwnedPasswordService } from './pwned-password.service';

describe('PasswordPolicyService', () => {
  let service: PasswordPolicyService;
  let pwnedPasswordServiceMock: { isBreached: ReturnType<typeof vi.fn> };

  const COMPLEXITY_ERROR =
    'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.';
  const BREACH_ERROR =
    'This password has appeared in a known data breach. Please choose a different password.';

  beforeEach(async () => {
    pwnedPasswordServiceMock = {
      isBreached: vi.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordPolicyService,
        {
          provide: PwnedPasswordService,
          useValue: pwnedPasswordServiceMock,
        },
      ],
    }).compile();

    service = module.get<PasswordPolicyService>(PasswordPolicyService);
  });

  describe('complexity requirements', () => {
    it('throws BadRequestException when missing uppercase letter and does not call isBreached', async () => {
      await expect(
        service.assertPasswordAcceptable('lowercase123!'),
      ).rejects.toThrow(new BadRequestException(COMPLEXITY_ERROR));
      expect(pwnedPasswordServiceMock.isBreached).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when missing lowercase letter and does not call isBreached', async () => {
      await expect(
        service.assertPasswordAcceptable('UPPERCASE123!'),
      ).rejects.toThrow(new BadRequestException(COMPLEXITY_ERROR));
      expect(pwnedPasswordServiceMock.isBreached).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when missing number and does not call isBreached', async () => {
      await expect(
        service.assertPasswordAcceptable('UppercaseLowercase!'),
      ).rejects.toThrow(new BadRequestException(COMPLEXITY_ERROR));
      expect(pwnedPasswordServiceMock.isBreached).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when missing special character and does not call isBreached', async () => {
      await expect(
        service.assertPasswordAcceptable('UppercaseLowercase123'),
      ).rejects.toThrow(new BadRequestException(COMPLEXITY_ERROR));
      expect(pwnedPasswordServiceMock.isBreached).not.toHaveBeenCalled();
    });
  });

  describe('breach check requirement', () => {
    it('throws BadRequestException when compliant but breached', async () => {
      pwnedPasswordServiceMock.isBreached.mockResolvedValueOnce(true);

      await expect(
        service.assertPasswordAcceptable('CompliantPassword123!'),
      ).rejects.toThrow(new BadRequestException(BREACH_ERROR));
      expect(pwnedPasswordServiceMock.isBreached).toHaveBeenCalledWith(
        'CompliantPassword123!',
      );
    });

    it('resolves when compliant and not breached', async () => {
      pwnedPasswordServiceMock.isBreached.mockResolvedValueOnce(false);

      await expect(
        service.assertPasswordAcceptable('CompliantPassword123!'),
      ).resolves.toBeUndefined();
      expect(pwnedPasswordServiceMock.isBreached).toHaveBeenCalledWith(
        'CompliantPassword123!',
      );
    });
  });
});
