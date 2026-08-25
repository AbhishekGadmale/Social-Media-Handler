import {
  Global,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import {
  PrismaClient,
  UserRepository,
  WorkspaceMemberRepository,
  SocialAccountRepository,
} from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const sessionManager = new SessionManager(redis as any);
const userRepository = new UserRepository(prisma);

const providers: Provider[] = [
  {
    provide: PrismaClient,
    useValue: prisma,
  },
  {
    provide: 'REDIS_CLIENT',
    useValue: redis,
  },
  {
    provide: SessionManager,
    useValue: sessionManager,
  },
  {
    provide: UserRepository,
    useValue: userRepository,
  },
  {
    provide: WorkspaceMemberRepository,
    useValue: new WorkspaceMemberRepository(prisma),
  },
  {
    provide: SocialAccountRepository,
    useValue: new SocialAccountRepository(prisma),
  },
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class CoreModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await prisma.$disconnect();
    redis.disconnect();
  }
}
