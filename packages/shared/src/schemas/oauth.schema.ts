import { z } from 'zod';

export const OAuthStateSchema = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  provider: z.string(),
  codeVerifier: z.string(),
  createdAt: z.string(),
});
