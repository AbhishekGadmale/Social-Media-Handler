'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '../../../../components/ui/button';
import { MediaUploader } from '../../../../components/media-uploader';
import { api } from '../../../../lib/api/client';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { Post } from '../../../../lib/query/publishing';
import { useQueryClient } from '@tanstack/react-query';

export default function NewDraftPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUploadsChange = useCallback((ids: string[]) => {
    setMediaAssetIds(ids);
  }, []);

  const handleUploadingStateChange = useCallback((state: boolean) => {
    setIsUploading(state);
  }, []);

  const handleSaveDraft = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const post = await api.post<Post>(`workspaces/${workspaceId}/posts`, {
        content,
        mediaIds: mediaAssetIds.length > 0 ? mediaAssetIds : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts'] });
      router.push(`/${workspaceId}/publishing/${post.id}`);
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setError(errorObj.message || 'Failed to save draft');
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center">
        <Link href={`/${workspaceId}/publishing`} className="text-gray-500 hover:text-gray-900 mr-4">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Draft</h1>
          <p className="mt-1 text-sm text-gray-600">
            Start composing your next publication.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg p-6 border border-gray-200">
          <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">
            Content
          </label>
          <textarea
            id="content"
            rows={6}
            className="w-full rounded-md border border-gray-300 shadow-sm p-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="What do you want to share?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div>
          <MediaUploader 
            workspaceId={workspaceId} 
            onUploadsChange={handleUploadsChange}
            onUploadingStateChange={handleUploadingStateChange}
          />
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t items-center">
          {isUploading && <span className="text-sm text-gray-500 mr-4">Wait for uploads to complete...</span>}
          <Button onClick={handleSaveDraft} disabled={isSaving || isUploading || (!content && mediaAssetIds.length === 0)}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Draft
          </Button>
        </div>
      </div>
    </div>
  );
}
