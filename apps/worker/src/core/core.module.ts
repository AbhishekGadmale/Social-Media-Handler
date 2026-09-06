import {
  Global,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';

const providers: Provider[] = [
  {
    provide: PrismaClient,
    useFactory: () => new PrismaClient(),
  },
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class CoreModule implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}
