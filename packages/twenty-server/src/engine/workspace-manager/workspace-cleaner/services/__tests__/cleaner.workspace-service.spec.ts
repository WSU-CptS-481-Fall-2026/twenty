import { type Repository } from 'typeorm';

import { type BillingSubscriptionEntity } from 'src/engine/core-modules/billing/entities/billing-subscription.entity';
import { type BillingSubscriptionService } from 'src/engine/core-modules/billing/services/billing-subscription.service';
import { type WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { type EmailService } from 'src/engine/core-modules/email/email.service';
import { type I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { type KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { type MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { MetricsKeys } from 'src/engine/core-modules/metrics/types/metrics-keys.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { type UserService } from 'src/engine/core-modules/user/services/user.service';
import { type UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
import { type WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { USER_WORKSPACE_DELETION_WARNING_SENT_KEY } from 'src/engine/workspace-manager/workspace-cleaner/constants/user-workspace-deletion-warning-sent-key.constant';
import { CleanerWorkspaceService } from 'src/engine/workspace-manager/workspace-cleaner/services/cleaner.workspace-service';

// render() resolves through a streaming scheduler that never advances under the
// globally enabled fake timers; the real render path is covered by
// email-templates-rendering.spec.ts.
jest.mock('twenty-emails', () => ({
  ...jest.requireActual('twenty-emails'),
  renderEmail: jest
    .fn()
    .mockImplementation(async (_template, options) =>
      options?.plainText ? 'plain text' : '<html></html>',
    ),
}));

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * DAY_IN_MILLISECONDS);

const CONFIG: Record<string, unknown> = {
  WORKSPACE_INACTIVE_DAYS_BEFORE_NOTIFICATION: 7,
  WORKSPACE_INACTIVE_DAYS_BEFORE_SOFT_DELETION: 14,
  WORKSPACE_INACTIVE_DAYS_BEFORE_DELETION: 21,
  MAX_NUMBER_OF_WORKSPACES_DELETED_PER_EXECUTION: 2,
  EMAIL_FROM_NAME: 'Twenty',
  EMAIL_FROM_ADDRESS: 'noreply@twenty.com',
  IS_BILLING_ENABLED: true,
};

const buildWorkspace = (overrides: Partial<WorkspaceEntity> = {}) =>
  ({
    id: 'workspace-id',
    displayName: 'Acme',
    suspendedAt: null,
    deletedAt: null,
    ...overrides,
  }) as WorkspaceEntity;

const buildWorkspaceMember = (userId: string, userEmail: string | null) => ({
  userId,
  userEmail,
  locale: 'en',
  name: { firstName: 'Jane', lastName: userId },
});

describe('CleanerWorkspaceService', () => {
  const workspaceService = {
    deleteWorkspace: jest.fn(),
    handleRemoveWorkspaceMember: jest.fn(),
  };
  const twentyConfigService = {
    get: jest.fn((key: string) => CONFIG[key]),
  };
  const userVarsService = {
    set: jest.fn(),
    delete: jest.fn(),
  };
  const userService = {
    loadWorkspaceMembers: jest.fn(),
  };
  const emailService = {
    send: jest.fn(),
  };
  const workspaceRepository = {
    find: jest.fn(),
  };
  const keyValuePairRepository = {
    find: jest.fn(),
  };
  const billingSubscriptionRepository = {
    findOne: jest.fn(),
  };
  const billingSubscriptionService = {
    cancelSubscription: jest.fn(),
    assertSubscriptionCanceledOrNone: jest.fn(),
  };
  const userWorkspaceRepository = {
    find: jest.fn(),
  };
  const i18nService = {
    getI18nInstance: jest.fn(() => ({ _: () => 'translated subject' })),
  };
  const metricsService = {
    incrementCounterForEvent: jest.fn(),
  };
  const workspaceDomainsService = {
    buildWorkspaceURL: jest.fn(
      () => new URL('https://acme.twenty.com/settings/billing'),
    ),
  };

  const createService = () =>
    new CleanerWorkspaceService(
      workspaceService as unknown as WorkspaceService,
      twentyConfigService as unknown as TwentyConfigService,
      userVarsService as unknown as UserVarsService,
      userService as unknown as UserService,
      emailService as unknown as EmailService,
      workspaceRepository as unknown as Repository<WorkspaceEntity>,
      keyValuePairRepository as unknown as Repository<KeyValuePairEntity>,
      billingSubscriptionRepository as unknown as WorkspaceScopedRepository<BillingSubscriptionEntity>,
      billingSubscriptionService as unknown as BillingSubscriptionService,
      userWorkspaceRepository as unknown as Repository<UserWorkspaceEntity>,
      i18nService as unknown as I18nService,
      metricsService as unknown as MetricsService,
      workspaceDomainsService as unknown as WorkspaceDomainsService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(NOW);
    CONFIG.IS_BILLING_ENABLED = true;
    keyValuePairRepository.find.mockResolvedValue([]);
    userService.loadWorkspaceMembers.mockResolvedValue([
      buildWorkspaceMember('user-1', 'one@acme.com'),
      buildWorkspaceMember('user-2', 'two@acme.com'),
    ]);
  });

  describe('batchWarnOrCleanSuspendedWorkspaces', () => {
    it('should warn every member of a workspace suspended past the warning threshold', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(10) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(emailService.send).toHaveBeenCalledTimes(2);
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'one@acme.com',
          from: 'Twenty <noreply@twenty.com>',
          subject: 'translated subject',
        }),
      );
      expect(userVarsService.set).toHaveBeenCalledWith({
        userId: 'user-2',
        workspaceId: 'workspace-id',
        key: USER_WORKSPACE_DELETION_WARNING_SENT_KEY,
        value: true,
      });
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should not warn a workspace that was already warned', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(10) }),
      ]);
      keyValuePairRepository.find.mockResolvedValue([
        { workspaceId: 'workspace-id' },
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('should do nothing for a workspace suspended for less than the warning threshold', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(5) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should do nothing for a workspace without a suspension date', async () => {
      workspaceRepository.find.mockResolvedValue([buildWorkspace()]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(userService.loadWorkspaceMembers).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should email members and soft delete a workspace suspended past the soft deletion threshold', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(20) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(userVarsService.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        workspaceId: 'workspace-id',
        key: USER_WORKSPACE_DELETION_WARNING_SENT_KEY,
      });
      expect(emailService.send).toHaveBeenCalledTimes(2);
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'two@acme.com',
          subject: 'Your workspace has been deleted',
        }),
      );
      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
        true,
      );
    });

    it('should destroy a soft deleted workspace once the grace period has passed', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(30), deletedAt: daysAgo(8) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
      );
      expect(metricsService.incrementCounterForEvent).toHaveBeenCalledWith({
        key: MetricsKeys.CronJobDeletedWorkspace,
        shouldStoreInCache: false,
      });
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('should leave a soft deleted workspace alone during the grace period', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(30), deletedAt: daysAgo(3) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('should destroy a soft deleted workspace during the grace period when told to ignore it', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(30), deletedAt: daysAgo(3) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
        ignoreDestroyGracePeriod: true,
      });

      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
      );
    });

    it('should stop destroying workspaces once the per execution limit is reached', async () => {
      workspaceRepository.find.mockResolvedValue(
        ['workspace-1', 'workspace-2', 'workspace-3'].map((id) =>
          buildWorkspace({
            id,
            suspendedAt: daysAgo(30),
            deletedAt: daysAgo(8),
          }),
        ),
      );

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-1', 'workspace-2', 'workspace-3'],
      });

      expect(workspaceService.deleteWorkspace).toHaveBeenCalledTimes(2);
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalledWith(
        'workspace-3',
      );
    });

    it('should not soft delete again a workspace that is already soft deleted', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(30), deletedAt: daysAgo(8) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
        onlyOperation: 'soft-delete',
      });

      expect(userService.loadWorkspaceMembers).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should only run the selected operation', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(20) }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
        onlyOperation: 'warn',
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should not send emails, write user vars or delete anything during a dry run', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ id: 'warned', suspendedAt: daysAgo(10) }),
        buildWorkspace({ id: 'soft-deleted', suspendedAt: daysAgo(20) }),
        buildWorkspace({
          id: 'destroyed',
          suspendedAt: daysAgo(30),
          deletedAt: daysAgo(8),
        }),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['warned', 'soft-deleted', 'destroyed'],
        dryRun: true,
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(userVarsService.set).not.toHaveBeenCalled();
      expect(userVarsService.delete).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should keep processing other workspaces when one fails', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ id: 'failing', suspendedAt: daysAgo(20) }),
        buildWorkspace({ id: 'working', suspendedAt: daysAgo(20) }),
      ]);
      workspaceService.deleteWorkspace.mockRejectedValueOnce(
        new Error('delete failed'),
      );

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['failing', 'working'],
      });

      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'working',
        true,
      );
    });

    it('should stop warning the remaining members when one member has no email', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(10) }),
      ]);
      userService.loadWorkspaceMembers.mockResolvedValue([
        buildWorkspaceMember('user-1', 'one@acme.com'),
        buildWorkspaceMember('user-2', null),
        buildWorkspaceMember('user-3', 'three@acme.com'),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(emailService.send).toHaveBeenCalledTimes(1);
      expect(userVarsService.set).toHaveBeenCalledTimes(1);
      expect(userVarsService.set).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('should not soft delete the workspace when a member has no email', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ suspendedAt: daysAgo(20) }),
      ]);
      userService.loadWorkspaceMembers.mockResolvedValue([
        buildWorkspaceMember('user-1', null),
      ]);

      await createService().batchWarnOrCleanSuspendedWorkspaces({
        workspaceIds: ['workspace-id'],
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('batchCleanOnboardingWorkspaces', () => {
    beforeEach(() => {
      userWorkspaceRepository.find.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
    });

    it('should remove members, cancel billing and soft delete a workspace that is not deleted yet', async () => {
      workspaceRepository.find.mockResolvedValue([buildWorkspace()]);

      await createService().batchCleanOnboardingWorkspaces(['workspace-id']);

      expect(workspaceService.handleRemoveWorkspaceMember).toHaveBeenCalledWith(
        'workspace-id',
        'user-1',
      );
      expect(workspaceService.handleRemoveWorkspaceMember).toHaveBeenCalledWith(
        'workspace-id',
        'user-2',
      );
      expect(
        billingSubscriptionService.cancelSubscription,
      ).toHaveBeenCalledWith('workspace-id');
      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
        true,
      );
    });

    it('should not touch billing when billing is disabled', async () => {
      CONFIG.IS_BILLING_ENABLED = false;
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace(),
        buildWorkspace({ id: 'soft-deleted', deletedAt: daysAgo(1) }),
      ]);

      await createService().batchCleanOnboardingWorkspaces([
        'workspace-id',
        'soft-deleted',
      ]);

      expect(
        billingSubscriptionService.cancelSubscription,
      ).not.toHaveBeenCalled();
      expect(
        billingSubscriptionService.assertSubscriptionCanceledOrNone,
      ).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).toHaveBeenCalledTimes(2);
    });

    it('should check billing and hard delete a workspace that is already soft deleted', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ deletedAt: daysAgo(1) }),
      ]);

      await createService().batchCleanOnboardingWorkspaces(['workspace-id']);

      expect(
        billingSubscriptionService.assertSubscriptionCanceledOrNone,
      ).toHaveBeenCalledWith('workspace-id');
      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
      );
      expect(
        workspaceService.handleRemoveWorkspaceMember,
      ).not.toHaveBeenCalled();
    });

    it('should not delete anything during a dry run', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace(),
        buildWorkspace({ id: 'soft-deleted', deletedAt: daysAgo(1) }),
      ]);

      await createService().batchCleanOnboardingWorkspaces(
        ['workspace-id', 'soft-deleted'],
        true,
      );

      expect(
        workspaceService.handleRemoveWorkspaceMember,
      ).not.toHaveBeenCalled();
      expect(
        billingSubscriptionService.cancelSubscription,
      ).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should do nothing when no onboarding workspace matches', async () => {
      workspaceRepository.find.mockResolvedValue([]);

      await createService().batchCleanOnboardingWorkspaces(['workspace-id']);

      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('destroyBillingDeactivatedAndSoftDeletedWorkspaces', () => {
    it('should skip a workspace that is not soft deleted', async () => {
      workspaceRepository.find.mockResolvedValue([buildWorkspace()]);

      await createService().destroyBillingDeactivatedAndSoftDeletedWorkspaces([
        'workspace-id',
      ]);

      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should skip a workspace with an active billing subscription', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ deletedAt: daysAgo(1) }),
      ]);
      billingSubscriptionRepository.findOne.mockResolvedValue({
        id: 'subscription-id',
      });

      await createService().destroyBillingDeactivatedAndSoftDeletedWorkspaces([
        'workspace-id',
      ]);

      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should destroy a soft deleted workspace without an active subscription', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ deletedAt: daysAgo(1) }),
      ]);
      billingSubscriptionRepository.findOne.mockResolvedValue(null);

      await createService().destroyBillingDeactivatedAndSoftDeletedWorkspaces([
        'workspace-id',
      ]);

      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
      );
    });

    it('should not look up subscriptions when billing is disabled', async () => {
      CONFIG.IS_BILLING_ENABLED = false;
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ deletedAt: daysAgo(1) }),
      ]);

      await createService().destroyBillingDeactivatedAndSoftDeletedWorkspaces([
        'workspace-id',
      ]);

      expect(billingSubscriptionRepository.findOne).not.toHaveBeenCalled();
      expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith(
        'workspace-id',
      );
    });

    it('should not delete anything during a dry run', async () => {
      workspaceRepository.find.mockResolvedValue([
        buildWorkspace({ deletedAt: daysAgo(1) }),
      ]);
      billingSubscriptionRepository.findOne.mockResolvedValue(null);

      await createService().destroyBillingDeactivatedAndSoftDeletedWorkspaces(
        ['workspace-id'],
        true,
      );

      expect(workspaceService.deleteWorkspace).not.toHaveBeenCalled();
    });
  });
});
