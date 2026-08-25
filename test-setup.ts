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

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  throw new Error(`TEST_DATABASE_URL is not set in root .env. Loaded from: ${envPath}`);
}

if (!process.env.DATABASE_URL.includes('test')) {
  throw new Error('DATABASE_URL does not contain test substring');
}
