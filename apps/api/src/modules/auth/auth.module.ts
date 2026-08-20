import { Module } from '@nestjs/common';
import { AuthController, WorkspaceTestController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, WorkspaceTestController],
  providers: [AuthService],
})
export class AuthModule {}
