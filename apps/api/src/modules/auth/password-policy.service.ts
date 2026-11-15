import { BadRequestException, Injectable } from '@nestjs/common';
import { PwnedPasswordService } from './pwned-password.service';

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly pwnedPasswordService: PwnedPasswordService) {}

  async assertPasswordAcceptable(password: string): Promise<void> {
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasLowercase || !hasUppercase || !hasNumber || !hasSpecial) {
      throw new BadRequestException(
        'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
      );
    }

    const isBreached = await this.pwnedPasswordService.isBreached(password);
    if (isBreached) {
      throw new BadRequestException(
        'This password has appeared in a known data breach. Please choose a different password.',
      );
    }
  }
}
