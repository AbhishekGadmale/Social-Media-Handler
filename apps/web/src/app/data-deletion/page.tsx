'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function DataDeletionContent() {
  const searchParams = useSearchParams();
  const codeParam = searchParams.get('code')?.trim();

  const [lookupCode, setLookupCode] = useState('');
  const [activeCode, setActiveCode] = useState(codeParam || '');

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (lookupCode.trim()) {
      setActiveCode(lookupCode.trim());
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow space-y-6 text-gray-800 leading-relaxed">
        <div className="border-b border-gray-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Agency OS — User Data Deletion Instructions
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated: 24 November 2026. In compliance with the Meta Platform Terms, Developer Policies, and the Digital Personal Data Protection Act (DPDP).
          </p>
        </div>

        {activeCode && (
          <div
            data-testid="status-banner"
            className="p-4 rounded-md bg-green-50 border border-green-200 text-green-900 space-y-2"
          >
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Status: Completed
              </span>
              <span className="font-semibold text-sm">
                Data Deletion Request Processed
              </span>
            </div>
            <p className="text-sm">
              Confirmation Code:{' '}
              <code className="font-mono bg-white px-2 py-0.5 rounded border border-green-300 font-bold text-green-950">
                {activeCode}
              </code>
            </p>
            <p className="text-sm text-green-800">
              Your data deletion request has been processed. All associated Meta OAuth access tokens, connected account credentials, cached platform analytics, and pending scheduled post variants have been permanently removed from Agency OS servers.
            </p>
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">
            1. Overview
          </h2>
          <p>
            Agency OS respects your data privacy. Under Meta&apos;s Platform Policy, users who connect Facebook or Instagram accounts to Agency OS have the right to request the permanent deletion of their Platform Data at any time. When you remove Agency OS from your Facebook or Instagram account, an automated data-deletion request is initiated.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">
            2. How to Request Data Deletion via Meta (Facebook / Instagram)
          </h2>
          <p>
            You can delete your stored data by removing Agency OS from your Meta account through Facebook&apos;s application management settings:
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-gray-700">
            <li>
              Log in to your Facebook account and go to <strong>Settings &amp; Privacy &gt; Settings</strong>.
            </li>
            <li>
              In the left navigation menu, scroll down and click <strong>Apps and Websites</strong>.
            </li>
            <li>
              Locate <strong>Agency OS</strong> in the list of connected applications.
            </li>
            <li>
              Click the <strong>Remove</strong> button next to Agency OS.
            </li>
            <li>
              (Optional) Select the checkbox to remove posts, videos, or events Agency OS may have published on your behalf, then confirm by clicking <strong>Remove</strong>.
            </li>
            <li>
              Meta automatically dispatches an authenticated, signed data-deletion callback (<code>signed_request</code>) to our secure callback endpoint.
            </li>
            <li>
              Our backend verifies the cryptographic HMAC-SHA256 signature using our Meta application secret, immediately performs the permanent deletion, and returns a confirmation code and status tracking URL.
            </li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">
            3. Scope of Data Deleted
          </h2>
          <p>
            Upon receipt of a verified deletion callback or manual deletion request, Agency OS permanently deletes or purges the following data categories for the requesting Meta user:
          </p>
          <div className="overflow-x-auto my-4">
            <table className="min-w-full divide-y divide-gray-200 border text-sm text-left">
              <thead className="bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <th className="px-4 py-2 border">Data Category</th>
                  <th className="px-4 py-2 border">Database Entity</th>
                  <th className="px-4 py-2 border">Deletion Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-2 border font-medium">OAuth Credentials &amp; Tokens</td>
                  <td className="px-4 py-2 border"><code>SocialConnection</code></td>
                  <td className="px-4 py-2 border">Encrypted access tokens, refresh tokens, initialization vectors (IVs), and authentication tags are zeroed out and purged immediately.</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Connected Social Accounts</td>
                  <td className="px-4 py-2 border"><code>SocialAccount</code></td>
                  <td className="px-4 py-2 border">The Facebook Page or Instagram Business Account records matching the Meta User ID are deleted permanently.</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Cached Analytics &amp; Metrics</td>
                  <td className="px-4 py-2 border"><code>AccountMetricDaily</code></td>
                  <td className="px-4 py-2 border">All historical daily follower counts, engagement stats, and cached platform metrics are deleted permanently.</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Pending Scheduled Posts</td>
                  <td className="px-4 py-2 border"><code>PostPlatformVariant</code></td>
                  <td className="px-4 py-2 border">All scheduled, queued, or draft platform variants linked to the deleted Meta account are cancelled and removed.</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Previously Published Content</td>
                  <td className="px-4 py-2 border">External Social Platform</td>
                  <td className="px-4 py-2 border">Content already published live to Facebook or Instagram is hosted on Meta&apos;s servers; per Privacy Policy §7.1, it must be deleted directly on Facebook or Instagram.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">
            4. Check Deletion Status
          </h2>
          <p>
            If you received a confirmation code from Meta or our status URL, enter it below to confirm that your data deletion request has completed:
          </p>
          <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3 max-w-md pt-2">
            <input
              type="text"
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value)}
              placeholder="e.g. del_abc123..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Confirmation code"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              Check Status
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">
            5. Manual Deletion Requests &amp; Contact
          </h2>
          <p>
            You may also request data deletion manually at any time without going through Facebook:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              <strong>Direct Disconnect:</strong> In the Agency OS web dashboard, go to <strong>Settings &gt; Connected Accounts</strong> and click <strong>Disconnect</strong> next to your Meta account. This immediately wipes stored tokens and revokes access.
            </li>
            <li>
              <strong>Email Request:</strong> Contact our Grievance and Data Protection Officer, <strong>Abhishek Gadmale</strong>, at{' '}
              <a href="mailto:agadmale335@gmail.com" className="text-blue-600 underline hover:text-blue-800">
                agadmale335@gmail.com
              </a>
              . Please include your workspace name and Meta User/Page ID. We acknowledge requests within 48 hours and complete data erasure within 30 calendar days.
            </li>
          </ul>
        </section>

        <div className="border-t border-gray-200 pt-6 flex flex-wrap gap-4 text-sm text-gray-600">
          <Link href="/privacy" className="hover:text-gray-900 underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-gray-900 underline">
            Terms of Service
          </Link>
          <Link href="/refund-cancellation" className="hover:text-gray-900 underline">
            Refund &amp; Cancellation Policy
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function DataDeletionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-gray-600 text-sm">Loading instructions...</div>
        </div>
      }
    >
      <DataDeletionContent />
    </Suspense>
  );
}
