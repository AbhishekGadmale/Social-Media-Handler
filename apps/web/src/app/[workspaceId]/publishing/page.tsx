
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { publishingQueries, PostStatus } from '../../../lib/query/publishing';
import { Button } from '../../../components/ui/button';
import { Plus, Clock, CheckCircle2, AlertCircle, FileText, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';

function StatusBadge({ status }: { status: PostStatus }) {
  switch (status) {
    case 'PUBLISHED':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" /> Published</span>;
    case 'QUEUED':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" /> Waiting to publish</span>;
    case 'PUBLISHING':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Publishing</span>;
    case 'SCHEDULED':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" /> Scheduled</span>;
    case 'FAILED':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" /> Failed</span>;
    case 'UNKNOWN':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"><AlertCircle className="w-3 h-3 mr-1" /> Unknown</span>;
    case 'DRAFT':
    default:
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"><FileText className="w-3 h-3 mr-1" /> Draft</span>;
  }
}

export default function PublishingPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const router = useRouter();

  const { data: posts = [], isLoading, isError } = useQuery(publishingQueries.list(workspaceId));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Publishing</h1>
          <p className="mt-2 text-sm text-gray-600">
            Create, schedule, and manage your social media publications.
          </p>
        </div>
        
        <div>
          <Button onClick={() => router.push(`/${workspaceId}/publishing/new`)}>
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            New Post
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border rounded-lg h-24" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700">Failed to load publications.</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Send className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No publications yet</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-sm mb-6">
            Get started by creating your first post.
          </p>
          <Button onClick={() => router.push(`/${workspaceId}/publishing/new`)}>
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            New Post
          </Button>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {posts.map((post) => {
              let displayStatus: PostStatus = 'DRAFT';
              let targetProvider = null;
              if (post.variants && post.variants.length > 0) {
                const statuses = post.variants.map(v => v.status);
                if (statuses.includes('PUBLISHING')) displayStatus = 'PUBLISHING';
                else if (statuses.includes('QUEUED')) displayStatus = 'QUEUED';
                else if (statuses.includes('FAILED')) displayStatus = 'FAILED';
                else if (statuses.includes('UNKNOWN')) displayStatus = 'UNKNOWN';
                else if (statuses.includes('SCHEDULED')) displayStatus = 'SCHEDULED';
                else if (statuses.includes('PUBLISHED')) displayStatus = 'PUBLISHED';
                
                targetProvider = post.variants[0].socialAccount?.provider || null;
              }
              
              const title = post.content 
                ? (post.content.length > 60 ? post.content.substring(0, 60) + '...' : post.content)
                : 'Untitled Post';

              return (
                <li key={post.id}>
                  <Link href={`/${workspaceId}/publishing/${post.id}`} className="block hover:bg-gray-50 transition-colors">
                    <div className="px-4 py-4 sm:px-6 flex items-center justify-between">
                      <div className="min-w-0 flex-1 flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-blue-600 truncate">{title}</p>
                          <div className="ml-2 flex-shrink-0 flex">
                            <StatusBadge status={displayStatus} />
                          </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex">
                            <p className="flex items-center text-sm text-gray-500">
                              {post.media?.length > 0 ? (
                                <span className="mr-3 flex items-center">
                                  <FileText className="w-4 h-4 mr-1 text-gray-400" />
                                  1 Media
                                </span>
                              ) : null}
                              {targetProvider ? (
                                <span className="mr-3 flex items-center capitalize">
                                  Target: {targetProvider.toLowerCase()}
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                            <p>
                              Last updated: {new Date(post.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
