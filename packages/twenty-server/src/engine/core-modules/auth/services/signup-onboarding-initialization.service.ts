import { Injectable } from '@nestjs/common';

import { type QueryRunner } from 'typeorm';

import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class SignupOnboardingInitializationService {
  constructor(private readonly onboardingService: OnboardingService) {}

  async activateOnboardingForUser(
    {
      user,
      workspace,
      shouldShowConnectAccountStep,
      shouldShowInstallAppsStep,
    }: {
      user: Pick<UserEntity, 'id' | 'firstName' | 'lastName'>;
      workspace: WorkspaceEntity;
      shouldShowConnectAccountStep: boolean;
      shouldShowInstallAppsStep: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    if (shouldShowConnectAccountStep) {
      await this.onboardingService.setOnboardingConnectAccountPending(
        {
          userId: user.id,
          workspaceId: workspace.id,
          value: true,
        },
        queryRunner,
      );
    }

    await this.onboardingService.setOnboardingCreateProfilePending(
      {
        userId: user.id,
        workspaceId: workspace.id,
        value: true,
      },
      queryRunner,
    );

    if (shouldShowInstallAppsStep) {
      await this.onboardingService.setOnboardingInstallAppsPending(
        {
          userId: user.id,
          workspaceId: workspace.id,
          value: true,
        },
        queryRunner,
      );
    }
  }
}
