import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";

export interface MediaPreviewUrlResponse {
  url: string;
  expiresAt: string;
}

export const mediaQueries = {
  previewUrl: (workspaceId: string, mediaId: string) =>
    queryOptions({
      queryKey: ["workspaces", workspaceId, "media", mediaId, "preview-url"],
      queryFn: () =>
        api.get<MediaPreviewUrlResponse>(
          `workspaces/${workspaceId}/media/${mediaId}/preview-url`,
        ),
      enabled: !!workspaceId && !!mediaId,
      staleTime: 5 * 60 * 1000,
    }),
};
