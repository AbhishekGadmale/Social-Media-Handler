/* eslint-disable */
import { INestApplication } from '@nestjs/common';
const request: any = require('supertest');

export async function loginAndGetSession(
  app: INestApplication,
  email: string,
  password = 'password',
): Promise<{
  sessionCookie: string;
  csrfToken: string;
  combinedCookie: string;
}> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    console.error('Login failed body:', res.body);
    throw new Error(`Login failed with status ${res.status}`);
  }

  const cookies = res.headers['set-cookie'] as string[];
  const sessionCookieHeader = cookies.find((c) => c.startsWith('session='));
  const csrfCookieHeader = cookies.find((c) => c.startsWith('csrfToken='));

  if (!sessionCookieHeader || !csrfCookieHeader) {
    throw new Error('Missing session or csrfToken cookie in login response');
  }

  const session = sessionCookieHeader.split(';')[0];
  const csrf = csrfCookieHeader.split(';')[0].split('=')[1];

  return {
    sessionCookie: session,
    csrfToken: csrf,
    combinedCookie: `${session}; csrfToken=${csrf}`,
  };
}

export function authHeaders(sessionData: {
  combinedCookie: string;
  csrfToken: string;
}) {
  return {
    Cookie: sessionData.combinedCookie,
    'x-csrf-token': sessionData.csrfToken,
  };
}
