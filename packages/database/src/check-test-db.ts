import { URL } from 'url';

export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('SAFETY CHECK FAILED: Database URL is missing.');
  }
  
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SAFETY CHECK FAILED: Database URL is unparsable.');
  }

  const dbName = parsedUrl.pathname.slice(1); // Remove leading slash

  if (dbName === 'agency_os') {
    throw new Error('SAFETY CHECK FAILED: agency_os explicitly rejected for destructive test operations.');
  }

  if (dbName !== 'agency_os_test' && dbName !== 'agency_os_remote_execution_test') {
    throw new Error(`SAFETY CHECK FAILED: Destructive test operations must target exact database agency_os_test, got: ${dbName}`);
  }

  return url;
}
