import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import assert from 'assert';

import { isDefined } from 'twenty-shared/utils';
import { DataSource, IsNull, QueryRunner, Repository } from 'typeorm';

import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApplicationUninstallService } from 'src/engine/core-modules/application/application-manifest/services/application-uninstall.service';
import { BillingSubscriptionService } from 'src/engine/core-modules/billing/services/billing-subscription.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { DnsManagerService } from 'src/engine/core-modules/dns-manager/services/dns-manager.service';
import { EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import {
  EmailingDomainWorkspaceCleanupJob,
  type EmailingDomainWorkspaceCleanupJobData,
} from 'src/engine/core-modules/emailing-domain/jobs/emailing-domain-workspace-cleanup.job';
import {
  FileWorkspaceFolderDeletionJob,
  type FileWorkspaceFolderDeletionJobData,
} from 'src/engine/core-modules/file/jobs/file-workspace-folder-deletion.job';
import { LOGIC_FUNCTION_QUEUE_RETRY_BACKOFF } from 'src/engine/core-modules/logic-function/logic-function-trigger/constants/logic-function-queue-retry-backoff.constant';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WORKSPACE_SOFT_DELETED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-soft-deleted-event.constant';
import {
  WorkspaceDeletionApplicationUninstallJob,
  type WorkspaceDeletionApplicationUninstallJobData,
} from 'src/engine/core-modules/workspace/jobs/workspace-deletion-application-uninstall.job';
import { type WorkspaceSoftDeletedEvent } from 'src/engine/core-modules/workspace/types/workspace-soft-deleted-event.type';
import { getWorkspaceApplicationUninstallLockName } from 'src/engine/core-modules/workspace/utils/get-workspace-application-uninstall-lock-name.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceException,
  WorkspaceExceptionCode,
} from 'src/engine/core-modules/workspace/workspace.exception';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ALL_METADATA_ENTITY_BY_METADATA_NAME } from 'src/engine/metadata-modules/flat-entity/constant/all-metadata-entity-by-metadata-name.constant';
import { ALL_METADATA_NAMES_SORTED_ATOMICALLY } from 'src/engine/metadata-modules/flat-entity/constant/all-metadata-names-sorted-atomically.constant';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceSchemaService } from 'src/engine/workspace-datasource/workspace-schema.service';

const WORKSPACE_APPLICATION_UNINSTALL_RETRY_LIMIT = 3;

@Injectable()
export class WorkspaceDeletionService {
  private readonly logger = new Logger(WorkspaceDeletionService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly billingService: BillingService,
    private readonly billingSubscriptionService: BillingSubscriptionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly postgresAdvisoryLockService: PostgresAdvisoryLockService,
    private readonly applicationUninstallService: ApplicationUninstallService,
    private readonly workspaceSchemaService: WorkspaceSchemaService,
    private readonly workspaceCacheStorageService: WorkspaceCacheStorageService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly dnsManagerService: DnsManagerService,
    @InjectMessageQueue(MessageQueue.deleteCascadeQueue)
    private readonly deleteCascadeMessageQueueService: MessageQueueService,
    @InjectMessageQueue(MessageQueue.logicFunctionQueue)
    private readonly logicFunctionMessageQueueService: MessageQueueService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
  ) {}

