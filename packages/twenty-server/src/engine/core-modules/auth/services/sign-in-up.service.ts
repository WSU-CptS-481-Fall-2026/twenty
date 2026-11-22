import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import {
  QueryFailedError,
  Repository,
  type DataSource,
  type QueryRunner,
} from 'typeorm';
import { v4 } from 'uuid';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { USER_SIGNUP_EVENT_NAME } from 'src/engine/api/graphql/workspace-query-runner/constants/user-signup-event-name.constants';
import { type QueryFailedErrorWithCode } from 'src/engine/api/graphql/workspace-query-runner/utils/workspace-query-runner-graphql-api-exception-handler.util';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { USER_SIGNUP_EVENT } from 'src/engine/core-modules/event-logs/emit/events/workspace-event/user/user-signup';
import { WORKSPACE_CREATED_EVENT } from 'src/engine/core-modules/event-logs/emit/events/workspace-event/workspace/workspace-created';
import {
  type AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { BillingCreditGrantType } from 'src/engine/core-modules/billing/enums/billing-credit-grant-type.enum';
import { BillingCreditService } from 'src/engine/core-modules/billing/services/billing-credit.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import {
  PASSWORD_REGEX,
  compareHash,
  hashPassword,
} from 'src/engine/core-modules/auth/auth.util';
import { SignupOnboardingInitializationService } from 'src/engine/core-modules/auth/services/signup-onboarding-initialization.service';
import { SignupPolicyService } from 'src/engine/core-modules/auth/services/signup-policy.service';
import { SignupWorkspaceCreationService } from 'src/engine/core-modules/auth/services/signup-workspace-creation.service';
import { SignupWorkspaceLogoService } from 'src/engine/core-modules/auth/services/signup-workspace-logo.service';
import {
  type AuthProviderWithPasswordType,
  type ExistingUserOrPartialUserWithPicture,
  type PartialUserWithPicture,
  type SignInUpBaseParams,
  type SignInUpNewUserPayload,
} from 'src/engine/core-modules/auth/types/signInUp.type';
import { SubdomainManagerService } from 'src/engine/core-modules/domain/subdomain-manager/services/subdomain-manager.service';
import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { MetricsKeys } from 'src/engine/core-modules/metrics/types/metrics-keys.type';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { TelemetryEventType } from 'src/engine/core-modules/telemetry/telemetry-event.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceInvitationService } from 'src/engine/core-modules/workspace-invitation/services/workspace-invitation.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceException,
  WorkspaceExceptionCode,
} from 'src/engine/core-modules/workspace/workspace.exception';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { isWorkEmail } from 'src/utils/is-work-email';

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class SignInUpService {
  private readonly logger = new Logger(SignInUpService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly workspaceInvitationService: WorkspaceInvitationService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly onboardingService: OnboardingService,
    private readonly signupOnboardingInitializationService: SignupOnboardingInitializationService,
    private readonly signupPolicyService: SignupPolicyService,
    private readonly signupWorkspaceCreationService: SignupWorkspaceCreationService,
    private readonly signupWorkspaceLogoService: SignupWorkspaceLogoService,
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly subdomainManagerService: SubdomainManagerService,
    private readonly userService: UserService,
    private readonly metricsService: MetricsService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly eventLogEmitterService: EventLogEmitterService,
    private readonly billingCreditService: BillingCreditService,
    private readonly billingService: BillingService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async computePartialUserFromUserPayload(
    newUserPayload: SignInUpNewUserPayload,
    authParams: AuthProviderWithPasswordType['authParams'],
  ): Promise<PartialUserWithPicture> {
    if (!newUserPayload?.email) {
      throw new AuthException(
        'Email is required',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`Email is required`,
        },
      );
    }

    const partialNewUser: PartialUserWithPicture = {
      email: newUserPayload.email,
      firstName: newUserPayload.firstName ?? '',
      lastName: newUserPayload.lastName ?? '',
      picture: newUserPayload.picture ?? '',
      locale: newUserPayload.locale ?? 'en',
      isEmailVerified: newUserPayload.isEmailAlreadyVerified,
    };

    if (authParams.provider === AuthProviderEnum.Password) {
      partialNewUser.passwordHash = await this.generateHash(
        authParams.password,
      );
    }

    return partialNewUser;
  }

  async signInUp(
    params: SignInUpBaseParams &
      ExistingUserOrPartialUserWithPicture &
      AuthProviderWithPasswordType,
  ) {
    if (params.workspace && params.invitation) {
      return {
        workspace: params.workspace,
        user: await this.signInUpWithPersonalInvitation({
          invitation: params.invitation,
          userData: params.userData,
        }),
      };
    }

    if (params.workspace) {
      const updatedUser = await this.signInUpOnExistingWorkspace({
        workspace: params.workspace,
        userData: params.userData,
      });

      return { user: updatedUser, workspace: params.workspace };
    }

    return await this.signUpOnNewWorkspace(params.userData);
  }

  async generateHash(password: string) {
    const isPasswordValid = PASSWORD_REGEX.test(password);

    if (!isPasswordValid) {
      throw new AuthException(
        'Password too weak',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`Password too weak`,
        },
      );
    }

    return await hashPassword(password);
  }

  async validatePassword({
    password,
    passwordHash,
  }: {
    password: string;
    passwordHash: string;
  }) {
    const isValid = await compareHash(password, passwordHash);

    if (!isValid) {
      throw new AuthException(
        'Wrong password',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
        {
          userFriendlyMessage: msg`Wrong password`,
        },
      );
    }
  }

  private async signInUpWithPersonalInvitation(
    params: {
      invitation: AppTokenEntity;
    } & ExistingUserOrPartialUserWithPicture,
  ) {
    if (!params.invitation) {
      throw new AuthException(
        'Invitation not found',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const { workspace, email } = await this.validateSignupInvitation(params);

    const updatedUser = await this.signInUpOnExistingWorkspace({
      workspace,
      userData: params.userData,
      roleId: params.invitation.context?.roleId,
    });

    if (
      params.invitation.type === AppTokenType.OnboardingInvitationToken &&
      params.userData.type === 'newUserWithPicture'
    ) {
      await this.grantInvitationReward(workspace.id, updatedUser.id);
    }

    await this.workspaceInvitationService.invalidateWorkspaceInvitation(
      workspace.id,
      email,
    );

    await this.userService.markEmailAsVerified(updatedUser.id);

    return updatedUser;
  }

  private async validateSignupInvitation(
    params: {
      invitation: AppTokenEntity;
    } & ExistingUserOrPartialUserWithPicture,
  ) {
    const email =
      params.userData.type === 'newUserWithPicture'
        ? params.userData.newUserWithPicture.email
        : params.userData.existingUser.email;

    if (!email) {
      throw new AuthException(
        'Email is required',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`Email is required`,
        },
      );
    }

    const invitationValidation =
      await this.workspaceInvitationService.validatePersonalInvitation({
        workspacePersonalInviteToken: params.invitation.value,
        email,
      });

    if (!invitationValidation?.isValid) {
      throw new AuthException(
        'Invitation not found',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    return { workspace: invitationValidation.workspace, email };
  }

  private async grantInvitationReward(workspaceId: string, userId: string) {
    try {
      await this.billingCreditService.grantCredits({
        workspaceId,
        amountMicro: this.twentyConfigService.get(
          'ONBOARDING_INVITE_TEAM_CREDITS_REWARD_PER_USER',
        ),
        type: BillingCreditGrantType.ONBOARDING_REWARD,
        reason: 'Onboarding reward: invited teammate signed up',
        idempotencyKey: `onboarding-invite-team:${workspaceId}:${userId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to credit onboarding invite reward for workspace ${workspaceId}`,
        error,
      );
    }
  }

  private async throwIfWorkspaceIsNotReadyForSignInUp(
    workspace: WorkspaceEntity,
    user: ExistingUserOrPartialUserWithPicture,
  ) {
    if (
      workspace.activationStatus === WorkspaceActivationStatus.ACTIVE ||
      workspace.activationStatus === WorkspaceActivationStatus.CREATED
    ) {
      return;
    }

    if (user.userData.type !== 'existingUser') {
      throw new AuthException(
        'Workspace is not ready to welcome new members',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
        {
          userFriendlyMessage: msg`Workspace is not ready to welcome new members`,
        },
      );
    }

    const userWorkspaceExists =
      await this.userWorkspaceService.checkUserWorkspaceExists(
        user.userData.existingUser.id,
        workspace.id,
      );

    if (!userWorkspaceExists) {
      throw new AuthException(
        'Workspace is not ready to welcome new members',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
        {
          userFriendlyMessage: msg`Workspace is not ready to welcome new members`,
        },
      );
    }
  }

  async signInUpOnExistingWorkspace(
    params: {
      workspace: WorkspaceEntity;
      roleId?: string | null;
    } & ExistingUserOrPartialUserWithPicture,
  ) {
    await this.throwIfWorkspaceIsNotReadyForSignInUp(params.workspace, params);

    const isNewUser = params.userData.type === 'newUserWithPicture';

    if (isNewUser) {
      const userData = params.userData as {
        type: 'newUserWithPicture';
        newUserWithPicture: PartialUserWithPicture;
      };

      const user = await this.saveNewUser(userData.newUserWithPicture, {
        canAccessFullAdminPanel: false,
        canImpersonate: false,
      });

      await this.signupOnboardingInitializationService.activateOnboardingForUser(
        {
          user,
          workspace: params.workspace,
          shouldShowConnectAccountStep: true,
          shouldShowInstallAppsStep: false,
        },
      );

      await this.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(
        user,
        params.workspace,
        params.roleId,
      );

      return user;
    }

    const userData = params.userData as {
      type: 'existingUser';
      existingUser: UserEntity;
    };

    const user = userData.existingUser;

    await this.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(
      user,
      params.workspace,
      params.roleId,
    );

    return user;
  }

  private async saveNewUser(
    newUserWithPicture: PartialUserWithPicture,
    {
      canImpersonate,
      canAccessFullAdminPanel,
    }: {
      canImpersonate: boolean;
      canAccessFullAdminPanel: boolean;
    },
    queryRunner?: QueryRunner,
  ) {
    const userCreated = this.userRepository.create({
      ...newUserWithPicture,
      canImpersonate,
      canAccessFullAdminPanel,
    });

    const savedUser = queryRunner
      ? await queryRunner.manager.save(UserEntity, userCreated)
      : await this.userRepository.save(userCreated);

    this.workspaceEventEmitter.emitCustomBatchEvent<TelemetryEventType>(
      USER_SIGNUP_EVENT_NAME,
      [
        {
          workspaceId: savedUser.currentWorkspace?.id,
          userWorkspaceId: savedUser.currentUserWorkspace?.id,
          userId: savedUser.id,
          userEmail: newUserWithPicture.email,
          userFirstName: newUserWithPicture.firstName,
          userLastName: newUserWithPicture.lastName,
          locale: newUserWithPicture.locale,
          serverUrl: this.twentyConfigService.get('SERVER_URL'),
          serverId: this.twentyConfigService.get('SERVER_ID'),
        },
      ],
      undefined,
    );

    void this.eventLogEmitterService
      .createContext({
        workspaceId: savedUser.currentWorkspace?.id,
        userId: savedUser.id,
      })
      .insertWorkspaceEvent(USER_SIGNUP_EVENT, {});

    void this.metricsService.incrementCounterForEvent({
      key: MetricsKeys.SignUpSuccess,
      shouldStoreInCache: false,
    });

    return savedUser;
  }

  async signUpOnNewWorkspace(
    userData: ExistingUserOrPartialUserWithPicture['userData'],
    options?: { displayName?: string; subdomain?: string },
  ) {
    const email =
      userData.type === 'newUserWithPicture'
        ? userData.newUserWithPicture.email
        : userData.existingUser.email;

    if (!email) {
      throw new AuthException(
        'Email is required',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`Email is required`,
        },
      );
    }

    await this.signupPolicyService.assertWorkspaceCreationAllowed(userData);

    const displayName = options?.displayName?.trim();

    if (!displayName) {
      throw new AuthException(
        'Workspace name is required',
        AuthExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: msg`Workspace name is required`,
        },
      );
    }

    const requestedSubdomain = options?.subdomain;

    if (isDefined(requestedSubdomain)) {
      await this.subdomainManagerService.validateSubdomainOrThrow(
        requestedSubdomain,
      );
    }

    const shouldGrantServerAdmin =
      !(await this.signupPolicyService.hasServerAdmin());

    const isWorkEmailFound = isWorkEmail(email);

    const workspaceId = v4();
    const workspaceCustomApplicationId = v4();

    try {
      const { user, workspace, customApplicationUniversalIdentifier } =
        await this.dataSource.transaction(async (entityManager) => {
          const queryRunner = entityManager.queryRunner as QueryRunner;

          const { workspace, customApplication } =
            await this.signupWorkspaceCreationService.createSignupWorkspace({
              workspaceId,
              workspaceCustomApplicationId,
              requestedSubdomain,
              displayName,
              email,
              isWorkEmailFound,
              queryRunner,
            });

          const isExistingUser = userData.type === 'existingUser';
          const user = isExistingUser
            ? userData.existingUser
            : await this.saveNewUser(
                userData.newUserWithPicture,
                {
                  canImpersonate: shouldGrantServerAdmin,
                  canAccessFullAdminPanel: shouldGrantServerAdmin,
                },
                queryRunner,
              );

          await this.userWorkspaceService.create(
            {
              userId: user.id,
              workspaceId: workspace.id,
              isExistingUser,
              pictureUrl: isExistingUser
                ? undefined
                : userData.newUserWithPicture.picture,
              applicationUniversalIdentifier:
                customApplication.universalIdentifier,
              locale: user.locale,
            },
            queryRunner,
          );

          await this.signupOnboardingInitializationService.activateOnboardingForUser(
            {
              user,
              workspace,
              shouldShowConnectAccountStep: true,
              shouldShowInstallAppsStep: true,
            },
            queryRunner,
          );

          await this.onboardingService.setOnboardingInviteTeamPending(
            {
              workspaceId: workspace.id,
              value: true,
            },
            queryRunner,
          );

          await this.signupWorkspaceCreationService.recordSignupDpa({
            workspaceId: workspace.id,
            userId: user.id,
            email,
            queryRunner,
          });

          return {
            user,
            workspace,
            customApplicationUniversalIdentifier:
              customApplication.universalIdentifier,
          };
        });

      if (isWorkEmailFound) {
        const inferredLogoFileId =
          await this.signupWorkspaceLogoService.uploadInferredWorkspaceLogo({
            email,
            workspaceId,
            applicationUniversalIdentifier:
              customApplicationUniversalIdentifier,
          });

        if (isDefined(inferredLogoFileId)) {
          workspace.logoFileId = inferredLogoFileId;
        }
      }

      void this.eventLogEmitterService
        .createContext({ workspaceId })
        .insertWorkspaceEvent(WORKSPACE_CREATED_EVENT, {});

      if (this.billingService.isBillingEnabled()) {
        await this.billingService.ensureBillingCustomer({
          userEmail: email,
          workspaceId: workspace.id,
          workspaceDisplayName: workspace.displayName,
        });
      }

      return { user, workspace };
    } catch (error) {
      const isSubdomainConflict =
        error instanceof QueryFailedError &&
        (error as QueryFailedErrorWithCode).code ===
          POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION;

      if (isDefined(requestedSubdomain) && isSubdomainConflict) {
        throw new WorkspaceException(
          'Subdomain already taken',
          WorkspaceExceptionCode.SUBDOMAIN_ALREADY_TAKEN,
        );
      }

      throw error;
    } finally {
      await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
        'flatApplicationMaps',
      ]);
    }
  }

  async signUpWithoutWorkspace(
    newUserParams: SignInUpNewUserPayload,
    authParams: AuthProviderWithPasswordType['authParams'],
  ) {
    const userExists = await this.userService.findUserByEmail(
      newUserParams.email,
    );

    if (userExists) {
      throw new AuthException(
        'User already exists',
        AuthExceptionCode.USER_ALREADY_EXISTS,
        { userFriendlyMessage: msg`User already exists` },
      );
    }

    await this.signupPolicyService.assertSignUpWithoutWorkspaceAllowed(
      newUserParams.email,
    );

    const shouldGrantServerAdmin =
      !(await this.signupPolicyService.hasServerAdmin());

    return this.saveNewUser(
      await this.computePartialUserFromUserPayload(newUserParams, authParams),
      {
        canImpersonate: shouldGrantServerAdmin,
        canAccessFullAdminPanel: shouldGrantServerAdmin,
      },
    );
  }
}
