/**
 * Parses and validates the TRUST_PROXY environment variable for Express.
 *
 * Supported values:
 * - Unset or empty:
 *     - production (NODE_ENV === 'production'): defaults to 1 (trusts 1 upstream ingress hop)
 *     - non-production: defaults to false (disabled, direct client connection)
 * - "true": enables full proxy trust (boolean true)
 * - "false" or "0": explicitly disables proxy trust (boolean false)
 * - Positive integer (e.g. "1", "2"): specifies the exact number of trusted upstream proxy hops
 *
 * Any other value throws an Error to fail fast on malformed configuration.
 */
export function parseTrustProxy(
  trustProxyEnv: string | undefined,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean | number {
  if (trustProxyEnv === undefined || trustProxyEnv.trim() === '') {
    return isProduction ? 1 : false;
  }

  const trimmed = trustProxyEnv.trim().toLowerCase();

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false' || trimmed === '0') {
    return false;
  }

  if (/^[1-9]\d*$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  throw new Error(
    `Invalid TRUST_PROXY configuration: "${trustProxyEnv}". Supported values: positive integer (e.g. "1", "2"), "true", "false", or "0".`,
  );
}

/**
 * Configures the Express application's "trust proxy" setting based on environment.
 */
export function configureTrustProxy(
  app: { set(setting: string, val: unknown): unknown },
  trustProxyEnv: string | undefined = process.env.TRUST_PROXY,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean | number {
  const setting = parseTrustProxy(trustProxyEnv, isProduction);
  app.set('trust proxy', setting);
  return setting;
}
