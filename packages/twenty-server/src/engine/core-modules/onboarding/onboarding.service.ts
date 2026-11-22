import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { isNumber } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { type DataSource, type QueryRunner, Repository } from 'typeorm';

import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { ONBOARDING_INSTALLABLE_APP_UNIVERSAL_IDENTIFIERS } from 'src/engine/core-modules/onboarding/constants/onboarding-installable-app-universal-identifiers';
import { ACQUIRE_ONBOARDING_STEP_TRANSITION_LOCK_STATEMENT } from 'src/engine/core-modules/onboarding/constants/acquire-onboarding-step-transition-lock-statement';
import { buildOnboardingStepTransitionLockName } from 'src/engine/core-modules/onboarding/utils/build-onboarding-step-transition-lock-name.util';
import { OnboardingStatus } from 'src/engine/core-modules/onboarding/enums/onboarding-status.enum';
import {
  INSTALL_ONBOARDING_APPS_JOB_NAME,
  type InstallOnboardingAppsJobData,
} from 'src/engine/core-modules/onboarding/jobs/install-onboarding-apps.job-constants';
import {
  OnboardingException,
  OnboardingExceptionCode,
} from 'src/engine/core-modules/onboarding/onboarding.exception';
import { OnboardingHistoryService } from 'src/engine/core-modules/onboarding/services/onboarding-history.service';
import { OnboardingRewardService } from 'src/engine/core-modules/onboarding/services/onboarding-reward.service';
import { type OnboardingContext } from 'src/engine/core-modules/onboarding/types/onboarding-context.type';
import {
  type OnboardingKeyValueTypeMap,
  OnboardingStepKeys,
} from 'src/engine/core-modules/onboarding/types/onboarding-key-value.type';
import { type ReversibleOnboardingStep } from 'src/engine/core-modules/onboarding/types/reversible-onboarding-step.type';
import { readBookCallStepMinEmployeeCount } from 'src/engine/core-modules/onboarding/utils/read-book-call-step-min-employee-count.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export {
  type OnboardingKeyValueTypeMap,
  OnboardingStepKeys,
} from 'src/engine/core-modules/onboarding/types/onboarding-key-value.type';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly onboardingHistoryService: OnboardingHistoryService,
    private readonly onboardingRewardService: OnboardingRewardService,
    private readonly userVarsService: UserVarsService<OnboardingKeyValueTypeMap>,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectMessageQueue(MessageQueue.workspaceQueue)
    private readonly messageQueueService: MessageQueueService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async runStepTransitionInLockedTransaction<TResult>(
    { userId, workspaceId }: OnboardingContext,
    runStepTransition: (queryRunner: QueryRunner) => Promise<TResult>,
  ): Promise<TResult> {
    return this.dataSource.transaction(async (entityManager) => {
      const transactionQueryRunner = entityManager.queryRunner;

      if (!isDefined(transactionQueryRunner)) {
        throw new OnboardingException(
          'Onboarding step transitions require a transaction-scoped entity manager',
          OnboardingExceptionCode.MISSING_TRANSACTION_QUERY_RUNNER,
        );
      }

      await transactionQueryRunner.query(
        ACQUIRE_ONBOARDING_STEP_TRANSITION_LOCK_STATEMENT,
        [buildOnboardingStepTransitionLockName({ userId, workspaceId })],
      );

      return runStepTransition(transactionQueryRunner);
    });
  }

  private isWorkspaceActivationPending(workspace: WorkspaceEntity) {
    return (
      workspace.activationStatus ===
        WorkspaceActivationStatus.PENDING_CREATION ||
      workspace.activationStatus === WorkspaceActivationStatus.ONGOING_CREATION
    );
  }

  async getOnboardingStatus({
    userId,
    workspaceId,
  }: OnboardingContext): Promise<OnboardingStatus | null> {
    // We always read the workspace directly from the database here (bypassing
    // the per-instance core entity cache) so that onboardingStatus reflects the
    // freshest activationStatus right after activateWorkspace, even when a
    // sibling server instance still has a stale cached workspace.
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (!isDefined(workspace)) {
      return null;
    }

    if (this.isWorkspaceActivationPending(workspace)) {
      return OnboardingStatus.WORKSPACE_ACTIVATION;
    }

    const userVars = await this.userVarsService.getAll({
      userId,
      workspaceId: workspace.id,
    });

    const pendingStatus = this.getPendingOnboardingStatus(userVars);

    if (isDefined(pendingStatus)) {
      return pendingStatus;
    }

    const isPlanRequired =
      await this.billingService.isSubscriptionIncompleteOnboardingStatus(
        workspace.id,
      );

    if (
      userVars.get(OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING) === true &&
      isPlanRequired &&
      isDefined(readBookCallStepMinEmployeeCount(this.twentyConfigService))
    ) {
      return OnboardingStatus.BOOK_CALL;
    }

    if (isPlanRequired) {
      return OnboardingStatus.PLAN_REQUIRED;
    }

    return OnboardingStatus.COMPLETED;
  }

  private getPendingOnboardingStatus(
    userVars: Map<OnboardingStepKeys, unknown>,
  ): OnboardingStatus | null {
    const pendingSteps = [
      [
        OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
        OnboardingStatus.SYNC_EMAIL,
      ],
      [
        OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
        OnboardingStatus.APPS_INSTALLATION,
      ],
      [
        OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
        OnboardingStatus.PROFILE_CREATION,
      ],
      [
        OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
        OnboardingStatus.INVITE_TEAM,
      ],
    ] as const;

    for (const [key, status] of pendingSteps) {
      if (userVars.get(key) === true) {
        return status;
      }
    }

    return null;
  }

  async isOnboardingInviteTeamPending({
    userId,
    workspaceId,
  }: {
    userId?: string;
    workspaceId: string;
  }): Promise<boolean> {
    return (
      (await this.userVarsService.get({
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
      })) === true
    );
  }

  async getPreviousReversibleOnboardingStatus({
    userId,
    workspaceId,
  }: OnboardingContext): Promise<ReversibleOnboardingStep | null> {
    const reversibleStepHistory = await this.onboardingHistoryService.get({
      userId,
      workspaceId,
    });

    return reversibleStepHistory[reversibleStepHistory.length - 1] ?? null;
  }

  async goBackToPreviousOnboardingStep({
    userId,
    workspaceId,
  }: OnboardingContext) {
    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) => {
        const reversibleStepHistory = await this.onboardingHistoryService.get({
          userId,
          workspaceId,
        });
        const previousReversibleStep =
          reversibleStepHistory[reversibleStepHistory.length - 1];

        if (!isDefined(previousReversibleStep)) {
          throw new OnboardingException(
            `No previous onboarding step to go back to for user ${userId} in workspace ${workspaceId}`,
            OnboardingExceptionCode.NO_PREVIOUS_ONBOARDING_STEP,
          );
        }

        await this.onboardingHistoryService.set(
          { userId, workspaceId },
          reversibleStepHistory.slice(0, -1),
          queryRunner,
        );

        await this.restoreReversibleOnboardingStepPendingFlag(
          {
            userId,
            workspaceId,
            step: previousReversibleStep,
          },
          queryRunner,
        );
      },
    );

    return this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async () => ({
        onboardingStatus: await this.getOnboardingStatus({
          userId,
          workspaceId,
        }),
        previousOnboardingStatus:
          await this.getPreviousReversibleOnboardingStatus({
            userId,
            workspaceId,
          }),
      }),
    );
  }

  private async restoreReversibleOnboardingStepPendingFlag(
    {
      userId,
      workspaceId,
      step,
    }: {
      userId: string;
      workspaceId: string;
      step: ReversibleOnboardingStep;
    },
    queryRunner?: QueryRunner,
  ) {
    const restoreHandlers: Record<
      ReversibleOnboardingStep,
      (
        context: OnboardingContext & { value: boolean },
        queryRunner?: QueryRunner,
      ) => Promise<void>
    > = {
      [OnboardingStatus.SYNC_EMAIL]:
        this.setOnboardingConnectAccountPending.bind(this),
      [OnboardingStatus.APPS_INSTALLATION]:
        this.setOnboardingInstallAppsPending.bind(this),
      [OnboardingStatus.PROFILE_CREATION]:
        this.setOnboardingCreateProfilePending.bind(this),
      [OnboardingStatus.INVITE_TEAM]:
        this.setOnboardingInviteTeamPending.bind(this),
      [OnboardingStatus.BOOK_CALL]:
        this.setOnboardingBookCallPending.bind(this),
    };

    if (!Object.prototype.hasOwnProperty.call(restoreHandlers, step)) {
      throw new Error("Didn't expect to get here.");
    }

    // Invite-team restoration must remain user-scoped.
    return restoreHandlers[step](
      { userId, workspaceId, value: true },
      queryRunner,
    );
  }

  async setOnboardingConnectAccountPending(
    {
      userId,
      workspaceId,
      value,
    }: {
      userId: string;
      workspaceId: string;
      value: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (!value) {
      await this.userVarsService.delete(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
        },
        queryRunner,
      );

      return;
    }

    await this.userVarsService.set(
      {
        userId,
        workspaceId: workspaceId,
        key: OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
        value: true,
      },
      queryRunner,
    );
  }

  async completeOnboardingConnectAccountStep({
    userId,
    workspaceId,
  }: OnboardingContext) {
    const hasClaimedConnectAccountStep =
      await this.runStepTransitionInLockedTransaction(
        { userId, workspaceId },
        async (queryRunner) => {
          const hasClaimedStep = await this.claimOnboardingStep(
            {
              userId,
              workspaceId,
              key: OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
            },
            queryRunner,
          );

          if (!hasClaimedStep) {
            return false;
          }

          await this.onboardingHistoryService.clear(
            { userId, workspaceId },
            queryRunner,
          );

          return true;
        },
      );

    if (!hasClaimedConnectAccountStep) {
      return;
    }

    await this.onboardingRewardService.creditImportContactsRewardForFirstWorkspaceUser(
      { workspaceId },
    );
  }

  async skipOnboardingConnectAccountStep({
    userId,
    workspaceId,
    isAutoSkipped,
  }: {
    userId: string;
    workspaceId: string;
    isAutoSkipped: boolean;
  }) {
    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) => {
        const hasClaimedConnectAccountStep = await this.claimOnboardingStep(
          {
            userId,
            workspaceId,
            key: OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
          },
          queryRunner,
        );

        if (!hasClaimedConnectAccountStep || isAutoSkipped) {
          return;
        }

        await this.onboardingHistoryService.push(
          { userId, workspaceId },
          OnboardingStatus.SYNC_EMAIL,
          queryRunner,
        );
      },
    );
  }

  private async claimOnboardingStep(
    context:
      | (OnboardingContext & {
          key:
            | OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING
            | OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING
            | OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING
            | OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING;
        })
      | {
          workspaceId: string;
          key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING;
        },
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const affectedRows = await this.userVarsService.delete(
      context,
      queryRunner,
    );

    return isDefined(affectedRows) && affectedRows > 0;
  }

  async setOnboardingInstallAppsPending(
    {
      userId,
      workspaceId,
      value,
    }: {
      userId: string;
      workspaceId: string;
      value: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (!value) {
      await this.userVarsService.delete(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
        },
        queryRunner,
      );

      return;
    }

    await this.userVarsService.set(
      {
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
        value: true,
      },
      queryRunner,
    );
  }

  async triggerInstallAppsOnboardingStep({
    userId,
    workspaceId,
    universalIdentifiers,
    isAutoSkipped,
  }: {
    userId: string;
    workspaceId: string;
    universalIdentifiers: string[];
    isAutoSkipped: boolean;
  }) {
    const installableUniversalIdentifiers = universalIdentifiers.filter(
      (universalIdentifier) =>
        ONBOARDING_INSTALLABLE_APP_UNIVERSAL_IDENTIFIERS.includes(
          universalIdentifier,
        ),
    );

    if (installableUniversalIdentifiers.length === 0) {
      await this.runStepTransitionInLockedTransaction(
        { userId, workspaceId },
        async (queryRunner) => {
          const hasClaimedInstallAppsStep = await this.claimOnboardingStep(
            {
              userId,
              workspaceId,
              key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
            },
            queryRunner,
          );

          if (!hasClaimedInstallAppsStep || isAutoSkipped) {
            return;
          }

          await this.onboardingHistoryService.push(
            { userId, workspaceId },
            OnboardingStatus.APPS_INSTALLATION,
            queryRunner,
          );
        },
      );

      return;
    }

    const hasClaimedInstallAppsStep =
      await this.runStepTransitionInLockedTransaction(
        { userId, workspaceId },
        async (queryRunner) =>
          this.claimOnboardingStep(
            {
              userId,
              workspaceId,
              key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
            },
            queryRunner,
          ),
      );

    if (!hasClaimedInstallAppsStep) {
      return;
    }

    try {
      await this.messageQueueService.add<InstallOnboardingAppsJobData>(
        INSTALL_ONBOARDING_APPS_JOB_NAME,
        {
          workspaceId,
          universalIdentifiers: installableUniversalIdentifiers,
          userId,
        },
        { id: `${INSTALL_ONBOARDING_APPS_JOB_NAME}-${workspaceId}` },
      );
    } catch (error) {
      const enqueueFailureMessage = `Failed to enqueue the install onboarding apps job for workspace ${workspaceId}`;

      this.logger.error(enqueueFailureMessage, error);

      await this.releaseInstallAppsOnboardingStepClaim({ userId, workspaceId });

      throw new OnboardingException(
        enqueueFailureMessage,
        OnboardingExceptionCode.INSTALL_APPS_JOB_ENQUEUE_FAILED,
      );
    }
  }

  private async releaseInstallAppsOnboardingStepClaim({
    userId,
    workspaceId,
  }: OnboardingContext) {
    try {
      await this.runStepTransitionInLockedTransaction(
        { userId, workspaceId },
        async (queryRunner) =>
          this.setOnboardingInstallAppsPending(
            {
              userId,
              workspaceId,
              value: true,
            },
            queryRunner,
          ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to restore the pending install-apps onboarding step for workspace ${workspaceId}`,
        error,
      );
    }
  }

  async clearReversibleOnboardingStepHistoryAfterAppsInstalled({
    userId,
    workspaceId,
  }: OnboardingContext) {
    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) =>
        this.onboardingHistoryService.clear(
          { userId, workspaceId },
          queryRunner,
        ),
    );
  }

  async creditInstallAppsReward({
    workspaceId,
    rewardAppsCount,
  }: {
    workspaceId: string;
    rewardAppsCount: number;
  }) {
    return this.onboardingRewardService.creditInstallAppsReward({
      workspaceId,
      rewardAppsCount,
    });
  }

  async setOnboardingInviteTeamPending(
    {
      userId,
      workspaceId,
      value,
    }: {
      userId?: string;
      workspaceId: string;
      value: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (!value) {
      await this.userVarsService.delete(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
        },
        queryRunner,
      );

      return;
    }

    await this.userVarsService.set(
      {
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
        value: true,
      },
      queryRunner,
    );
  }

  async creditEnrichmentQualificationReward({
    workspaceId,
    employeeCount,
  }: {
    workspaceId: string;
    employeeCount: number | null;
  }) {
    return this.onboardingRewardService.creditEnrichmentQualificationReward({
      workspaceId,
      employeeCount,
    });
  }

  async isOnboardingBookCallPending({
    userId,
    workspaceId,
  }: OnboardingContext): Promise<boolean> {
    if (
      !isDefined(readBookCallStepMinEmployeeCount(this.twentyConfigService))
    ) {
      return false;
    }

    return (
      (await this.userVarsService.get({
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
      })) === true
    );
  }

  async setOnboardingBookCallPending(
    {
      userId,
      workspaceId,
      value,
    }: {
      userId: string;
      workspaceId: string;
      value: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (!value) {
      await this.userVarsService.delete(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
        },
        queryRunner,
      );

      return;
    }

    await this.userVarsService.set(
      {
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
        value: true,
      },
      queryRunner,
    );
  }

  async completeOnboardingBookCallStep({
    userId,
    workspaceId,
    hasBookedCall,
    isAutoSkipped,
  }: {
    userId: string;
    workspaceId: string;
    hasBookedCall: boolean;
    isAutoSkipped: boolean;
  }) {
    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) => {
        const hasClaimedBookCallStep = await this.claimOnboardingStep(
          {
            userId,
            workspaceId,
            key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
          },
          queryRunner,
        );

        if (!hasClaimedBookCallStep || isAutoSkipped) {
          return;
        }

        if (hasBookedCall) {
          await this.onboardingHistoryService.clear(
            { userId, workspaceId },
            queryRunner,
          );

          return;
        }

        await this.onboardingHistoryService.push(
          { userId, workspaceId },
          OnboardingStatus.BOOK_CALL,
          queryRunner,
        );
      },
    );
  }

  async setOnboardingBookCallPendingIfQualified({
    userId,
    workspaceId,
    employeeCount,
  }: {
    userId: string;
    workspaceId: string;
    employeeCount: number | null;
  }): Promise<boolean> {
    const minEmployeeCount = readBookCallStepMinEmployeeCount(
      this.twentyConfigService,
    );

    if (
      !isDefined(minEmployeeCount) ||
      !isNumber(employeeCount) ||
      employeeCount < minEmployeeCount
    ) {
      return false;
    }

    try {
      return await this.dataSource.transaction(async (entityManager) => {
        const { queryRunner } = entityManager;

        if (!isDefined(queryRunner)) {
          throw new Error('Transaction entity manager has no query runner');
        }

        // Claiming the offer is the single-winner gate: a concurrent enrichment
        // loses the insert and must not resurrect a step the user already skipped.
        const hasClaimedBookCallOffer =
          await this.userVarsService.setIfNotExists(
            {
              userId,
              workspaceId,
              key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_OFFERED,
              value: true,
            },
            queryRunner,
          );

        if (!hasClaimedBookCallOffer) {
          return false;
        }

        await this.setOnboardingBookCallPending(
          {
            userId,
            workspaceId,
            value: true,
          },
          queryRunner,
        );

        return true;
      });
    } catch (error) {
      this.logger.error(
        `Failed to flag the book-call onboarding step for user ${userId} in workspace ${workspaceId}`,
        error,
      );

      return false;
    }
  }

  async setOnboardingCreateProfilePending(
    {
      userId,
      workspaceId,
      value,
    }: {
      userId: string;
      workspaceId: string;
      value: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (!value) {
      await this.userVarsService.delete(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
        },
        queryRunner,
      );

      return;
    }

    await this.userVarsService.set(
      {
        userId,
        workspaceId,
        key: OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
        value: true,
      },
      queryRunner,
    );
  }

  async completeOnboardingProfileStepIfNameProvided({
    userId,
    workspaceId,
    firstName,
    lastName,
  }: {
    userId?: string;
    workspaceId: string;
    firstName?: string;
    lastName?: string;
  }) {
    if (!isDefined(userId)) {
      return;
    }

    const hasProvidedNamePart =
      (isDefined(firstName) && firstName !== '') ||
      (isDefined(lastName) && lastName !== '');
    if (!hasProvidedNamePart) {
      return;
    }

    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) => {
        const hasClaimedCreateProfileStep = await this.claimOnboardingStep(
          {
            userId,
            workspaceId,
            key: OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
          },
          queryRunner,
        );

        if (!hasClaimedCreateProfileStep) {
          return;
        }

        await this.onboardingHistoryService.push(
          { userId, workspaceId },
          OnboardingStatus.PROFILE_CREATION,
          queryRunner,
        );
      },
    );
  }

  async completeOnboardingInviteTeamStep({
    userId,
    workspaceId,
    hasSentInvitations,
  }: {
    userId: string;
    workspaceId: string;
    hasSentInvitations: boolean;
  }) {
    await this.runStepTransitionInLockedTransaction(
      { userId, workspaceId },
      async (queryRunner) => {
        const hasClaimedInviteTeamStep = await this.claimOnboardingStep(
          {
            workspaceId,
            key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
          },
          queryRunner,
        );

        if (!hasClaimedInviteTeamStep) {
          return;
        }

        if (hasSentInvitations) {
          await this.onboardingHistoryService.clear(
            { userId, workspaceId },
            queryRunner,
          );

          return;
        }

        await this.onboardingHistoryService.push(
          { userId, workspaceId },
          OnboardingStatus.INVITE_TEAM,
          queryRunner,
        );
      },
    );
  }
}
