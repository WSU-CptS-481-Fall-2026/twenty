import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource, LessThan, Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { PreInstalledAppsService } from 'src/engine/core-modules/application/pre-installed-apps/pre-installed-apps.service';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { SdkClientGenerationService } from 'src/engine/core-modules/sdk-client/sdk-client-generation.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { UpgradeSequenceReaderService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { PrefillLogicFunctionService } from 'src/engine/workspace-manager/standard-objects-prefill-data/services/prefill-logic-function.service';
import { prefillCompanies } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-companies.util';
import { prefillDashboards } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-dashboards.util';
import { prefillOpportunities } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-opportunities.util';
import { prefillPeople } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-people.util';
import { getCreateCompanyWhenAddingNewPersonCodeStepLogicFunctionDefinitions } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflow-code-step-logic-functions.util';
import { prefillWorkflowCommandMenuItems } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflow-command-menu-items.util';
import { prefillWorkflows } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util';
import { WorkspaceManagerService } from 'src/engine/workspace-manager/workspace-manager.service';
import { DEFAULT_FEATURE_FLAGS } from 'src/engine/workspace-manager/workspace-migration/constant/default-feature-flags';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

// A stale activation lock can be reclaimed after a crashed activation.
const WORKSPACE_ACTIVATION_STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class WorkspaceActivationService {
  private readonly logger = new Logger(WorkspaceActivationService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly workspaceManagerService: WorkspaceManagerService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly sdkClientGenerationService: SdkClientGenerationService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    private readonly upgradeMigrationService: UpgradeMigrationService,
    private readonly upgradeSequenceReaderService: UpgradeSequenceReaderService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly billingService: BillingService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly prefillLogicFunctionService: PrefillLogicFunctionService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly preInstalledAppsService: PreInstalledAppsService,
  ) {}

  async activateWorkspace(user: AuthContextUser, workspace: WorkspaceEntity) {
    // Acquire the activation lock by atomically moving the workspace to
    // ONGOING_CREATION. First try the normal case (PENDING_CREATION). If nothing
    // matches, the workspace may be stuck in ONGOING_CREATION from a prior
    // attempt that was killed before the catch block could reset it — reclaim it,
    // but only once the lock is stale, so a genuinely concurrent activation is
    // never interrupted. Postgres row locking serializes concurrent reclaims, and
    // repository.update bumps updatedAt, so a reclaimed lock is immediately fresh.
    let activationLockResult = await this.workspaceRepository.update(
      {
        id: workspace.id,
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      },
      { activationStatus: WorkspaceActivationStatus.ONGOING_CREATION },
    );

    if ((activationLockResult.affected ?? 0) === 0) {
      activationLockResult = await this.workspaceRepository.update(
        {
          id: workspace.id,
          activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
          updatedAt: LessThan(
            new Date(Date.now() - WORKSPACE_ACTIVATION_STALE_LOCK_TIMEOUT_MS),
          ),
        },
        { activationStatus: WorkspaceActivationStatus.ONGOING_CREATION },
      );
    }

    if ((activationLockResult.affected ?? 0) === 0) {
      // Activation is idempotent for the terminal state: if a prior attempt
      // already completed (e.g. the client lost the response and retried),
      // return the active workspace instead of failing. Otherwise another
      // activation is genuinely in progress and must not be interrupted.
      const existingWorkspace = await this.workspaceRepository.findOneBy({
        id: workspace.id,
      });

      if (
        existingWorkspace?.activationStatus ===
          WorkspaceActivationStatus.ACTIVE ||
        existingWorkspace?.activationStatus ===
          WorkspaceActivationStatus.CREATED
      ) {
        return existingWorkspace;
      }

      throw new Error('Workspace is already being created');
    }

    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspace.id,
    );

    try {
      await this.workspaceManagerService.init({
        workspace,
        userId: user.id,
      });

      await this.featureFlagService.enableFeatureFlags(
        DEFAULT_FEATURE_FLAGS,
        workspace.id,
      );

      await this.userWorkspaceService.createWorkspaceMember(workspace.id, user);

      await this.prefillCreatedWorkspaceRecords({
        workspaceId: workspace.id,
        schemaName: getWorkspaceSchemaName(workspace.id),
      });

      await this.activateAndInitializeUpgradeState({
        workspaceId: workspace.id,
      });

      await this.enqueuePreInstalledAppsInstallation(workspace.id);
    } catch (error) {
      await this.workspaceRepository.update(workspace.id, {
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspace.id,
      );

      throw error;
    }

    try {
      await this.sdkClientGenerationService.enqueueSdkClientGenerationForWorkspace(
        workspace.id,
      );
    } catch (error) {
      this.logger.error(
        `failed to enqueue SDK client generation jobs for workspace ${workspace.id}`,
        error,
      );
      this.exceptionHandlerService.captureExceptions([error as Error]);
    }

    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspace.id,
    );

    return await this.workspaceRepository.findOneBy({
      id: workspace.id,
    });
  }

  private async activateAndInitializeUpgradeState({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<void> {
    const lastAttemptedInstanceCommand =
      await this.upgradeMigrationService.getLastAttemptedInstanceCommandOrThrow();

    const initialCursor =
      this.upgradeSequenceReaderService.getInitialCursorForNewWorkspace(
        lastAttemptedInstanceCommand,
      );

    const executedByVersion =
      this.twentyConfigService.get('APP_VERSION') ?? 'unknown';

    const hasWorkspaceAnySubscription =
      await this.billingService.hasWorkspaceAnySubscription(workspaceId);

    const queryRunner = this.coreDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.update(WorkspaceEntity, workspaceId, {
        activationStatus: hasWorkspaceAnySubscription
          ? WorkspaceActivationStatus.ACTIVE
          : WorkspaceActivationStatus.CREATED,
      });

      await this.upgradeMigrationService.markAsWorkspaceInitial({
        name: initialCursor.name,
        workspaceId,
        executedByVersion,
        status: initialCursor.status,
        queryRunner,
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async prefillCreatedWorkspaceRecords({
    workspaceId,
    schemaName,
  }: {
    workspaceId: string;
    schemaName: string;
  }): Promise<void> {
    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatPageLayoutMaps,
    } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: [
            'flatObjectMetadataMaps',
            'flatFieldMetadataMaps',
            'flatPageLayoutMaps',
          ],
        },
      );

    await this.prefillLogicFunctionService.ensureSeeded({
      workspaceId,
      definitions:
        getCreateCompanyWhenAddingNewPersonCodeStepLogicFunctionDefinitions(
          workspaceId,
        ),
    });

    const queryRunner = this.coreDataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      await queryRunner.startTransaction();

      await prefillCompanies(queryRunner.manager, schemaName);

      await prefillPeople(queryRunner.manager, schemaName);

      await prefillWorkflows(
        queryRunner.manager,
        workspaceId,
        schemaName,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
      );

      await prefillOpportunities(queryRunner.manager, schemaName);

      await prefillDashboards(
        queryRunner.manager,
        schemaName,
        flatPageLayoutMaps,
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }

    try {
      await prefillWorkflowCommandMenuItems({
        workspaceId,
        applicationService: this.applicationService,
        flatEntityMapsCacheService: this.flatEntityMapsCacheService,
        workspaceMigrationValidateBuildAndRunService:
          this.workspaceMigrationValidateBuildAndRunService,
      });
    } catch (error) {
      this.logger.error(
        `Non-critical: failed to prefill workflow command menu items for workspace ${workspaceId}`,
        error,
      );
      this.exceptionHandlerService.captureExceptions([error as Error]);
    }
  }

  private async enqueuePreInstalledAppsInstallation(
    workspaceId: string,
  ): Promise<void> {
    try {
      await this.preInstalledAppsService.enqueueInstallOnWorkspace(workspaceId);
    } catch (error) {
      this.logger.error(
        `Non-critical: failed to enqueue pre-installed apps installation for workspace ${workspaceId}`,
        error,
      );
      this.exceptionHandlerService.captureExceptions([error as Error]);
    }
  }
}
