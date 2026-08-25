import {
  Global,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';

const prisma = new PrismaClient();

const providers: Provider[] = [
  {
    provide: PrismaClient,
    useValue: prisma,
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
  }
}
