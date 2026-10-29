export interface PublishJobData {
  workspaceId: string;
  publicationId: string;
  dispatchVersion: number;
  correlationId?: string;
  operationId?: string;
}
