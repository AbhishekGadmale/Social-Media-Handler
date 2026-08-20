import { User, WorkspaceRole } from '@agency-os/database';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      workspaceRole?: WorkspaceRole;
    }
  }
}
