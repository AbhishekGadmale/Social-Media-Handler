import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export interface WorkspaceBranding {
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
}

export interface UpdateBrandingPayload {
  brandDisplayName?: string;
  brandLogoUrl?: string;
  brandAccentColor?: string;
}

export const reportsQueries = {
  branding: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'reports', 'branding'],
      queryFn: () =>
        api.get<WorkspaceBranding>(`workspaces/${workspaceId}/reports/branding`),
      enabled: !!workspaceId,
    }),
};

export async function downloadClientReportPdf(
  workspaceId: string,
  from: string,
  to: string,
  socialAccountId?: string
): Promise<void> {
  const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const url = new URL(`${baseURL}/workspaces/${workspaceId}/reports/client-report`);
  url.searchParams.append('from', from);
  url.searchParams.append('to', to);
  if (socialAccountId) {
    url.searchParams.append('socialAccountId', socialAccountId);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    let message = 'Failed to generate client report.';
    try {
      const json = await res.json();
      message = json.message || json.error?.message || message;
    } catch {
      message = res.statusText || message;
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `client-report-${workspaceId}-${from}-${to}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(objectUrl);
}
