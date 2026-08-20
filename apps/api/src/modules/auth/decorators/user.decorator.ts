import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@agency-os/database';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<import('express').Request>();
    return request.user as User;
  },
);
