import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenVerifierService } from './google-token-verifier.service';

describe('GoogleTokenVerifierService', () => {
  let service: GoogleTokenVerifierService;
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let fetchMock: any;

  beforeEach(() => {
    service = new GoogleTokenVerifierService();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_TOKENINFO_URL =
      'https://oauth2.googleapis.com/tokeninfo';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws ServiceUnavailableException when GOOGLE_CLIENT_ID is unset or empty', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(service.verify('some-token')).rejects.toThrow(
      new ServiceUnavailableException('Google sign-in is not configured.'),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.GOOGLE_CLIENT_ID = '   ';
    await expect(service.verify('some-token')).rejects.toThrow(
      new ServiceUnavailableException('Google sign-in is not configured.'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when credential is missing or empty', async () => {
    await expect(service.verify('')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
    await expect(service.verify('   ')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('successfully verifies a valid token and returns email and name', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: String(futureExp),
        email_verified: 'true',
        email: 'Alice.Smith@example.COM',
        name: 'Alice Smith',
      }),
    });

    const result = await service.verify('valid-credential-token');

    expect(result).toEqual({
      email: 'alice.smith@example.com',
      name: 'Alice Smith',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const params = new URLSearchParams(options.body);
    expect(params.get('id_token')).toBe('valid-credential-token');
  });

  it('accepts iss accounts.google.com without https:// and handles boolean email_verified', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 1800;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'accounts.google.com',
        exp: futureExp,
        email_verified: true,
        email: 'bob@example.com',
        name: 'Bob',
      }),
    });

    const result = await service.verify('valid-token-no-https-iss');
    expect(result).toEqual({
      email: 'bob@example.com',
      name: 'Bob',
    });
  });

  it('returns null name when token payload does not contain name', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: String(futureExp),
        email_verified: 'true',
        email: 'noname@example.com',
      }),
    });

    const result = await service.verify('token-without-name');
    expect(result).toEqual({
      email: 'noname@example.com',
      name: null,
    });
  });

  it('rejects token when aud does not match GOOGLE_CLIENT_ID', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'different-client-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: String(futureExp),
        email_verified: 'true',
        email: 'user@example.com',
      }),
    });

    await expect(service.verify('wrong-aud-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });

  it('rejects token when iss is invalid', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'https://evil.accounts.com',
        exp: String(futureExp),
        email_verified: 'true',
        email: 'user@example.com',
      }),
    });

    await expect(service.verify('wrong-iss-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });

  it('rejects expired token', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: String(pastExp),
        email_verified: 'true',
        email: 'user@example.com',
      }),
    });

    await expect(service.verify('expired-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });

  it('rejects unverified email', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        aud: 'test-client-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: String(futureExp),
        email_verified: 'false',
        email: 'user@example.com',
      }),
    });

    await expect(service.verify('unverified-email-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });

  it('rejects when tokeninfo endpoint returns non-200 HTTP status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error_description: 'Invalid Value' }),
    });

    await expect(service.verify('invalid-google-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });

  it('rejects when network error / fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network connection failed'));

    await expect(service.verify('network-fail-token')).rejects.toThrow(
      new UnauthorizedException('Google sign-in failed. Please try again.'),
    );
  });
});
