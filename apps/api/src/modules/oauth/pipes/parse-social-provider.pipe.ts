import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { SocialProvider } from '@agency-os/database';

@Injectable()
export class ParseSocialProviderPipe implements PipeTransform<
  string,
  SocialProvider
> {
  transform(value: string): SocialProvider {
    if (!value) {
      throw new BadRequestException(
        'Validation failed (provider string is expected)',
      );
    }

    const uppercaseValue = value.toUpperCase();

    // Check if the uppercase value exists in the SocialProvider enum
    if (
      Object.values(SocialProvider).includes(uppercaseValue as SocialProvider)
    ) {
      return uppercaseValue as SocialProvider;
    }

    throw new BadRequestException(
      `Validation failed (enum string is expected)`,
    );
  }
}
