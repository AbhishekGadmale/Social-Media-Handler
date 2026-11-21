
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publishingQueries, PostPlatformVariant, Post } from '../../../../lib/query/publishing';
import { getTargetMediaValidationError } from '../../../../lib/publishing/validation';
import { accountQueries } from '../../../../lib/query/accounts';
import { authQueries } from '../../../../lib/query/auth';
import { canPublish, canApprove, canReconcile } from '../../../../lib/permissions';
import { api, ApiError } from '../../../../lib/api/client';
import { Button } from '../../../../components/ui/button';
import {
  ArrowLeft, Loader2, Save, Play, X, AlertCircle, Calendar
} from 'lucide-react';
import Link from 'next/link';

export default function PostDetailPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const postId = params.postId as string;
  const queryClient = useQueryClient();


  const { data: post, isLoading: postLoading } = useQuery(publishingQueries.detail(workspaceId, postId));
  const { data: accountsData } = useQuery(accountQueries.list(workspaceId));
  const accounts = accountsData?.accounts || [];

  const { data: authData } = useQuery({
    ...authQueries.me(),
    staleTime: Infinity,
  });
  const currentMembership = authData?.memberships?.find((m) => m.workspaceId === workspaceId);
  const currentRole = currentMembership?.role;
  const isPublisher = canPublish(currentRole);
  const isApprover = canApprove(currentRole);
  const isReconciler = canReconcile(currentRole);

  const [content, setContent] = useState(post?.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [isAddingTarget, setIsAddingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  if (post && content === '' && post.content && !isSaving) {
    setContent(post.content);
  }

  const handleUpdateDraft = async () => {
    try {
      setIsSaving(true);
      setSaveError(null);
      await api.patch(`workspaces/${workspaceId}/posts/${postId}`, {
        content,
      });
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts'] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setSaveError(errorObj.message || 'Failed to update draft');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTarget = async () => {
    if (!selectedAccountId) return;

    const account = accounts.find(a => a.id === selectedAccountId);
    if (!account) return;

    // LinkedIn is now allowed for publishing (text and single image)

    if (account.provider === 'YOUTUBE' && !account.capabilities?.includes('POST_PUBLISH')) {
      setTargetError('MISSING_SCOPE');
      return;
    }

      if (post && post.media) {
        const mediaObjects = post.media.map(m => m.media).filter(Boolean);
        const validationError = getTargetMediaValidationError(mediaObjects, account.provider);
        if (validationError) {
          setTargetError(validationError);
          return;
        }
      }
    try {
      setIsAddingTarget(true);
      setTargetError(null);
      const isYouTube = account.provider === 'YOUTUBE';
      await api.post(`workspaces/${workspaceId}/posts/${postId}/publications`, {
        socialAccountId: selectedAccountId,
        providerOptions: {
          title: content.substring(0, 100),
          ...(isYouTube ? { privacyStatus: 'private' } : {}),
        }
      });
      setSelectedAccountId('');
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts', postId] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setTargetError(errorObj.message || 'Failed to add target');
    } finally {
      setIsAddingTarget(false);
    }
  };

  const handleConnectUpgrade = async () => {
    try {
      await handleUpdateDraft();
      const res = await api.post<{ url: string }>(
        `workspaces/${workspaceId}/oauth/youtube/connect?scopes=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}`
      );
      if (res.url) {
        window.location.href = res.url;
      }
    } catch {
      setTargetError('Failed to initiate permission upgrade.');
    }
  };

  if (postLoading) return <div className="p-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" /></div>;
  if (!post) return <div className="p-8">Post not found</div>;

  const isEditable = !post.variants.some(v => v.status === 'QUEUED' || v.status === 'PUBLISHING');

  return (
    <div className="p-8 max-w-5xl mx-auto flex flex-col md:flex-row gap-8">
      <div className="flex-1 space-y-6">
        <div className="mb-6 flex items-center">
          <Link href={`/${workspaceId}/publishing`} className="text-gray-500 hover:text-gray-900 mr-4">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Edit Publication</h1>
        </div>

        <div className="bg-white shadow sm:rounded-lg p-6 border border-gray-200">
          <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">
            Content
          </label>
          <textarea
            id="content"
            rows={8}
            className="w-full rounded-md border border-gray-300 shadow-sm p-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!isEditable || !isPublisher}
          />
          {saveError && <p className="text-red-600 text-sm mt-2">{saveError}</p>}
          {isPublisher && (
            <div className="flex justify-end pt-4 mt-2">
              <Button onClick={handleUpdateDraft} disabled={isSaving || !isEditable || content === post.content}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          )}
        </div>

        {post.media.length > 0 && (
          <div className="bg-gray-50 shadow sm:rounded-lg p-6 border border-gray-200">
            <h3 className="text-md font-medium text-gray-900 mb-4">Attached Media</h3>
            {post.media.map(m => {
              if (!m.media) {
                return (
                  <div key={m.id} className="flex items-center space-x-3 p-3 bg-red-50 text-red-700 rounded border border-red-200">
                    <p className="text-sm">Media record missing</p>
                  </div>
                );
              }
              const isVideo = m.media.mimeType.startsWith('video/');
              const isImage = m.media.mimeType.startsWith('image/');
              const mediaUrl = m.media.storageKey ? `http://localhost:9000/agency-os-media/${m.media.storageKey}` : '';

              return (
                <div key={m.id} className="flex flex-col space-y-2 p-3 bg-white rounded border">
                  <div className="text-sm">
                    <p className="font-medium">{m.media.mimeType}</p>
                    <p className="text-gray-500 text-xs">Status: {m.media.status}</p>
                  </div>
                  {isVideo && mediaUrl && (
                    <video src={mediaUrl} controls className="w-full max-w-sm rounded" />
                  )}
                  {isImage && mediaUrl && (
                    <img src={mediaUrl} alt="Preview" className="w-full max-w-sm rounded object-contain" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="w-full md:w-96 space-y-6">
        <ApprovalCard post={post} workspaceId={workspaceId} canApprove={isApprover} canPublish={isPublisher} />

        <div className="bg-white shadow sm:rounded-lg p-6 border border-gray-200">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Destinations</h2>

          <div className="space-y-4 mb-6">
            {post.variants.map(variant => (
              <TargetCard key={variant.id} variant={variant} workspaceId={workspaceId} post={post} canPublish={isPublisher} canReconcile={isReconciler} />
            ))}
            {post.variants.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No destinations added yet.</p>}
          </div>

          {isEditable && isPublisher && (
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Add Destination</label>
              <div className="flex gap-2">
                <select
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md border"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                >
                  <option value="">Select Account...</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name} ({acc.provider})</option>
                  ))}
                </select>
                <Button onClick={handleAddTarget} disabled={!selectedAccountId || isAddingTarget}>
                  {isAddingTarget ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusIcon />}
                </Button>
              </div>

              {targetError === 'MISSING_SCOPE' ? (
                <div className="mt-3 p-3 bg-yellow-50 text-yellow-800 text-sm rounded-md">
                  <p className="mb-2">Publishing requires additional permission.</p>
                  <Button size="sm" onClick={() => handleConnectUpgrade()}>Enable YouTube publishing access</Button>
                </div>
              ) : targetError ? (
                <p className="text-red-600 text-sm mt-2">{targetError}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  post,
  workspaceId,
  canApprove = true,
  canPublish = true,
}: {
  post: Post;
  workspaceId: string;
  canApprove?: boolean;
  canPublish?: boolean;
}) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChangesInput, setShowChangesInput] = useState(false);
  const [comment, setComment] = useState('');

  const status = post.approvalStatus || 'NOT_SUBMITTED';

  const handleRequestApproval = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await api.post(`workspaces/${workspaceId}/posts/${post.id}/request-approval`, {});
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts'] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setError(errorObj.message || 'Failed to submit post for approval');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await api.post(`workspaces/${workspaceId}/posts/${post.id}/approve`, {});
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts'] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setError(errorObj.message || 'Failed to approve post');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!comment.trim()) return;
    try {
      setIsSubmitting(true);
      setError(null);
      await api.post(`workspaces/${workspaceId}/posts/${post.id}/request-changes`, {
        comment: comment.trim(),
      });
      setShowChangesInput(false);
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts'] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      setError(errorObj.message || 'Failed to request changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white shadow sm:rounded-lg p-6 border border-gray-200" data-testid="approval-card">
      <h2 className="text-lg font-bold text-gray-900 mb-3">Client Approval</h2>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">Status</span>
        {status === 'NOT_SUBMITTED' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800" data-testid="approval-status-badge">
            Not Submitted
          </span>
        )}
        {status === 'PENDING' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200" data-testid="approval-status-badge">
            Pending Approval
          </span>
        )}
        {status === 'APPROVED' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200" data-testid="approval-status-badge">
            Approved
          </span>
        )}
        {status === 'CHANGES_REQUESTED' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200" data-testid="approval-status-badge">
            Changes Requested
          </span>
        )}
      </div>

      {status === 'CHANGES_REQUESTED' && post.approvalComment && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800" data-testid="approval-comment-box">
          <p className="font-semibold text-xs text-red-900 mb-1">Feedback from Reviewer:</p>
          <p className="whitespace-pre-wrap">{post.approvalComment}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          {error}
        </div>
      )}

      {(status === 'NOT_SUBMITTED' || status === 'CHANGES_REQUESTED') && canPublish && (
        <div className="pt-2">
          <Button
            onClick={handleRequestApproval}
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="request-approval-button"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Send for Approval
          </Button>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Notifies workspace approvers to review this post.
          </p>
        </div>
      )}

      {status === 'PENDING' && canApprove && !showChangesInput && (
        <div className="pt-2 space-y-2">
          <Button
            onClick={handleApprove}
            disabled={isSubmitting}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            data-testid="approve-post-button"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Approve Post
          </Button>
          <Button
            onClick={() => setShowChangesInput(true)}
            disabled={isSubmitting}
            variant="outline"
            className="w-full border-red-300 text-red-700 hover:bg-red-50"
            data-testid="request-changes-toggle-button"
          >
            Request Changes
          </Button>
        </div>
      )}

      {status === 'PENDING' && canApprove && showChangesInput && (
        <div className="pt-2 space-y-2" data-testid="request-changes-form">
          <label className="block text-xs font-medium text-gray-700">
            Change Request Feedback (required)
          </label>
          <textarea
            rows={3}
            className="w-full rounded-md border border-gray-300 shadow-sm p-2 text-xs focus:border-red-500 focus:ring-red-500"
            placeholder="Explain what changes are needed..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            data-testid="request-changes-comment-input"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleRequestChanges}
              disabled={isSubmitting || !comment.trim()}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              data-testid="submit-request-changes-button"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Submit Changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowChangesInput(false);
                setComment('');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status === 'APPROVED' && (
        <div className="pt-2">
          <p className="text-xs text-green-700 bg-green-50 p-2 rounded border border-green-200 text-center">
            This post has been approved and is ready to publish or schedule.
          </p>
        </div>
      )}
    </div>
  );
}

export const YOUTUBE_CATEGORIES = [
  { id: '1', name: 'Film & Animation' },
  { id: '2', name: 'Autos & Vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets & Animals' },
  { id: '17', name: 'Sports' },
  { id: '19', name: 'Travel & Events' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News & Politics' },
  { id: '26', name: 'Howto & Style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
];

const getValidYouTubeCategoryId = (raw: unknown): string => {
  return typeof raw === 'string' && /^\d+$/.test(raw) ? raw : '';
};

function PlusIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
}

function TargetCard({
  variant,
  workspaceId,
  post,
  canPublish = true,
  canReconcile = true,
}: {
  variant: PostPlatformVariant;
  workspaceId: string;
  post: Post;
  canPublish?: boolean;
  canReconcile?: boolean;
}) {
  const mediaObjects = post.media.map(m => m.media).filter(Boolean);
  const validationError = variant.socialAccount?.provider ? getTargetMediaValidationError(mediaObjects, variant.socialAccount.provider) : null;
  const queryClient = useQueryClient();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isActioning, setIsActioning] = useState(false);

  const [title, setTitle] = useState(variant.providerOptions?.title as string || '');
  const [privacyStatus, setPrivacyStatus] = useState(variant.providerOptions?.privacyStatus as string || 'private');
  const [categoryId, setCategoryId] = useState(getValidYouTubeCategoryId(variant.providerOptions?.categoryId));
  const [tags, setTags] = useState<string>(Array.isArray(variant.providerOptions?.tags) ? variant.providerOptions.tags.join(', ') : '');

  const [prevOptions, setPrevOptions] = useState(variant.providerOptions);
  if (variant.providerOptions !== prevOptions) {
    setPrevOptions(variant.providerOptions);
    setTitle(variant.providerOptions?.title as string || '');
    setPrivacyStatus(variant.providerOptions?.privacyStatus as string || 'private');
    setCategoryId(getValidYouTubeCategoryId(variant.providerOptions?.categoryId));
    setTags(Array.isArray(variant.providerOptions?.tags) ? variant.providerOptions.tags.join(', ') : '');
  }

  const [scheduleDate, setScheduleDate] = useState<string>('');

  const [isDeleting, setIsDeleting] = useState(false);

  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileReason, setReconcileReason] = useState('');
  const [reconcileExternalId, setReconcileExternalId] = useState('');
  const [reconcileUrl, setReconcileUrl] = useState('');
  const [reconcileOutcome, setReconcileOutcome] = useState<'CONFIRM_PUBLISHED' | 'CONFIRM_FAILED' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = async (action: 'publish' | 'schedule' | 'cancel' | 'retry' | 'unschedule' | 'reschedule' | 'reconcile' | 'remote', payload?: unknown, method: 'POST' | 'DELETE' = 'POST') => {
    try {
      setIsActioning(true);
      setActionError(null);
      if (method === 'DELETE') { await api.delete(`workspaces/${workspaceId}/publications/${variant.id}/${action}`); } else { await api.post(`workspaces/${workspaceId}/publications/${variant.id}/${action}`, payload); }
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts', variant.postId] });
      setIsPublishing(false);
      setIsReconciling(false);
    } catch (err: unknown) {
      let msg = 'An unknown error occurred.';
      if (err instanceof ApiError) {
        if (action === 'reconcile') {
          if (err.status === 403) msg = 'You do not have permission to reconcile publications.';
          else if (err.status === 409) { msg = 'Publication state has changed. Please refresh the page.'; queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts', variant.postId] }); }
          else if (err.status === 422) msg = 'Invalid data provided. Please check the fields and try again.';
          else if (err.status === 500) msg = 'An internal system error occurred. Please try again later.';
          else msg = err.message || 'Reconciliation failed.';
        } else {
          msg = err.message || 'Action failed.';
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setActionError(msg);
    } finally {
      setIsActioning(false);
    }
  };

  const handleUpdate = async (overrides?: Record<string, unknown>) => {
    try {
      setIsActioning(true);
      const isYouTube = variant.socialAccount?.provider === 'YOUTUBE';
      const updatedOptions: Record<string, unknown> = {
        ...(variant.providerOptions || {}),
        title,
        ...(isYouTube ? { privacyStatus } : {}),
        ...overrides
      };

      if (isYouTube) {
        const cat = overrides && 'categoryId' in overrides ? overrides.categoryId as string : categoryId;
        const validCat = getValidYouTubeCategoryId(cat);
        if (validCat) {
          updatedOptions.categoryId = validCat;
        } else {
          delete updatedOptions.categoryId;
        }

        const tagsStr = overrides && 'tags' in overrides ? overrides.tags as string : tags;
        const tagsArray = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
        if (tagsArray.length > 0) {
          updatedOptions.tags = tagsArray;
        } else {
          delete updatedOptions.tags;
        }
      }

      await api.patch(`workspaces/${workspaceId}/publications/${variant.id}`, {
        providerOptions: updatedOptions
      });
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'posts', variant.postId] });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      alert(errorObj.message);
    } finally {
      setIsActioning(false);
    }
  };

  const isEditable = variant.status === 'DRAFT' || variant.status === 'SCHEDULED' || variant.status === 'FAILED';

  return (
    <div className="border rounded-md p-4 bg-gray-50 relative">
      <div className="flex justify-between items-center mb-3">
        <span className="font-semibold text-sm capitalize">{variant.socialAccount?.name || 'Unknown'}</span>
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          variant.status === 'PUBLISHED' ? 'bg-green-200 text-green-800' :
          variant.status === 'FAILED' ? 'bg-red-200 text-red-800' :
          variant.status === 'QUEUED' || variant.status === 'PUBLISHING' ? 'bg-blue-200 text-blue-800 animate-pulse' :
          variant.status === 'DELETING' ? 'bg-orange-200 text-orange-800 animate-pulse' :
          variant.status === 'DELETED' ? 'bg-gray-100 text-gray-500 line-through' :
          variant.status === 'UNKNOWN' ? 'bg-yellow-200 text-yellow-800' :
          'bg-gray-200 text-gray-700'
        }`}>
          {variant.status === 'UNKNOWN' ? 'Needs review (UNKNOWN)' : variant.status}
        </span>
      </div>

      {actionError && (
        <div className="mb-3 p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200">
          {actionError}
        </div>
      )}

      {variant.status === 'UNKNOWN' && (
        <div className="mb-3 p-2 bg-gray-100 text-gray-700 text-xs rounded flex flex-col items-start gap-2">
          <div className="flex items-start">
            <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
            <span>Publishing result could not be confirmed. Check the destination platform before taking further action.</span>
          </div>
          {canReconcile && (
            <Button size="sm" variant="outline" onClick={() => setIsReconciling(true)}>
              Resolve publication
            </Button>
          )}
        </div>
      )}

      {validationError && isEditable && (
        <div className="mb-3 p-2 bg-red-50 text-red-700 text-xs rounded flex flex-col items-start gap-2">
          <div className="flex items-start">
            <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
            <span>{validationError}</span>
          </div>
        </div>
      )}

      {variant.status === 'FAILED' && (
        <div className="mb-3 p-2 bg-red-50 text-red-700 text-xs rounded">
          <p className="font-semibold">Publishing failed</p>
          <p>Please check your settings and try again.</p>
        </div>
      )}

      {isEditable && canPublish && (
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700">Title</label>
            <input
              type="text"
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
              value={title as string}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => handleUpdate()}
            />
          </div>
          {variant.socialAccount?.provider === 'YOUTUBE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700">Privacy Status</label>
              <select
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                value={privacyStatus as string}
                onChange={e => {
                  setPrivacyStatus(e.target.value);
                  handleUpdate({ privacyStatus: e.target.value });
                }}
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </div>
          )}

          {variant.socialAccount?.provider === 'YOUTUBE' && (
            <>
              <div>
                <label htmlFor={`category-${variant.id}`} className="block text-xs font-medium text-gray-700">Category</label>
                <select
                  id={`category-${variant.id}`}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                  value={categoryId}
                  onChange={e => {
                    const newCat = e.target.value;
                    setCategoryId(newCat);
                    handleUpdate({ categoryId: newCat });
                  }}
                >
                  <option value="">No category</option>
                  {YOUTUBE_CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Tags</label>
                <input
                  type="text"
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  onBlur={() => handleUpdate()}
                  placeholder="e.g. tag1, tag2, tag3"
                />
                <p className="text-[10px] text-gray-500 mt-1">Separate multiple tags with commas.</p>
              </div>
            </>
          )}
        </div>
      )}

      {(post.approvalStatus === 'PENDING' || post.approvalStatus === 'CHANGES_REQUESTED') && (
        <div className="mt-3 p-2 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200" data-testid="approval-gate-notice">
          {post.approvalStatus === 'PENDING'
            ? 'Post is pending approval. It cannot be published or scheduled until approved.'
            : 'Changes were requested. Edit and resubmit for approval before publishing.'}
        </div>
      )}

      {canPublish ? (
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-200">
          {(variant.status === 'DRAFT' || variant.status === 'FAILED' || variant.status === 'SCHEDULED') ? (
            <Button
              size="sm"
              onClick={() => setIsPublishing(true)}
              disabled={isActioning || !!validationError || post.approvalStatus === 'PENDING' || post.approvalStatus === 'CHANGES_REQUESTED'}
            >
              <Play className="w-3 h-3 mr-1" /> {variant.status === 'FAILED' ? 'Retry' : (variant.status === 'SCHEDULED' ? 'Publish Now' : 'Publish')}
            </Button>
          ) : null}

          {(variant.status === 'DRAFT' || variant.status === 'FAILED') ? (
            <div className="flex items-center gap-1">
              <input type="datetime-local" className="text-xs border p-1 rounded" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction('schedule', { scheduledAt: new Date(scheduleDate).toISOString() })}
                disabled={!scheduleDate || isActioning || !!validationError || post.approvalStatus === 'PENDING' || post.approvalStatus === 'CHANGES_REQUESTED'}
              >
                <Calendar className="w-3 h-3 mr-1" /> Schedule
              </Button>
            </div>
          ) : null}

          {variant.status === 'SCHEDULED' && (
            <div className="flex items-center gap-1">
              <input type="datetime-local" className="text-xs border p-1 rounded" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction('reschedule', { scheduledAt: new Date(scheduleDate).toISOString() })}
                disabled={!scheduleDate || isActioning || post.approvalStatus === 'PENDING' || post.approvalStatus === 'CHANGES_REQUESTED'}
              >
                <Calendar className="w-3 h-3 mr-1" /> Reschedule
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAction('unschedule')} disabled={isActioning}>
                <X className="w-3 h-3 mr-1" /> Unschedule
              </Button>
            </div>
          )}

          {variant.status === 'QUEUED' && (
            <Button variant="outline" size="sm" onClick={() => handleAction('cancel')} disabled={isActioning}>
              <X className="w-3 h-3 mr-1" /> Cancel publishing
            </Button>
          )}

          {variant.status === 'PUBLISHED' && (
            <>
              {variant.canonicalUrl && (
                <a href={variant.canonicalUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center">
                  View on {variant.socialAccount?.provider || 'Platform'}
                </a>
              )}
              {variant.externalPostId && (
                <Button variant="outline" size="sm" onClick={() => setIsDeleting(true)} disabled={isActioning}>
                  <X className="w-3 h-3 mr-1" /> Delete Post
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        variant.status === 'PUBLISHED' && variant.canonicalUrl ? (
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-200">
            <a href={variant.canonicalUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center">
              View on {variant.socialAccount?.provider || 'Platform'}
            </a>
          </div>
        ) : null
      )}


      {isDeleting && (
        <div
          role="alertdialog"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-desc"
          className="absolute inset-0 bg-white bg-opacity-95 p-4 flex flex-col justify-center items-center z-10 rounded-md text-center border-2 border-red-500"
        >
          <p id="delete-dialog-title" className="font-bold mb-2 text-red-600">Delete from {variant.socialAccount?.provider || 'Platform'}?</p>
          <div id="delete-dialog-desc" className="text-xs text-gray-700 mb-4 text-left">
            <p>- Post will be removed externally.</p>
            <p>- Local publishing history remains.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setIsDeleting(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => { setIsDeleting(false); handleAction('remote', undefined, 'DELETE'); }}>Confirm Delete</Button>
          </div>
        </div>
      )}

      {isPublishing && (
        <div className="absolute inset-0 bg-white bg-opacity-95 p-4 flex flex-col justify-center items-center z-10 rounded-md text-center border-2 border-blue-500">
          <p className="font-bold mb-2">Publish Immediately?</p>
          <p className="text-xs text-gray-500 mb-4">This will send the post to {variant.socialAccount?.name} as {privacyStatus as string}.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setIsPublishing(false)}>Cancel</Button>
            <Button size="sm" onClick={() => handleAction('publish')}>Confirm Publish</Button>
          </div>
        </div>
      )}

      {isReconciling && (
        <div className="absolute inset-0 bg-white bg-opacity-95 p-4 flex flex-col justify-center items-center z-10 rounded-md text-center border-2 border-yellow-500">
          {!reconcileOutcome ? (
            <>
              <p className="font-bold mb-2">Have you independently checked the destination platform?</p>
              <div className="flex flex-col gap-2 mt-4 w-full">
                <Button size="sm" onClick={() => setReconcileOutcome('CONFIRM_PUBLISHED')}>Yes, it was published</Button>
                <Button size="sm" variant="outline" onClick={() => setReconcileOutcome('CONFIRM_FAILED')}>No, it was not published</Button>
                <Button size="sm" variant="ghost" onClick={() => setIsReconciling(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div className="w-full space-y-3 text-left">
              <p className="font-bold text-sm">
                Confirming as {reconcileOutcome === 'CONFIRM_PUBLISHED' ? 'Published' : 'Failed'}
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700">Reason / Note *</label>
                <input
                  type="text"
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                  value={reconcileReason as string}
                  onChange={e => setReconcileReason(e.target.value)}
                  placeholder="e.g. Verified video exists"
                />
              </div>
              {reconcileOutcome === 'CONFIRM_PUBLISHED' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">External Post ID *</label>
                    <input
                      type="text"
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                      value={reconcileExternalId as string}
                      onChange={e => setReconcileExternalId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Canonical URL (Optional)</label>
                    <input
                      type="text"
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm border p-1"
                      value={reconcileUrl as string}
                      onChange={e => setReconcileUrl(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="flex justify-between pt-2">
                <Button size="sm" variant="ghost" onClick={() => setReconcileOutcome(null)}>Back</Button>
                <Button
                  size="sm"
                  disabled={isActioning || !reconcileReason.trim() || (reconcileOutcome === 'CONFIRM_PUBLISHED' && !reconcileExternalId.trim())}
                  onClick={() => {
                    const payload: Record<string, string> = {
                      decision: reconcileOutcome,
                      reason: reconcileReason.trim(),
                    };
                    if (reconcileOutcome === 'CONFIRM_PUBLISHED') {
                      payload.externalPostId = reconcileExternalId.trim();
                      if (reconcileUrl.trim()) {
                        payload.canonicalUrl = reconcileUrl.trim();
                      }
                    }
                    handleAction('reconcile', payload);
                  }}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

