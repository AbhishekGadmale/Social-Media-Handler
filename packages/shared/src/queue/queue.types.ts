export interface SyncJobData {
  socialAccountId: string;
  workspaceId: string;
  correlationId?: string;
}

export interface PublishJobData {
  workspaceId: string;
  publicationId: string;
  dispatchVersion: number;
  correlationId?: string;
  operationId?: string;
}
