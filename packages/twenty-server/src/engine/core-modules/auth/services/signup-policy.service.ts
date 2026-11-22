import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { Repository } from 'typeorm';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY } from 'src/engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants';
import { type ExistingUserOrPartialUserWithPicture } from 'src/engine/core-modules/auth/types/signInUp.type';
import { getSignUpWithoutWorkspaceDecision } from 'src/engine/core-modules/auth/utils/get-sign-up-without-workspace-decision.util';
import { hasProvisionedSignUpDestination } from 'src/engine/core-modules/auth/utils/has-provisioned-sign-up-destination.util';
import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceInvitationService } from 'src/engine/core-modules/workspace-invitation/services/workspace-invitation.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class SignupPolicyService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceInvitationService: WorkspaceInvitationService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly enterprisePlanService: EnterprisePlanService,
  ) {}

  private async isSignUpEnabled(): Promise<boolean> {
    const workspaceCount = await this.workspaceRepository.count();

    return (
      this.twentyConfigService.get('IS_MULTIWORKSPACE_ENABLED') ||
      workspaceCount === 0
    );
  }

  private async assertSignUpEnabled(): Promise<void> {
    if (!(await this.isSignUpEnabled())) {
      throw new AuthException(
        'New workspace setup is disabled',
        AuthExceptionCode.SIGNUP_DISABLED,
      );
    }
  }

  // Enforced here rather than at workspace creation so a restricted instance
  // stops accumulating verified users that can never reach a workspace.
  async assertSignUpWithoutWorkspaceAllowed(email: string): Promise<void> {
    const decision = getSignUpWithoutWorkspaceDecision({
      isMultiWorkspaceEnabled: this.twentyConfigService.get(
        'IS_MULTIWORKSPACE_ENABLED',
      ),
      isWorkspaceCreationLimitedToServerAdmins: this.twentyConfigService.get(
        'IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS',
      ),
      workspaceCount: await this.workspaceRepository.count(),
    });

    if (decision === 'allowed') {
      return;
    }

    if (
      decision === 'requiresDestination' &&
      (await this.hasProvisionedDestination(email))
    ) {
      return;
    }

    throw new AuthException(
      'New workspace setup is disabled',
      AuthExceptionCode.SIGNUP_DISABLED,
    );
  }

  private async hasProvisionedDestination(email: string): Promise<boolean> {
    // Invitations are read directly instead of through the sign-in picker,
    // which hides HIDDEN workspaces: that is a listing rule, not a statement
    // that the invitee has nowhere to land.
    const invitations =
      await this.workspaceInvitationService.findInvitationsByEmail(email);

    if (hasProvisionedSignUpDestination(invitations)) {
      return true;
    }

    const { availableWorkspacesForSignUp } =
      await this.userWorkspaceService.findAvailableWorkspacesByEmail(email);

    return hasProvisionedSignUpDestination(availableWorkspacesForSignUp);
  }

  async hasServerAdmin(): Promise<boolean> {
    const adminCount = await this.userRepository.count({
      where: { canAccessFullAdminPanel: true },
    });

    return adminCount > 0;
  }

  async assertWorkspaceCreationAllowed(
    userData: ExistingUserOrPartialUserWithPicture['userData'],
  ): Promise<void> {
    await this.assertSignUpEnabled();

    const workspaceCount = await this.workspaceRepository.count();

    if (workspaceCount === 0) {
      return;
    }

    await this.assertWorkspaceCountWithinLimit(workspaceCount);

    if (
      !this.twentyConfigService.get(
        'IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS',
      )
    ) {
      return;
    }

    const isExistingAdmin =
      userData.type === 'existingUser' &&
      userData.existingUser.canAccessFullAdminPanel;

    if (isExistingAdmin) {
      return;
    }

    throw new AuthException(
      'Workspace creation is restricted to admins',
      AuthExceptionCode.FORBIDDEN_EXCEPTION,
      {
        userFriendlyMessage: msg`Workspace creation is restricted to admins`,
      },
    );
  }

  private async assertWorkspaceCountWithinLimit(
    workspaceCount: number,
  ): Promise<void> {
    if (this.enterprisePlanService.isValid()) {
      return;
    }

    if (workspaceCount < MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY) {
      return;
    }

    throw new AuthException(
      `Cannot create more than ${MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY} workspaces without a valid enterprise key`,
      AuthExceptionCode.FORBIDDEN_EXCEPTION,
      {
        userFriendlyMessage: msg`Workspace limit reached. A valid enterprise key is required to create more workspaces.`,
      },
    );
  }
}