  async deleteWorkspace(id: string, softDelete = false) {
    const workspace = await this.workspaceRepository.findOne({
      where: { id },
      withDeleted: true,
    });

    assert(workspace, 'Workspace not found');

    if (!softDelete) {
      return this.hardDeleteWorkspaceWithApplicationUninstallLock(workspace);
    }

    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: {
        workspaceId: id,
      },
      withDeleted: true,
    });

    for (const userWorkspace of userWorkspaces) {
      await this.handleRemoveWorkspaceMember(id, userWorkspace.userId, true);
    }
    this.logger.log(`workspace ${id} user workspaces deleted`);

    this.logger.log(`workspace ${id} cache flushed`);

    if (this.billingService.isBillingEnabled()) {
      await this.billingSubscriptionService.cancelSubscription(workspace.id);
    }

    await this.workspaceRepository.softDelete({ id, deletedAt: IsNull() });
    await this.coreEntityCacheService.invalidate('workspaceEntity', id);

    this.eventEmitter.emit(WORKSPACE_SOFT_DELETED_EVENT, {
      workspaceId: id,
    } satisfies WorkspaceSoftDeletedEvent);

    await this.enqueueWorkspaceDeletionApplicationUninstall(id);

    this.logger.log(`workspace ${id} soft deleted`);

    return workspace;
  }

  private async hardDeleteWorkspaceWithApplicationUninstallLock(
    workspace: WorkspaceEntity,
  ): Promise<WorkspaceEntity> {
    const advisoryLockResult =
      await this.postgresAdvisoryLockService.tryWithLock(
        getWorkspaceApplicationUninstallLockName(workspace.id),
        async () => {
          const userWorkspaces = await this.userWorkspaceRepository.find({
            where: {
              workspaceId: workspace.id,
            },
            withDeleted: true,
          });

          for (const userWorkspace of userWorkspaces) {
            await this.handleRemoveWorkspaceMember(
              workspace.id,
              userWorkspace.userId,
              false,
            );
          }
          this.logger.log(`workspace ${workspace.id} user workspaces deleted`);

          this.logger.log(`workspace ${workspace.id} cache flushed`);

          if (this.billingService.isBillingEnabled()) {
            await this.billingSubscriptionService.assertSubscriptionCanceledOrNone(
              workspace.id,
            );
          }

          await this.runPendingApplicationUninstallHooksBeforeHardDelete(
            workspace,
          );

          await this.deleteWorkspaceSyncableMetadataEntities(workspace);

          await this.workspaceSchemaService.deleteWorkspaceDBSchema(
            workspace.id,
          );

          await this.workspaceCacheStorageService.flush(workspace.id);
          await this.flatEntityMapsCacheService.flushFlatEntityMaps({
            workspaceId: workspace.id,
          });

          await this.deleteCascadeMessageQueueService.add<FileWorkspaceFolderDeletionJobData>(
            FileWorkspaceFolderDeletionJob.name,
            { workspaceId: workspace.id },
          );

          const emailingDomains = await this.coreDataSource
            .getRepository(EmailingDomainEntity)
            .find({ where: { workspaceId: workspace.id } });

          await this.deleteCascadeMessageQueueService.add<EmailingDomainWorkspaceCleanupJobData>(
            EmailingDomainWorkspaceCleanupJob.name,
            {
              workspaceId: workspace.id,
              domains: emailingDomains.map(
                (emailingDomain) => emailingDomain.domain,
              ),
            },
          );

          if (workspace.customDomain) {
            await this.dnsManagerService.deleteHostnameSilently(
              workspace.customDomain,
            );
            this.logger.log(`workspace ${workspace.id} custom domain deleted`);
          }

          await this.workspaceRepository.delete(workspace.id);
          await this.coreEntityCacheService.invalidate(
            'workspaceEntity',
            workspace.id,
          );

          this.logger.log(`workspace ${workspace.id} hard deleted`);

          return workspace;
        },
      );

    if (!advisoryLockResult.acquired) {
      throw new WorkspaceException(
        `Cannot hard delete workspace ${workspace.id} while application uninstall is running`,
        WorkspaceExceptionCode.APPLICATION_UNINSTALL_IN_PROGRESS,
      );
    }

    return advisoryLockResult.value;
  }

  async enqueueWorkspaceDeletionApplicationUninstall(
    workspaceId: string,
  ): Promise<void> {
    await this.logicFunctionMessageQueueService.add<WorkspaceDeletionApplicationUninstallJobData>(
      WorkspaceDeletionApplicationUninstallJob.name,
      { workspaceId },
      {
        id: `${WorkspaceDeletionApplicationUninstallJob.name}-${workspaceId}`,
        retryLimit: WORKSPACE_APPLICATION_UNINSTALL_RETRY_LIMIT,
        backoff: LOGIC_FUNCTION_QUEUE_RETRY_BACKOFF,
      },
    );
  }

  private async runPendingApplicationUninstallHooksBeforeHardDelete(
    workspace: WorkspaceEntity,
  ): Promise<void> {
    if (!isDefined(workspace.deletedAt)) {
      return;
    }

    await this.applicationUninstallService.runUninstallHooksForWorkspaceDeletionBestEffort(
      {
        workspaceId: workspace.id,
        workspaceDeletedAt: workspace.deletedAt,
      },
    );
  }

  private async deleteWorkspaceSyncableMetadataEntities(
    workspace: WorkspaceEntity,
  ): Promise<void> {
    const fieldMetadataIdChunks = await this.getFieldMetadataIdChunks(
      workspace.id,
    );
    const queryRunner = this.coreDataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      await queryRunner.startTransaction();

      for (const metadataName of ALL_METADATA_NAMES_SORTED_ATOMICALLY) {
        if (metadataName === 'fieldMetadata') {
          const deletedCount = await this.deleteFieldMetadataInChunks(
            queryRunner,
            workspace.id,
            fieldMetadataIdChunks,
          );

          if (deletedCount > 0) {
            this.logger.log(
              `workspace ${workspace.id}: deleted ${deletedCount} ${metadataName} record(s)`,
            );
          }

          continue;
        }

        const entity = ALL_METADATA_ENTITY_BY_METADATA_NAME[metadataName];

        const result = await queryRunner.manager.delete(entity, {
          workspaceId: workspace.id,
        });

        if (result.affected && result.affected > 0) {
          this.logger.log(
            `workspace ${workspace.id}: deleted ${result.affected} ${metadataName} record(s)`,
          );
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // FieldMetadataEntity has a self-referencing FK (relationTargetFieldMetadataId)
  // Related fields must be deleted together to avoid constraint violations
  private async getFieldMetadataIdChunks(
    workspaceId: string,
  ): Promise<string[][]> {
    const CHUNK_SIZE = 50;

    const { flatFieldMetadataMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: ['flatFieldMetadataMaps'],
        },
      );

    const fields = Object.values(
      flatFieldMetadataMaps.byUniversalIdentifier,
    ).filter(isDefined);

    if (fields.length === 0) {
      return [];
    }

    const processedIds = new Set<string>();
    const fieldsMap = new Map(fields.map((field) => [field.id, field]));
    const chunks: string[][] = [];
    let currentChunk: string[] = [];

    for (const field of fields) {
      if (processedIds.has(field.id)) {
        continue;
      }

      currentChunk.push(field.id);
      processedIds.add(field.id);

      if (field.relationTargetFieldMetadataId) {
        const relatedField = fieldsMap.get(field.relationTargetFieldMetadataId);

        if (relatedField && !processedIds.has(relatedField.id)) {
          currentChunk.push(relatedField.id);
          processedIds.add(relatedField.id);
        }
      }

      if (currentChunk.length >= CHUNK_SIZE) {
        chunks.push([...currentChunk]);
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private async deleteFieldMetadataInChunks(
    queryRunner: QueryRunner,
    workspaceId: string,
    fieldMetadataIdChunks: string[][],
  ): Promise<number> {
    let totalDeleted = 0;

    for (const [index, chunk] of fieldMetadataIdChunks.entries()) {
      const result = await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(FieldMetadataEntity)
        .whereInIds(chunk)
        .execute();

      const deletedInChunk = result.affected || 0;

      totalDeleted += deletedInChunk;

      this.logger.log(
        `workspace ${workspaceId}: fieldMetadata chunk ${index + 1}/${fieldMetadataIdChunks.length} - deleted ${deletedInChunk} record(s)`,
      );
    }

    return totalDeleted;
  }

  async handleRemoveWorkspaceMember(
    workspaceId: string,
    userId: string,
    softDelete = false,
  ) {
    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: {
        userId,
      },
    });

    const userWorkspaceOfRemovedWorkspaceMember = userWorkspaces?.find(
      (userWorkspace: UserWorkspaceEntity) =>
        userWorkspace.workspaceId === workspaceId,
    );

    if (isDefined(userWorkspaceOfRemovedWorkspaceMember)) {
      await this.userWorkspaceService.deleteUserWorkspace({
        userWorkspaceId: userWorkspaceOfRemovedWorkspaceMember.id,
        workspaceId,
        softDelete,
      });
      await this.coreEntityCacheService.invalidate(
        'userWorkspaceEntity',
        userWorkspaceOfRemovedWorkspaceMember.id,
      );
    }

    const hasOtherUserWorkspaces = isDefined(
      userWorkspaceOfRemovedWorkspaceMember,
    )
      ? userWorkspaces.length > 1
      : userWorkspaces.length > 0;

    if (!hasOtherUserWorkspaces) {
      await this.userRepository.softDelete(userId);
      await this.coreEntityCacheService.invalidate('user', userId);
    }
  }
}
