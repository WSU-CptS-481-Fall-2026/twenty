import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { type DataSource } from 'typeorm';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { BillingCreditGrantType } from 'src/engine/core-modules/billing/enums/billing-credit-grant-type.enum';
import { BillingCreditService } from 'src/engine/core-modules/billing/services/billing-credit.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { getQueueToken } from 'src/engine/core-modules/message-queue/utils/get-queue-token.util';
import { ONBOARDING_INSTALLABLE_APP_UNIVERSAL_IDENTIFIERS } from 'src/engine/core-modules/onboarding/constants/onboarding-installable-app-universal-identifiers';
import { OnboardingStatus } from 'src/engine/core-modules/onboarding/enums/onboarding-status.enum';
import {
  OnboardingService,
  OnboardingStepKeys,
} from 'src/engine/core-modules/onboarding/onboarding.service';
import { OnboardingHistoryService } from 'src/engine/core-modules/onboarding/services/onboarding-history.service';
import { OnboardingRewardService } from 'src/engine/core-modules/onboarding/services/onboarding-reward.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

describe('OnboardingService', () => {
  let service: OnboardingService;

  const userId = 'user-id';
  const workspaceId = 'workspace-id';
  const creditTiers = {
    midMarket: { minEmployeeCount: 20, amountMicro: 5_000_000 },
  };

  // The book-call step deliberately asks for a far bigger company than the
  // credit reward, so the two bars cannot be confused for one another.
  const bookCallMinEmployeeCount = 200;

  const configValues: Record<string, unknown> = {
    CALENDAR_BOOKING_PAGE_ID: 'team/twenty/talk-to-us',
    ONBOARDING_BOOK_CALL_MIN_EMPLOYEE_COUNT: bookCallMinEmployeeCount,
    ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS: creditTiers,
  };

  const grantCredits = jest.fn();
  const captureExceptions = jest.fn();
  const setIfNotExists = jest.fn();
  const getConfig = jest.fn();
  const get = jest.fn();
  const getAll = jest.fn();
  const set = jest.fn();
  const deleteUserVar = jest.fn();
  const findWorkspace = jest.fn();
  const isSubscriptionIncompleteOnboardingStatus = jest.fn();
  const countWorkspaceUsers = jest.fn();
  const enqueueJob = jest.fn();
  const queryRunner = { query: jest.fn() };

  beforeEach(async () => {
    grantCredits.mockResolvedValue(null);
    setIfNotExists.mockResolvedValue(true);
    getConfig.mockImplementation((key: string) => configValues[key]);
    deleteUserVar.mockResolvedValue(1);
    queryRunner.query.mockResolvedValue(undefined);

    const dataSource = {
      transaction: jest.fn((runInTransaction) =>
        runInTransaction({ queryRunner }),
      ),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        OnboardingHistoryService,
        OnboardingRewardService,
        {
          provide: BillingService,
          useValue: { isSubscriptionIncompleteOnboardingStatus },
        },
        { provide: BillingCreditService, useValue: { grantCredits } },
        {
          provide: ExceptionHandlerService,
          useValue: { captureExceptions },
        },
        {
          provide: UserVarsService,
          useValue: {
            get,
            getAll,
            set,
            delete: deleteUserVar,
            setIfNotExists,
          },
        },
        { provide: TwentyConfigService, useValue: { get: getConfig } },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: { findOne: findWorkspace },
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: { countBy: countWorkspaceUsers },
        },
        {
          provide: getQueueToken(MessageQueue.workspaceQueue),
          useValue: { add: enqueueJob },
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getOnboardingStatus', () => {
    it('returns null when the workspace does not exist', async () => {
      findWorkspace.mockResolvedValue(null);

      await expect(
        service.getOnboardingStatus({ userId, workspaceId }),
      ).resolves.toBeNull();
    });

    it.each([
      WorkspaceActivationStatus.PENDING_CREATION,
      WorkspaceActivationStatus.ONGOING_CREATION,
    ])('prioritizes workspace activation for %s', async (activationStatus) => {
      findWorkspace.mockResolvedValue({ id: workspaceId, activationStatus });

      await expect(
        service.getOnboardingStatus({ userId, workspaceId }),
      ).resolves.toBe(OnboardingStatus.WORKSPACE_ACTIVATION);
      expect(getAll).not.toHaveBeenCalled();
    });

    it.each([
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
    ])('returns the pending status for %s', async (key, status) => {
      findWorkspace.mockResolvedValue({
        id: workspaceId,
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      });
      getAll.mockResolvedValue(new Map([[key, true]]));

      await expect(
        service.getOnboardingStatus({ userId, workspaceId }),
      ).resolves.toBe(status);
      expect(isSubscriptionIncompleteOnboardingStatus).not.toHaveBeenCalled();
    });

    it('prioritizes connect-account over other pending steps', async () => {
      findWorkspace.mockResolvedValue({
        id: workspaceId,
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      });
      getAll.mockResolvedValue(
        new Map([
          [OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING, true],
          [OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING, true],
        ]),
      );

      await expect(
        service.getOnboardingStatus({ userId, workspaceId }),
      ).resolves.toBe(OnboardingStatus.SYNC_EMAIL);
    });

    it.each([
      [true, true, OnboardingStatus.BOOK_CALL],
      [false, true, OnboardingStatus.PLAN_REQUIRED],
      [true, false, OnboardingStatus.COMPLETED],
    ])(
      'handles book-call pending %s and plan required %s',
      async (bookCallPending, planRequired, status) => {
        findWorkspace.mockResolvedValue({
          id: workspaceId,
          activationStatus: WorkspaceActivationStatus.ACTIVE,
        });
        getAll.mockResolvedValue(
          new Map([
            [OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING, bookCallPending],
          ]),
        );
        isSubscriptionIncompleteOnboardingStatus.mockResolvedValue(
          planRequired,
        );

        await expect(
          service.getOnboardingStatus({ userId, workspaceId }),
        ).resolves.toBe(status);
      },
    );

    it('requires a plan when the book-call step is disabled', async () => {
      findWorkspace.mockResolvedValue({
        id: workspaceId,
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      });
      getAll.mockResolvedValue(
        new Map([[OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING, true]]),
      );
      isSubscriptionIncompleteOnboardingStatus.mockResolvedValue(true);
      getConfig.mockImplementation((key: string) =>
        key === 'CALENDAR_BOOKING_PAGE_ID' ? undefined : configValues[key],
      );

      await expect(
        service.getOnboardingStatus({ userId, workspaceId }),
      ).resolves.toBe(OnboardingStatus.PLAN_REQUIRED);
    });
  });

  describe('reversible onboarding steps', () => {
    it.each([
      [
        OnboardingStatus.SYNC_EMAIL,
        OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
      ],
      [
        OnboardingStatus.APPS_INSTALLATION,
        OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
      ],
      [
        OnboardingStatus.PROFILE_CREATION,
        OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
      ],
      [
        OnboardingStatus.INVITE_TEAM,
        OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
      ],
      [
        OnboardingStatus.BOOK_CALL,
        OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
      ],
    ])('restores %s for the user inside the transaction', async (step, key) => {
      get.mockResolvedValue([step]);
      findWorkspace.mockResolvedValue(null);

      await service.goBackToPreviousOnboardingStep({ userId, workspaceId });

      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [],
        },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        { userId, workspaceId, key, value: true },
        queryRunner,
      );
      expect(queryRunner.query).toHaveBeenCalledTimes(2);
    });

    it('rejects going back when there is no previous step', async () => {
      get.mockResolvedValue([]);

      await expect(
        service.goBackToPreviousOnboardingStep({ userId, workspaceId }),
      ).rejects.toThrow('No previous onboarding step');
      expect(set).not.toHaveBeenCalled();
    });

    it('rejects an invalid stored step rather than invoking a handler', async () => {
      get.mockResolvedValue(['constructor']);

      await expect(
        service.goBackToPreviousOnboardingStep({ userId, workspaceId }),
      ).rejects.toThrow("Didn't expect to get here.");
    });

    it('records a manually skipped connect-account step only when claimed', async () => {
      get.mockResolvedValue([]);

      await service.skipOnboardingConnectAccountStep({
        userId,
        workspaceId,
        isAutoSkipped: false,
      });

      expect(deleteUserVar).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
        },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [OnboardingStatus.SYNC_EMAIL],
        },
        queryRunner,
      );
    });

    it('does not record a step when the pending flag was not claimed', async () => {
      deleteUserVar.mockResolvedValue(0);

      await service.skipOnboardingConnectAccountStep({
        userId,
        workspaceId,
        isAutoSkipped: false,
      });

      expect(set).not.toHaveBeenCalled();
    });

    it('does not record automatically skipped steps', async () => {
      await service.skipOnboardingConnectAccountStep({
        userId,
        workspaceId,
        isAutoSkipped: true,
      });

      expect(set).not.toHaveBeenCalled();
    });

    it('records skipped app installation when no eligible apps are selected', async () => {
      get.mockResolvedValue([]);

      await service.triggerInstallAppsOnboardingStep({
        userId,
        workspaceId,
        universalIdentifiers: ['not-installable'],
        isAutoSkipped: false,
      });

      expect(deleteUserVar).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
        },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [OnboardingStatus.APPS_INSTALLATION],
        },
        queryRunner,
      );
      expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('restores the install-apps claim if the job cannot be enqueued', async () => {
      enqueueJob.mockRejectedValue(new Error('queue unavailable'));

      await expect(
        service.triggerInstallAppsOnboardingStep({
          userId,
          workspaceId,
          universalIdentifiers: [
            ONBOARDING_INSTALLABLE_APP_UNIVERSAL_IDENTIFIERS[0],
          ],
          isAutoSkipped: false,
        }),
      ).rejects.toThrow('Failed to enqueue the install onboarding apps job');
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_INSTALL_APPS_PENDING,
          value: true,
        },
        queryRunner,
      );
    });

    it('records profile creation only when a name and a pending claim exist', async () => {
      get.mockResolvedValue([]);

      await service.completeOnboardingProfileStepIfNameProvided({
        userId,
        workspaceId,
        firstName: 'Ada',
      });

      expect(deleteUserVar).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
        },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [OnboardingStatus.PROFILE_CREATION],
        },
        queryRunner,
      );
    });

    it('clears history after booking a call', async () => {
      await service.completeOnboardingBookCallStep({
        userId,
        workspaceId,
        hasBookedCall: true,
        isAutoSkipped: false,
      });

      expect(deleteUserVar).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_BOOK_CALL_PENDING,
        },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [],
        },
        queryRunner,
      );
    });

    it('clears history after apps are installed', async () => {
      await service.clearReversibleOnboardingStepHistoryAfterAppsInstalled({
        userId,
        workspaceId,
      });

      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [],
        },
        queryRunner,
      );
    });

    it('claims invite-team at workspace scope but saves user-scoped history', async () => {
      get.mockResolvedValue([]);

      await service.completeOnboardingInviteTeamStep({
        userId,
        workspaceId,
        hasSentInvitations: false,
      });

      expect(deleteUserVar).toHaveBeenCalledWith(
        { workspaceId, key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING },
        queryRunner,
      );
      expect(set).toHaveBeenCalledWith(
        {
          userId,
          workspaceId,
          key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
          value: [OnboardingStatus.INVITE_TEAM],
        },
        queryRunner,
      );
    });
  });

  describe('onboarding rewards', () => {
    it('grants the import reward only to the first workspace user', async () => {
      countWorkspaceUsers.mockResolvedValue(1);
      getConfig.mockImplementation((key: string) =>
        key === 'ONBOARDING_IMPORT_CONTACTS_CREDITS_REWARD'
          ? 100
          : configValues[key],
      );

      await service.completeOnboardingConnectAccountStep({
        userId,
        workspaceId,
      });

      expect(grantCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          amountMicro: 100,
          idempotencyKey: `onboarding-import-contacts:${workspaceId}`,
        }),
      );
    });

    it('does not grant an import reward for another workspace user', async () => {
      countWorkspaceUsers.mockResolvedValue(2);

      await service.completeOnboardingConnectAccountStep({
        userId,
        workspaceId,
      });

      expect(grantCredits).not.toHaveBeenCalled();
    });

    it('grants an install reward based on the number of installed apps', async () => {
      getConfig.mockImplementation((key: string) =>
        key === 'ONBOARDING_INSTALL_APPS_CREDITS_REWARD_PER_APP'
          ? 100
          : configValues[key],
      );

      await service.creditInstallAppsReward({
        workspaceId,
        rewardAppsCount: 2,
      });

      expect(grantCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          amountMicro: 200,
          idempotencyKey: `onboarding-install-apps:${workspaceId}`,
        }),
      );
    });
  });

  describe('creditEnrichmentQualificationReward', () => {
    it('grants the amount of the tier the enriched company lands in', async () => {
      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: 20,
      });

      expect(grantCredits).toHaveBeenCalledTimes(1);
      expect(grantCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          amountMicro: 5_000_000,
          type: BillingCreditGrantType.ONBOARDING_REWARD,
          idempotencyKey: `onboarding-enrichment-qualified:${workspaceId}`,
        }),
      );
    });

    it('grants nothing to a company below every tier', async () => {
      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: 19,
      });

      expect(grantCredits).not.toHaveBeenCalled();
    });

    it('grants nothing to a workspace enrichment could not match', async () => {
      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: null,
      });

      expect(grantCredits).not.toHaveBeenCalled();
    });

    it('grants nothing while no tier is configured', async () => {
      getConfig.mockImplementation((key: string) =>
        key === 'ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS'
          ? {}
          : configValues[key],
      );

      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: 5000,
      });

      expect(grantCredits).not.toHaveBeenCalled();
    });

    it('swallows a billing failure so enrichment still completes', async () => {
      grantCredits.mockRejectedValue(new Error('billing is down'));

      await expect(
        service.creditEnrichmentQualificationReward({
          workspaceId,
          employeeCount: 5000,
        }),
      ).resolves.toBeUndefined();
    });

    it('reports malformed tiers to Sentry and pays the well-formed ones', async () => {
      getConfig.mockImplementation((key: string) =>
        key === 'ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS'
          ? { broken: { minEmployeeCount: 'twenty' }, ...creditTiers }
          : configValues[key],
      );

      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: 20,
      });

      expect(captureExceptions).toHaveBeenCalledTimes(1);
      expect(captureExceptions.mock.calls[0][0][0].message).toContain('broken');
      expect(grantCredits).toHaveBeenCalledWith(
        expect.objectContaining({ amountMicro: 5_000_000 }),
      );
    });

    it('survives a tier config too malformed to even read, and reports it', async () => {
      // The JSON config transformer throws rather than returning a value when
      // the configured tiers are not a parseable object.
      getConfig.mockImplementation((key: string) => {
        if (key === 'ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS') {
          throw new Error('Failed to parse JSON string');
        }

        return configValues[key];
      });

      await expect(
        service.creditEnrichmentQualificationReward({
          workspaceId,
          employeeCount: 20,
        }),
      ).resolves.toBeUndefined();

      expect(grantCredits).not.toHaveBeenCalled();
      expect(captureExceptions).toHaveBeenCalledTimes(1);
    });

    it('grants credits even when the book-a-call step is switched off', async () => {
      getConfig.mockImplementation((key: string) =>
        key === 'CALENDAR_BOOKING_PAGE_ID' ||
        key === 'ONBOARDING_BOOK_CALL_MIN_EMPLOYEE_COUNT'
          ? undefined
          : configValues[key],
      );

      await service.creditEnrichmentQualificationReward({
        workspaceId,
        employeeCount: 20,
      });

      expect(grantCredits).toHaveBeenCalledWith(
        expect.objectContaining({ amountMicro: 5_000_000 }),
      );
    });
  });

  describe('setOnboardingBookCallPendingIfQualified', () => {
    it('offers the call without granting credits', async () => {
      const hasQualified =
        await service.setOnboardingBookCallPendingIfQualified({
          userId,
          workspaceId,
          employeeCount: bookCallMinEmployeeCount,
        });

      expect(hasQualified).toBe(true);
      expect(grantCredits).not.toHaveBeenCalled();
    });

    it('withholds the call from a company that only clears the credit tier', async () => {
      const hasQualified =
        await service.setOnboardingBookCallPendingIfQualified({
          userId,
          workspaceId,
          employeeCount: 20,
        });

      expect(hasQualified).toBe(false);
    });
  });
});
