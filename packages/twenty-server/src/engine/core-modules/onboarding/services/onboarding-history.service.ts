import { Injectable } from '@nestjs/common';

import { type QueryRunner } from 'typeorm';

import { type OnboardingContext } from 'src/engine/core-modules/onboarding/types/onboarding-context.type';
import {
  type OnboardingKeyValueTypeMap,
  OnboardingStepKeys,
} from 'src/engine/core-modules/onboarding/types/onboarding-key-value.type';
import { type ReversibleOnboardingStep } from 'src/engine/core-modules/onboarding/types/reversible-onboarding-step.type';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';

@Injectable()
export class OnboardingHistoryService {
  constructor(
    private readonly userVarsService: UserVarsService<OnboardingKeyValueTypeMap>,
  ) {}

  async get(context: OnboardingContext): Promise<ReversibleOnboardingStep[]> {
    const history = await this.userVarsService.get({
      ...context,
      key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
    });

    return Array.isArray(history) ? history : [];
  }

  async set(
    context: OnboardingContext,
    history: ReversibleOnboardingStep[],
    queryRunner?: QueryRunner,
  ) {
    await this.userVarsService.set(
      {
        ...context,
        key: OnboardingStepKeys.ONBOARDING_REVERSIBLE_STEP_HISTORY,
        value: history,
      },
      queryRunner,
    );
  }

  async push(
    context: OnboardingContext,
    step: ReversibleOnboardingStep,
    queryRunner?: QueryRunner,
  ) {
    const history = await this.get(context);

    await this.set(context, [...history, step], queryRunner);
  }

  async clear(context: OnboardingContext, queryRunner?: QueryRunner) {
    await this.set(context, [], queryRunner);
  }
}
