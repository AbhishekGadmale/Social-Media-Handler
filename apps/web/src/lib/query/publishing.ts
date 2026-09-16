 

import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'QUEUED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN' | 'DELETING' | 'DELETED';
export type Visibility = 'PUBLIC' | 'PRIVATE' | 'UNLISTED';

export interface PostMedia {
  id: string;
  mediaId: string;
  media: {
    id: string;
    mimeType: string;
    status: string;
    storageKey?: string;
  };
}

export interface PostPlatformVariant {
  id: string;
  postId: string;
  socialAccountId: string;
  status: PostStatus;
  externalPostId: string | null;
  canonicalUrl: string | null;
  content: string | null;
  providerOptions: Record<string, unknown> | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  socialAccount?: {
    id: string;
    name: string;
    provider: string;
  };
}

export interface Post {
  id: string;
  workspaceId: string;
  content: string;
  status: PostStatus;
  createdAt: string;
  updatedAt: string;
  media: PostMedia[];
  variants: PostPlatformVariant[];
}

export interface PostsResponse {
  posts: Post[];
  total: number;
}

export const publishingQueries = {
  list: (workspaceId: string, skip = 0, take = 50) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'posts', { skip, take }],
      queryFn: () => api.get<Post[]>(`workspaces/${workspaceId}/posts?skip=${skip}&take=${take}`),
      enabled: !!workspaceId,
      refetchInterval: (query: import('@tanstack/react-query').Query<Post[], Error>) => {
        const hasActive = query?.state?.data?.some((p: Post) => 
          p.variants?.some((v) => v.status === 'QUEUED' || v.status === 'PUBLISHING' || v.status === 'DELETING')
        );
        return hasActive ? 3000 : false;
      },
    }),
    
  detail: (workspaceId: string, postId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'posts', postId],
      queryFn: () => api.get<Post>(`workspaces/${workspaceId}/posts/${postId}`),
      enabled: !!workspaceId && !!postId,
      refetchInterval: (query: import('@tanstack/react-query').Query<Post, Error>) => {
        const hasActive = query?.state?.data?.variants?.some((v: PostPlatformVariant) => v.status === 'QUEUED' || v.status === 'PUBLISHING' || v.status === 'DELETING');
        return hasActive ? 3000 : false;
      },
    }),
};
