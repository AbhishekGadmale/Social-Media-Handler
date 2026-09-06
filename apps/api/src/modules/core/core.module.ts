import {
  Global,
  Module,
  OnApplicationShutdown,
  Provider,
  Inject,
} from '@nestjs/common';
import {
  PrismaClient,
  UserRepository,
  WorkspaceMemberRepository,
  SocialAccountRepository,
  AuditLogRepository,
} from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import Redis from 'ioredis';
import { AuditService } from './audit.service';

const providers: Provider[] = [
  {
    provide: PrismaClient,
    useFactory: () => new PrismaClient(),
  },
  {
    provide: 'REDIS_CLIENT',
    useFactory: () =>
      new Redis(process.env.REDIS_URL || 'redis://localhost:6379'),
  },
  {
    provide: SessionManager,
    useFactory: (redis: Redis) => new SessionManager(redis as any),
    inject: ['REDIS_CLIENT'],
  },
  {
    provide: UserRepository,
    useFactory: (prisma: PrismaClient) => new UserRepository(prisma),
    inject: [PrismaClient],
  },
  {
    provide: WorkspaceMemberRepository,
    useFactory: (prisma: PrismaClient) => new WorkspaceMemberRepository(prisma),
    inject: [PrismaClient],
  },
  {
    provide: SocialAccountRepository,
    useFactory: (prisma: PrismaClient) => new SocialAccountRepository(prisma),
    inject: [PrismaClient],
  },
  {
    provide: AuditLogRepository,
    useFactory: (prisma: PrismaClient) => new AuditLogRepository(prisma),
    inject: [PrismaClient],
  },
  AuditService,
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class CoreModule implements OnApplicationShutdown {
  constructor(
    private readonly prisma: PrismaClient,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}
