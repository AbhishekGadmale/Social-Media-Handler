import { PrismaClient } from '@prisma/client';

export class WorkspaceScopedRepository<
  Delegate,
  Entity,
  WhereInput,
  CreateInput,
  UpdateInput
> {
  constructor(
    protected prisma: PrismaClient,
    protected modelDelegate: Delegate,
    public readonly workspaceId: string
  ) {}

  
  findById(id: string, args: Record<string, unknown> = {}): Promise<Entity | null> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).findFirst({
      ...args,
      where: {
        id,
        workspaceId: this.workspaceId,
      },
    });
  }
findUnique(args: { where: WhereInput } & Record<string, unknown>): Promise<Entity | null> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).findFirst({
      ...args,
      where: {
        ...args.where,
        workspaceId: this.workspaceId,
      },
    });
  }

  findFirst(args: { where?: WhereInput } & Record<string, unknown>): Promise<Entity | null> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).findFirst({
      ...args,
      where: {
        ...args.where,
        workspaceId: this.workspaceId,
      },
    });
  }

  findMany(args: { where?: WhereInput } & Record<string, unknown> = {}): Promise<Entity[]> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId: this.workspaceId,
      },
    });
  }

  create(args: { data: CreateInput } & Record<string, unknown>): Promise<Entity> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).create({
      ...args,
      data: {
        ...args.data,
        workspace: { connect: { id: this.workspaceId } },
      },
    });
  }

  update(args: { where: WhereInput; data: UpdateInput } & Record<string, unknown>): Promise<{ count: number }> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).updateMany({
      ...args,
      where: {
        ...args.where,
        workspaceId: this.workspaceId,
      },
    });
  }

  delete(args: { where: WhereInput } & Record<string, unknown>): Promise<{ count: number }> {
    // Prisma's generated generic delegates are structurally distinct. We must bypass strict typing locally.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.modelDelegate as any).deleteMany({
      ...args,
      where: {
        ...args.where,
        workspaceId: this.workspaceId,
      },
    });
  }
}
