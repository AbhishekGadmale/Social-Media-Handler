/* eslint-disable */
import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { IObjectStorage } from '@agency-os/providers';
import {
  PrismaClient,
  MediaAssetStatus,
  AuditAction,
} from '@agency-os/database';
import crypto from 'crypto';
import { AuditService } from '../core/audit.service';

export interface InitiateUploadDto {
  filename: string;
  mimeType: string;
  byteSize: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly maxUploadBytes: number = parseInt(
    process.env.MEDIA_MAX_UPLOAD_BYTES || '524288000',
    10,
  );
  private readonly uploadUrlTtl: number = parseInt(
    process.env.MEDIA_UPLOAD_URL_TTL_SECONDS || '900',
    10,
  );

  constructor(
    @Inject('IObjectStorage') private readonly storage: IObjectStorage,
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  private generateStagingKey(workspaceId: string, mediaId: string): string {
    return `workspaces/${workspaceId}/media/uploads/${mediaId}`;
  }

  private generateFinalKey(workspaceId: string, mediaId: string): string {
    return `workspaces/${workspaceId}/media/${mediaId}/source`;
  }

  async initiateUpload(
    workspaceId: string,
    userId: string,
    dto: InitiateUploadDto,
  ) {
    if (dto.byteSize <= 0 || dto.byteSize > this.maxUploadBytes) {
      throw new BadRequestException(
        `File size must be between 1 and ${this.maxUploadBytes} bytes`,
      );
    }

    if (
      !dto.mimeType.startsWith('video/') &&
      !dto.mimeType.startsWith('image/')
    ) {
      throw new BadRequestException(
        'Only video and image MIME types are allowed',
      );
    }

    const mediaId = crypto.randomUUID();
    const stagingKey = this.generateStagingKey(workspaceId, mediaId);

    // 1. Transactionally create asset
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id: mediaId,
        workspaceId,
        filename: dto.filename.slice(0, 255), // Sanitize max length
        mimeType: dto.mimeType,
        byteSize: dto.byteSize,
        storageKey: stagingKey, // Temporarily store staging key
        status: MediaAssetStatus.UPLOADING,
      },
    });

    // 2. Generate signed URL
    let auth;
    try {
      auth = await this.storage.createUpload(
        stagingKey,
        dto.mimeType,
        this.uploadUrlTtl,
      );
    } catch (e) {
      // Revert asset creation if storage fails
      await this.prisma.mediaAsset.delete({ where: { id: mediaId } });
      throw new InternalServerErrorException(
        'Failed to initialize object storage upload',
      );
    }

    // 3. Audit log
    await this.audit.logAction({
      action: AuditAction.MEDIA_UPLOAD_INITIATED,
      workspaceId,
      actorId: userId,
      targetId: mediaId,
      targetType: 'MEDIA_ASSET',
      metadata: {
        mediaAssetId: mediaId,
        mimeType: dto.mimeType,
        byteSize: dto.byteSize,
        ttlSeconds: this.uploadUrlTtl,
      },
    });

    return {
      mediaAssetId: mediaId,
      uploadUrl: auth.uploadUrl,
      expiresAt: auth.expiresAt,
    };
  }

  async completeUpload(workspaceId: string, mediaId: string, userId: string) {
    // Attempt to acquire lock by transitioning UPLOADING -> PROCESSING
    const claim = await this.prisma.mediaAsset.updateMany({
      where: { id: mediaId, workspaceId, status: MediaAssetStatus.UPLOADING },
      data: {
        status: MediaAssetStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });

    if (claim.count === 0) {
      // It might be already READY or being processed
      const asset = await this.prisma.mediaAsset.findFirst({
        where: { id: mediaId, workspaceId },
      });

      if (!asset) {
        throw new NotFoundException('Media asset not found in this workspace');
      }

      if (asset.status === MediaAssetStatus.READY) {
        // Idempotent success
        return asset;
      }

      throw new BadRequestException(
        `Cannot complete upload in status: ${asset.status}`,
      );
    }

    // Now we exclusively own the completion process
    const stagingKey = this.generateStagingKey(workspaceId, mediaId);
    const finalKey = this.generateFinalKey(workspaceId, mediaId);
    let expectedByteSize = 0;

    try {
      const asset = await this.prisma.mediaAsset.findUniqueOrThrow({
        where: { id: mediaId },
      });
      expectedByteSize = asset.byteSize;

      // 1. Storage HEAD check
      const head = await this.storage.headObject(stagingKey);
      if (!head.exists) {
        throw new BadRequestException(
          'MEDIA_UPLOAD_INCOMPLETE: Object not found in storage. Upload incomplete or expired.',
        );
      }

      if (head.byteSize !== asset.byteSize) {
        throw new BadRequestException(
          `MEDIA_SIZE_MISMATCH: Object size mismatch. Expected ${asset.byteSize}, got ${head.byteSize}`,
        );
      }

      // S3 often defaults to application/octet-stream if content-type isn't set on presigned PUT correctly by the client.
      // We do a loose check here, but note that some clients fail to send the exact Content-Type.
      if (
        head.mimeType &&
        head.mimeType !== 'application/octet-stream' &&
        head.mimeType !== asset.mimeType
      ) {
        throw new BadRequestException(
          `MEDIA_TYPE_MISMATCH: Object type mismatch. Expected ${asset.mimeType}, got ${head.mimeType}`,
        );
      }

      // 2. COPY staging -> final
      await this.storage.copyObject(stagingKey, finalKey);

      // 3. HEAD final object
      const finalHead = await this.storage.headObject(finalKey);
      if (!finalHead.exists) {
        throw new InternalServerErrorException(
          'Failed to verify final object after copy',
        );
      }

      // 4. Mark READY and update storageKey
      const readyAsset = await this.prisma.mediaAsset.update({
        where: { id: mediaId },
        data: {
          status: MediaAssetStatus.READY,
          storageKey: finalKey,
        },
      });

      // 5. Fire and forget staging cleanup
      this.storage.deleteObject(stagingKey).catch((err) => {
        this.logger.warn(
          `Failed to cleanup staging object ${stagingKey}: ${err.message}`,
        );
      });

      await this.audit.logAction({
        action: AuditAction.MEDIA_UPLOAD_COMPLETED,
        workspaceId,
        actorId: userId,
        targetId: mediaId,
        targetType: 'MEDIA_ASSET',
        metadata: {
          mediaAssetId: mediaId,
          byteSize: finalHead.byteSize,
        },
      });

      return readyAsset;
    } catch (error) {
      // Revert processing state on failure
      this.logger.error(
        `Media completion failed for ${mediaId}: ${error.message}`,
      );
      await this.prisma.mediaAsset.update({
        where: { id: mediaId },
        data: { status: MediaAssetStatus.FAILED },
      });
      throw error;
    }
  }
}
