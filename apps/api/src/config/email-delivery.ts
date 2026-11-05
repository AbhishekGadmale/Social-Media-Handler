/**
 * Validates the email delivery configuration at application startup.
 *
 * Supported behavior:
 * - Production (NODE_ENV === 'production'):
 *     - RESEND_API_KEY is REQUIRED. A missing, empty, or whitespace-only value throws a fail-fast Error.
 *     - Prevents production deployments from silently falling back to NoopEmailDeliveryService
 *       while 403 email-verification gates are active, which would permanently lock out all new user signups.
 *     - Validates presence and non-emptiness only (does not execute external network calls at boot).
 * - Non-production (development, test):
 *     - RESEND_API_KEY is OPTIONAL.
 *     - MockEmailDeliveryService or NoopEmailDeliveryService fallback remains active without throwing,
 *       preserving local development and test suite ergonomics.
 */
export function validateEmailDeliveryConfig(
  apiKey: string | undefined = process.env.RESEND_API_KEY,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): string | undefined {
  if (isProduction) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        'RESEND_API_KEY environment variable is required in production. Verification emails cannot be delivered and new signups will be locked out by 403 email verification gates. Set RESEND_API_KEY to a valid Resend API key.',
      );
    }
    return apiKey.trim();
  }

  return apiKey?.trim();
}
