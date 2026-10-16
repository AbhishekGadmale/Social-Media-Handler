import {
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  Optional,
  Provider,
} from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';
import Redis from 'ioredis';

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
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class CoreModule implements OnApplicationShutdown {
  constructor(
    private readonly prisma: PrismaClient,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
    if (this.redis) {
      await this.redis.quit().catch(() => {});
    }
  }
}
