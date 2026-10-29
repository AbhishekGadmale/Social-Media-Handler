import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaClient, MediaAssetStatus } from '@agency-os/database';
import type { IObjectStorage } from '@agency-os/providers';
import { generateId } from '@agency-os/database';

@Injectable()
export class MediaRecoveryService implements OnModuleInit, OnModuleDestroy {
  private intervalId?: NodeJS.Timeout;
  private readonly SCAN_INTERVAL_MS = 60000;
  private readonly MEDIA_PROCESSING_STALE_MS = 5 * 60 * 1000;
  private readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaClient,
    @Inject('IObjectStorage') private readonly storage: IObjectStorage,
    @InjectPinoLogger(MediaRecoveryService.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => {
      void this.scan();
    }, this.SCAN_INTERVAL_MS);
    this.logger.info(
      { intervalMs: this.SCAN_INTERVAL_MS, action: 'media_recovery.started' },
      `Media recovery service started with interval ${this.SCAN_INTERVAL_MS}ms`,
    );
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private generateStagingKey(workspaceId: string, mediaId: string): string {
    return `workspaces/${workspaceId}/media/uploads/${mediaId}`;
  }

  private generateFinalKey(workspaceId: string, mediaId: string): string {
    return `workspaces/${workspaceId}/media/${mediaId}/source`;
  }

  async scan() {
    try {
      await this.recoverStaleProcessing();
    } catch (error) {
      this.logger.error(
        { err: error, action: 'media_recovery.scan_failed' },
        'Error in media recovery scan loop',
      );
    }
  }

  private async recoverStaleProcessing() {
    const thresholdDate = new Date(Date.now() - this.MEDIA_PROCESSING_STALE_MS);

    const staleAssets = await this.prisma.mediaAsset.findMany({
      where: {
        status: MediaAssetStatus.PROCESSING,
        processingStartedAt: {
          lt: thresholdDate,
        },
      },
      take: this.BATCH_SIZE,
    });

    for (const asset of staleAssets) {
      this.logger.info(
        {
          assetId: asset.id,
          workspaceId: asset.workspaceId,
          action: 'media_recovery.recovering',
        },
        'Recovering stale processing media',
      );

      const stagingKey = this.generateStagingKey(asset.workspaceId, asset.id);
      const finalKey = this.generateFinalKey(asset.workspaceId, asset.id);

      try {
        const finalHead = await this.storage.headObject(finalKey);

        if (finalHead.exists) {
          if (finalHead.byteSize === asset.byteSize) {
            // Case A: final object exists and size matches
            const claim = await this.prisma.mediaAsset.updateMany({
              where: {
                id: asset.id,
                status: MediaAssetStatus.PROCESSING,
                processingStartedAt: asset.processingStartedAt,
              },
              data: { status: MediaAssetStatus.READY, storageKey: finalKey },
            });

            if (claim.count > 0) {
              this.logger.info(
                {
                  assetId: asset.id,
                  workspaceId: asset.workspaceId,
                  action: 'media_recovery.recovered_ready_final',
                },
                'Recovered media asset to READY (final exists)',
              );
              this.storage.deleteObject(stagingKey).catch(() => {});
            }
          } else {
            // Final invalid
            const claim = await this.prisma.mediaAsset.updateMany({
              where: {
                id: asset.id,
                status: MediaAssetStatus.PROCESSING,
                processingStartedAt: asset.processingStartedAt,
              },
              data: { status: MediaAssetStatus.FAILED },
            });
            if (claim.count > 0)
              this.logger.info(
                {
                  assetId: asset.id,
                  workspaceId: asset.workspaceId,
                  action: 'media_recovery.recovered_failed_size',
                },
                'Recovered media asset to FAILED (size mismatch)',
              );
          }
        } else {
          const stagingHead = await this.storage.headObject(stagingKey);

          if (stagingHead.exists) {
            if (stagingHead.byteSize === asset.byteSize) {
              // Case B: staging exists, final missing, size matches -> COPY -> READY
              await this.storage.copyObject(stagingKey, finalKey);
              const newFinalHead = await this.storage.headObject(finalKey);
              if (
                newFinalHead.exists &&
                newFinalHead.byteSize === asset.byteSize
              ) {
                const claim = await this.prisma.mediaAsset.updateMany({
                  where: {
                    id: asset.id,
                    status: MediaAssetStatus.PROCESSING,
                    processingStartedAt: asset.processingStartedAt,
                  },
                  data: {
                    status: MediaAssetStatus.READY,
                    storageKey: finalKey,
                  },
                });

                if (claim.count > 0) {
                  this.logger.info(
                    {
                      assetId: asset.id,
                      workspaceId: asset.workspaceId,
                      action: 'media_recovery.recovered_ready_copied',
                    },
                    'Recovered media asset to READY (copied from staging)',
                  );
                  this.storage.deleteObject(stagingKey).catch(() => {});
                }
              } else {
                await this.failAsset(asset, 'MEDIA_RECOVERY_COPY_FAILED');
              }
            } else {
              await this.failAsset(asset, 'MEDIA_RECOVERY_SIZE_MISMATCH');
            }
          } else {
            // Neither exists
            await this.failAsset(asset, 'MEDIA_RECOVERY_OBJECT_MISSING');
          }
        }
      } catch (error: any) {
        this.logger.error(
          {
            assetId: asset.id,
            workspaceId: asset.workspaceId,
            err: error,
            action: 'media_recovery.error',
          },
          'Error recovering media',
        );
        await this.failAsset(asset, 'MEDIA_RECOVERY_ERROR');
      }
    }
  }

  private async failAsset(asset: any, code: string) {
    const claim = await this.prisma.mediaAsset.updateMany({
      where: {
        id: asset.id,
        status: MediaAssetStatus.PROCESSING,
        processingStartedAt: asset.processingStartedAt,
      },
      data: { status: MediaAssetStatus.FAILED },
    });
    if (claim.count > 0) {
      this.logger.info(
        {
          assetId: asset.id,
          workspaceId: asset.workspaceId,
          code,
          action: 'media_recovery.asset_failed',
        },
        'Recovered media asset to FAILED',
      );
    }
  }
}
