export interface SyncJobData {
  socialAccountId: string;
  workspaceId: string;
  correlationId?: string;
  operationId?: string;
}

export interface PublishJobData {
  workspaceId: string;
  publicationId: string;
  dispatchVersion: number;
  correlationId?: string;
  operationId?: string;
}

export interface PublishDeleteJobData {
  workspaceId: string;
  publicationId: string;
  correlationId?: string;
  operationId?: string;
}
