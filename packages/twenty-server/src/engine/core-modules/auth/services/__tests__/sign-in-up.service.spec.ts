import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import {
  AppTokenType,
  type AppTokenEntity,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { BillingCreditService } from 'src/engine/core-modules/billing/services/billing-credit.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { DpaAgreementEntity } from 'src/engine/core-modules/dpa/entities/dpa-agreement.entity';
import { SubdomainManagerService } from 'src/engine/core-modules/domain/subdomain-manager/services/subdomain-manager.service';
import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceInvitationService } from 'src/engine/core-modules/workspace-invitation/services/workspace-invitation.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

describe('SignInUpService', () => {
  let service: SignInUpService;

  const user = {
    id: 'user-id',
    email: 'person@acme-corporation.invalid',
    firstName: 'First',
    lastName: 'Last',
    locale: 'en',
    canAccessFullAdminPanel: false,
  } as UserEntity;
  const workspace = {
    id: 'workspace-id',
    displayName: 'Workspace',
    activationStatus: WorkspaceActivationStatus.ACTIVE,
  } as WorkspaceEntity;
  const newUser = {
    type: 'newUserWithPicture' as const,
    newUserWithPicture: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
    },
  };
  const existingUser = { type: 'existingUser' as const, existingUser: user };
  const authParams = { provider: AuthProviderEnum.Google };

  const userRepository = {
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
  };
  const workspaceRepository = {
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const invitation = {
    validatePersonalInvitation: jest.fn(),
    invalidateWorkspaceInvitation: jest.fn(),
    findInvitationsByEmail: jest.fn(),
  };
  const userWorkspace = {
    addUserToWorkspaceIfUserNotInWorkspace: jest.fn(),
    checkUserWorkspaceExists: jest.fn(),
    findAvailableWorkspacesByEmail: jest.fn(),
    create: jest.fn(),
  };
  const onboarding = {
    setOnboardingConnectAccountPending: jest.fn(),
    setOnboardingCreateProfilePending: jest.fn(),
    setOnboardingInstallAppsPending: jest.fn(),
    setOnboardingInviteTeamPending: jest.fn(),
  };
  const config = { get: jest.fn() };
  const subdomain = {
    validateSubdomainOrThrow: jest.fn(),
    generateSubdomain: jest.fn(),
  };
  const users = { findUserByEmail: jest.fn(), markEmailAsVerified: jest.fn() };
  const cache = { invalidateAndRecompute: jest.fn() };
  const application = { createWorkspaceCustomApplication: jest.fn() };
  const picture = {
    uploadWorkspaceLogoFromUrl: jest.fn(),
    deleteCorePicture: jest.fn(),
  };
  const exceptionHandler = { captureExceptions: jest.fn() };
  const enterprise = { isValid: jest.fn() };
  const eventLog = {
    createContext: jest.fn(),
    insertWorkspaceEvent: jest.fn(),
  };
  const billingCredit = { grantCredits: jest.fn() };
  const billing = {
    isBillingEnabled: jest.fn(),
    ensureBillingCustomer: jest.fn(),
  };
  const metrics = { incrementCounterForEvent: jest.fn() };
  const emitter = { emitCustomBatchEvent: jest.fn() };
  const queryRunner = { manager: { save: jest.fn() } };
  const dataSource = { transaction: jest.fn() };

  beforeEach(async () => {
    userRepository.create.mockImplementation((value) => ({
      ...user,
      ...value,
    }));
    userRepository.save.mockImplementation(async (value) => value);
    userRepository.count.mockResolvedValue(0);
    workspaceRepository.count.mockResolvedValue(0);
    workspaceRepository.create.mockImplementation((value) => value);
    workspaceRepository.update.mockResolvedValue({ affected: 1 });
    config.get.mockImplementation((key: string) => {
      if (key === 'IS_MULTIWORKSPACE_ENABLED') return true;
      if (key === 'ONBOARDING_INVITE_TEAM_CREDITS_REWARD_PER_USER') return 100;
      return false;
    });
    invitation.validatePersonalInvitation.mockResolvedValue({
      isValid: true,
      workspace,
    });
    invitation.findInvitationsByEmail.mockResolvedValue([]);
    userWorkspace.findAvailableWorkspacesByEmail.mockResolvedValue({
      availableWorkspacesForSignUp: [],
    });
    subdomain.generateSubdomain.mockResolvedValue('generated');
    enterprise.isValid.mockReturnValue(true);
    application.createWorkspaceCustomApplication.mockResolvedValue({
      universalIdentifier: 'application-id',
    });
    eventLog.createContext.mockReturnValue(eventLog);
    eventLog.insertWorkspaceEvent.mockResolvedValue(undefined);
    metrics.incrementCounterForEvent.mockResolvedValue(undefined);
    queryRunner.manager.save.mockImplementation(
      async (_entity, value) => value,
    );
    dataSource.transaction.mockImplementation(async (callback) =>
      callback({ queryRunner }),
    );

    const module = await Test.createTestingModule({
      providers: [
        SignInUpService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: workspaceRepository,
        },
        { provide: WorkspaceInvitationService, useValue: invitation },
        { provide: UserWorkspaceService, useValue: userWorkspace },
        { provide: OnboardingService, useValue: onboarding },
        { provide: WorkspaceEventEmitter, useValue: emitter },
        { provide: TwentyConfigService, useValue: config },
        { provide: SubdomainManagerService, useValue: subdomain },
        { provide: UserService, useValue: users },
        { provide: MetricsService, useValue: metrics },
        { provide: WorkspaceCacheService, useValue: cache },
        { provide: ApplicationService, useValue: application },
        { provide: FileCorePictureService, useValue: picture },
        { provide: ExceptionHandlerService, useValue: exceptionHandler },
        { provide: EnterprisePlanService, useValue: enterprise },
        { provide: EventLogEmitterService, useValue: eventLog },
        { provide: BillingCreditService, useValue: billingCredit },
        { provide: BillingService, useValue: billing },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(SignInUpService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('rejects weak passwords and verifies valid password hashes', async () => {
    await expect(service.generateHash('short')).rejects.toThrow(
      'Password too weak',
    );
    const passwordHash = await service.generateHash('long-enough-password');

    await expect(
      service.validatePassword({
        password: 'long-enough-password',
        passwordHash,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.validatePassword({ password: 'wrong-password', passwordHash }),
    ).rejects.toThrow('Wrong password');
  });

  it('creates a new user and initializes the correct onboarding steps when joining', async () => {
    const result = await service.signInUpOnExistingWorkspace({
      workspace,
      userData: newUser,
      roleId: 'role-id',
    });

    expect(result.id).toBe(user.id);
    expect(onboarding.setOnboardingConnectAccountPending).toHaveBeenCalledWith(
      { userId: user.id, workspaceId: workspace.id, value: true },
      undefined,
    );
    expect(onboarding.setOnboardingCreateProfilePending).toHaveBeenCalled();
    expect(onboarding.setOnboardingInstallAppsPending).not.toHaveBeenCalled();
    expect(
      userWorkspace.addUserToWorkspaceIfUserNotInWorkspace,
    ).toHaveBeenCalledWith(result, workspace, 'role-id');
  });

  it('rejects a new user joining a workspace that is not ready', async () => {
    await expect(
      service.signInUpOnExistingWorkspace({
        workspace: {
          ...workspace,
          activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
        },
        userData: newUser,
      }),
    ).rejects.toThrow('Workspace is not ready to welcome new members');
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('validates and consumes an onboarding invitation and grants its reward', async () => {
    const token = {
      value: 'token',
      type: AppTokenType.OnboardingInvitationToken,
      context: { roleId: 'role-id' },
    } as AppTokenEntity;

    const result = await service.signInUp({
      workspace,
      invitation: token,
      userData: newUser,
      authParams,
    });

    expect(result.user.id).toBe(user.id);
    expect(invitation.validatePersonalInvitation).toHaveBeenCalledWith({
      workspacePersonalInviteToken: 'token',
      email: user.email,
    });
    expect(billingCredit.grantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        amountMicro: 100,
        idempotencyKey: `onboarding-invite-team:${workspace.id}:${user.id}`,
      }),
    );
    expect(invitation.invalidateWorkspaceInvitation).toHaveBeenCalledWith(
      workspace.id,
      user.email,
    );
    expect(users.markEmailAsVerified).toHaveBeenCalledWith(user.id);
  });

  it('rejects an invalid invitation before creating a user', async () => {
    invitation.validatePersonalInvitation.mockResolvedValue({ isValid: false });

    await expect(
      service.signInUp({
        workspace,
        invitation: { value: 'token' } as AppTokenEntity,
        userData: newUser,
        authParams,
      }),
    ).rejects.toThrow('Invitation not found');
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(invitation.invalidateWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it('continues consuming an invitation if the reward fails', async () => {
    billingCredit.grantCredits.mockRejectedValue(
      new Error('credit unavailable'),
    );

    await expect(
      service.signInUp({
        workspace,
        invitation: {
          value: 'token',
          type: AppTokenType.OnboardingInvitationToken,
        } as AppTokenEntity,
        userData: newUser,
        authParams,
      }),
    ).resolves.toBeDefined();
    expect(invitation.invalidateWorkspaceInvitation).toHaveBeenCalled();
    expect(users.markEmailAsVerified).toHaveBeenCalledWith(user.id);
  });

  it('creates a workspace and initializes onboarding and a cloud DPA in the transaction', async () => {
    const result = await service.signUpOnNewWorkspace(newUser, {
      displayName: '  My workspace  ',
      subdomain: 'chosen',
    });

    expect(result.workspace.displayName).toBe('My workspace');
    expect(subdomain.validateSubdomainOrThrow).toHaveBeenCalledWith('chosen');
    expect(userWorkspace.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, isExistingUser: false }),
      queryRunner,
    );
    expect(onboarding.setOnboardingConnectAccountPending).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, value: true }),
      queryRunner,
    );
    expect(onboarding.setOnboardingCreateProfilePending).toHaveBeenCalled();
    expect(onboarding.setOnboardingInstallAppsPending).toHaveBeenCalled();
    expect(onboarding.setOnboardingInviteTeamPending).toHaveBeenCalled();
    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      DpaAgreementEntity,
      expect.objectContaining({
        acceptedByUserId: user.id,
        acceptedByEmail: user.email,
      }),
    );
    expect(cache.invalidateAndRecompute).toHaveBeenCalledWith(
      result.workspace.id,
      ['flatApplicationMaps'],
    );
  });

  it('cleans up an inferred logo when another logo wins the update race', async () => {
    picture.uploadWorkspaceLogoFromUrl.mockResolvedValue({ id: 'logo-id' });
    workspaceRepository.update.mockResolvedValue({ affected: 0 });

    const result = await service.signUpOnNewWorkspace(newUser, {
      displayName: 'Name',
    });

    expect(picture.deleteCorePicture).toHaveBeenCalledWith({
      fileId: 'logo-id',
      workspaceId: result.workspace.id,
    });
    expect(result.workspace.logoFileId).toBeUndefined();
  });

  it('returns the inferred logo and creates a billing customer when enabled', async () => {
    picture.uploadWorkspaceLogoFromUrl.mockResolvedValue({ id: 'logo-id' });
    billing.isBillingEnabled.mockReturnValue(true);

    const result = await service.signUpOnNewWorkspace(newUser, {
      displayName: 'Name',
    });

    expect(result.workspace.logoFileId).toBe('logo-id');
    expect(billing.ensureBillingCustomer).toHaveBeenCalledWith({
      userEmail: user.email,
      workspaceId: result.workspace.id,
      workspaceDisplayName: 'Name',
    });
  });

  it('invalidates the workspace cache even when the transaction fails', async () => {
    dataSource.transaction.mockRejectedValue(new Error('transaction failed'));

    await expect(
      service.signUpOnNewWorkspace(newUser, { displayName: 'Name' }),
    ).rejects.toThrow('transaction failed');
    expect(cache.invalidateAndRecompute).toHaveBeenCalledWith(
      expect.any(String),
      ['flatApplicationMaps'],
    );
  });

  it('rejects workspace creation when restricted to admins', async () => {
    workspaceRepository.count.mockResolvedValue(1);
    config.get.mockImplementation(
      (key: string) =>
        key === 'IS_MULTIWORKSPACE_ENABLED' ||
        key === 'IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS',
    );

    await expect(
      service.signUpOnNewWorkspace(existingUser, { displayName: 'Name' }),
    ).rejects.toThrow('Workspace creation is restricted to admins');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects workspace creation when single-workspace signup is disabled', async () => {
    workspaceRepository.count.mockResolvedValue(1);
    config.get.mockReturnValue(false);

    await expect(
      service.signUpOnNewWorkspace(existingUser, { displayName: 'Name' }),
    ).rejects.toThrow('New workspace setup is disabled');
  });

  it('rejects duplicate users signing up without a workspace', async () => {
    users.findUserByEmail.mockResolvedValue(user);

    await expect(
      service.signUpWithoutWorkspace({ email: user.email }, authParams),
    ).rejects.toThrow('User already exists');
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('creates a user without a workspace and grants initial admin access', async () => {
    const result = await service.signUpWithoutWorkspace(
      { email: user.email },
      authParams,
    );

    expect(result.email).toBe(user.email);
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        canImpersonate: true,
        canAccessFullAdminPanel: true,
      }),
    );
  });

  it('rejects signup without a workspace when no destination is provisioned', async () => {
    workspaceRepository.count.mockResolvedValue(1);
    config.get.mockReturnValue(false);

    await expect(
      service.signUpWithoutWorkspace({ email: user.email }, authParams),
    ).rejects.toThrow('New workspace setup is disabled');
    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
