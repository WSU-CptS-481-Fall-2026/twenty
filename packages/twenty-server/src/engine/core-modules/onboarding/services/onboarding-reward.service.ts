import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { BillingCreditGrantType } from 'src/engine/core-modules/billing/enums/billing-credit-grant-type.enum';
import { BillingCreditService } from 'src/engine/core-modules/billing/services/billing-credit.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { getOnboardingEnrichmentCreditRewardMicro } from 'src/engine/core-modules/onboarding/utils/get-onboarding-enrichment-credit-reward-micro.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';

@Injectable()
export class OnboardingRewardService {
  private readonly logger = new Logger(OnboardingRewardService.name);

  constructor(
    private readonly billingCreditService: BillingCreditService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {}

  async creditImportContactsRewardForFirstWorkspaceUser({
    workspaceId,
  }: {
    workspaceId: string;
  }) {
    try {
      const workspaceUserCount = await this.userWorkspaceRepository.countBy({
        workspaceId,
      });

      if (workspaceUserCount !== 1) {
        return;
      }

      await this.billingCreditService.grantCredits({
        workspaceId,
        amountMicro: this.twentyConfigService.get(
          'ONBOARDING_IMPORT_CONTACTS_CREDITS_REWARD',
        ),
        type: BillingCreditGrantType.ONBOARDING_REWARD,
        reason: 'Onboarding reward: import contacts',
        idempotencyKey: `onboarding-import-contacts:${workspaceId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to credit onboarding import-contacts reward for workspace ${workspaceId}`,
        error,
      );
    }
  }

  async creditInstallAppsReward({
    workspaceId,
    rewardAppsCount,
  }: {
    workspaceId: string;
    rewardAppsCount: number;
  }) {
    try {
      await this.billingCreditService.grantCredits({
        workspaceId,
        amountMicro:
          this.twentyConfigService.get(
            'ONBOARDING_INSTALL_APPS_CREDITS_REWARD_PER_APP',
          ) * rewardAppsCount,
        type: BillingCreditGrantType.ONBOARDING_REWARD,
        reason: `Onboarding reward: install ${rewardAppsCount} app(s)`,
        idempotencyKey: `onboarding-install-apps:${workspaceId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to credit onboarding install-apps reward for workspace ${workspaceId}`,
        error,
      );
    }
  }

  async creditEnrichmentQualificationReward({
    workspaceId,
    employeeCount,
  }: {
    workspaceId: string;
    employeeCount: number | null;
  }) {
    // Invalid tier configuration must not interrupt onboarding.
    try {
      const { amountMicro, malformedTierKeys } =
        getOnboardingEnrichmentCreditRewardMicro({
          employeeCount,
          tiers: this.twentyConfigService.get(
            'ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS',
          ),
        });

      if (malformedTierKeys.length > 0) {
        this.exceptionHandlerService.captureExceptions([
          new Error(
            `Ignored malformed ONBOARDING_ENRICHMENT_CREDIT_REWARD_TIERS entries: ${malformedTierKeys.join(', ')}`,
          ),
        ]);
      }

      if (!isDefined(amountMicro)) {
        return;
      }

      await this.billingCreditService.grantCredits({
        workspaceId,
        amountMicro,
        type: BillingCreditGrantType.ONBOARDING_REWARD,
        reason: 'Onboarding reward: enrichment-qualified workspace',
        // The workspace-scoped key prevents duplicate rewards across users.
        idempotencyKey: `onboarding-enrichment-qualified:${workspaceId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to credit onboarding enrichment qualification reward for workspace ${workspaceId}`,
        error,
      );

      this.exceptionHandlerService.captureExceptions([error], {
        workspace: { id: workspaceId },
      });
    }
  }
}
