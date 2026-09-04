import * as fs from 'fs';
import * as path from 'path';

function findRootEnv(startDir: string) {
  let curr = startDir;
  while (curr !== path.parse(curr).root) {
    const p = path.join(curr, '.env');
    if (fs.existsSync(p)) return p;
    curr = path.dirname(curr);
  }
  return null;
}

const envPath = findRootEnv(__dirname) || findRootEnv(process.cwd());

if (envPath && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"`]|['"`]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(`TEST_DATABASE_URL is not set in root .env. Loaded from: ${envPath}`);
}

const parsedUrl = new URL(process.env.TEST_DATABASE_URL);
const dbName = parsedUrl.pathname.slice(1);

if (dbName === 'agency_os') {
  throw new Error('SAFETY CHECK FAILED: agency_os explicitly rejected for destructive test operations.');
}

if (dbName !== 'agency_os_test') {
  throw new Error(`SAFETY CHECK FAILED: Destructive test operations must target exact database agency_os_test, got: ${dbName}`);
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
