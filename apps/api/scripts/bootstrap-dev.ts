import { PrismaClient } from '@agency-os/database';
import { generateId } from '@agency-os/database';
import * as argon2 from '@node-rs/argon2';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function promptInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptPassword(email: string): Promise<string> {
  if (process.env.BOOTSTRAP_PASSWORD) {
    return process.env.BOOTSTRAP_PASSWORD;
  }
  return new Promise((resolve) => {
    process.stdout.write(`Enter password for ${email}: `);
    let password = '';
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');
    
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
      stdin.on('data', function handler(ch: string) {
        switch (ch) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdout.write('\n');
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', handler);
            resolve(password);
            break;
          case '\u0003':
            process.stdout.write('\n');
            process.exit(1);
            break;
          case '\b':
          case '\x7f':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += ch;
            process.stdout.write('*');
            break;
        }
      });
    } else {
      stdin.on('data', function handler(chunk: string) {
        password += chunk;
        if (password.includes('\n') || password.includes('\r')) {
          password = password.replace(/\r?\n.*/, '');
          stdin.pause();
          stdin.removeListener('data', handler);
          resolve(password.trim());
        }
      });
      stdin.on('end', () => resolve(password.trim()));
    }
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.includes('agency_os') || url.includes('agency_os_test')) {
    throw new Error('SAFETY CHECK FAILED: MUST TARGET agency_os explicitly.');
  }
  
  if (url.includes('@prod') || !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('postgres:')) {
     throw new Error('SAFETY CHECK FAILED: MUST TARGET LOCALHOST.');
  }

  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  let email = process.env.DEV_BOOTSTRAP_EMAIL;
  if (!email) {
    email = await promptInput('Enter dev email: ');
  }
  if (!email) {
    throw new Error('Email is required.');
  }

  console.log(`Connecting to database: ${url.split('@')[1].split('?')[0]}`);

  const userCount = await prisma.user.count({ where: { email } });
  if (userCount > 0) {
    console.log('User already exists, skipping...');
    return;
  }

  const password = await promptPassword(email);
  if (!password) {
     throw new Error('Password is required.');
  }
  const hashedPassword = await argon2.hash(password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: generateId(),
        email,
        hashedPassword,
      },
    });

    const org = await tx.organization.create({
      data: {
        id: generateId(),
        name: 'Local Dev Org',
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateId(),
        name: 'Local Dev Workspace',
        organizationId: org.id,
      },
    });

    await tx.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });

    console.log('Bootstrap completed safely.');
  });
}

main().catch(console.error).finally(() => {
  rl.close();
  process.exit(0);
});
