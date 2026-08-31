import { Params } from 'nestjs-pino';
import { generateId } from '@agency-os/database';

export const loggerConfig: Params = {
  pinoHttp: {
    // We can define redaction paths. pino-http automatically logs req and res.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'res.headers.set-cookie',
        'req.body.password',
        'req.query.code', // OAuth authorization codes
        'req.query.state', // OAuth state values
        'req.query.session',
        'req.query.csrfToken',
        // Additional safe-guards for potential body leaks
        'req.body.accessToken',
        'req.body.refreshToken',
        'req.body.encryptedTokens',
        'req.body.code',
        'req.body.state',
        'req.body.credentials',
      ],
      censor: '[REDACTED]',
    },
    genReqId: (req) => {
      // Reuse existing x-request-id if safe, else generate a new safe ID
      return req.headers['x-request-id'] || generateId();
    },
    customProps: (req, res) => {
      return {
        context: 'HTTP',
      };
    },
    // We can explicitly prevent the full URL query string from being logged if it contains secrets.
    // pino-http logs `req.url` which includes the query string.
    // To sanitize `req.url`, we can override the serializers.
    serializers: {
      req: (req: any) => {
        // req is a pino request object
        const urlStr = (req.url as string) || '';
        const headers = { ...req.headers };
        if (headers['x-csrf-token']) {
          headers['x-csrf-token'] = '[REDACTED]';
        }

        const sanitizedReq = {
          id: req.id,
          method: req.method,
          url: urlStr, // default url
          headers: headers,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
        };

        if (urlStr) {
          try {
            // Only strip the query string on OAuth callback endpoints where code/state are in the URL.
            // Alternatively, strip query string entirely or parse and redact.
            // Node.js URL API requires a base to parse relative URLs.
            const parsedUrl = new URL(urlStr, 'http://localhost');
            if (urlStr.includes('/oauth/') && urlStr.includes('/callback')) {
              parsedUrl.searchParams.delete('code');
              parsedUrl.searchParams.delete('state');
              sanitizedReq.url = parsedUrl.pathname + parsedUrl.search;
            }
          } catch (e) {
            // If parsing fails, be safe and just return the path (before the ?)
            sanitizedReq.url = urlStr.split('?')[0];
          }
        }
        return sanitizedReq;
      },
      res: (res) => ({
        statusCode: res.statusCode,
        headers: res.headers,
      }),
    },
  },
};
