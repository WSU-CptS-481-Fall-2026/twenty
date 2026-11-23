import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { AppTokenType } from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import * as authUtil from 'src/engine/core-modules/auth/auth.util';
import * as signUpDecisionUtil from 'src/engine/core-modules/auth/utils/get-sign-up-without-workspace-decision.util';
import * as destinationUtil from 'src/engine/core-modules/auth/utils/has-provisioned-sign-up-destination.util';
import { BillingCreditService } from 'src/engine/core-modules/billing/services/billing-credit.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
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
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceException,
  WorkspaceExceptionCode,
} from 'src/engine/core-modules/workspace/workspace.exception';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

describe('SignInUpService', () => {
  let service: SignInUpService;
  let userRepository: jest.Mocked<Repository<UserEntity>>;
  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let workspaceInvitationService: jest.Mocked<WorkspaceInvitationService>;
  let userWorkspaceService: jest.Mocked<UserWorkspaceService>;
  let onboardingService: jest.Mocked<OnboardingService>;
  let workspaceEventEmitter: jest.Mocked<WorkspaceEventEmitter>;
  let twentyConfigService: jest.Mocked<TwentyConfigService>;
  let subdomainManagerService: jest.Mocked<SubdomainManagerService>;
  let userService: jest.Mocked<UserService>;
  let metricsService: jest.Mocked<MetricsService>;
  let workspaceCacheService: jest.Mocked<WorkspaceCacheService>;
  let applicationService: jest.Mocked<ApplicationService>;
  let fileCorePictureService: jest.Mocked<FileCorePictureService>;
  let exceptionHandlerService: jest.Mocked<ExceptionHandlerService>;
  let enterprisePlanService: jest.Mocked<EnterprisePlanService>;
  let eventLogEmitterService: jest.Mocked<EventLogEmitterService>;
  let billingCreditService: jest.Mocked<BillingCreditService>;
  let billingService: jest.Mocked<BillingService>;
  let dataSource: { transaction: jest.Mock };

  const mockWorkspace = {
    id: 'ws-1',
    displayName: 'Acme',
    subdomain: 'acme',
    activationStatus: WorkspaceActivationStatus.ACTIVE,
    logoFileId: null,
  } as unknown as WorkspaceEntity;

  const mockExistingUser = {
    id: 'user-1',
    email: 'dev@twenty.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    locale: 'en',
    canAccessFullAdminPanel: false,
  } as unknown as UserEntity;

  beforeEach(async () => {
    const managerSave = jest.fn(async (_entity, doc) => ({
      ...doc,
      id: doc.id ?? 'saved-id',
    }));

    dataSource = {
      transaction: jest.fn(async (cb) =>
        cb({
          queryRunner: {
            manager: { save: managerSave },
          },
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignInUpService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            create: jest.fn((dto) => ({ id: 'new-user-1', ...dto })),
            save: jest.fn(async (doc) => ({ id: 'new-user-1', ...doc })),
            count: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            create: jest.fn((dto) => ({ ...dto })),
            count: jest.fn().mockResolvedValue(1),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: WorkspaceInvitationService,
          useValue: {
            validatePersonalInvitation: jest.fn(),
            invalidateWorkspaceInvitation: jest.fn(),
            findInvitationsByEmail: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: UserWorkspaceService,
          useValue: {
            checkUserWorkspaceExists: jest.fn().mockResolvedValue(true),
            addUserToWorkspaceIfUserNotInWorkspace: jest.fn(),
            findAvailableWorkspacesByEmail: jest
              .fn()
              .mockResolvedValue({ availableWorkspacesForSignUp: [] }),
            create: jest.fn(),
          },
        },
        {
          provide: OnboardingService,
          useValue: {
            setOnboardingConnectAccountPending: jest.fn(),
            setOnboardingCreateProfilePending: jest.fn(),
            setOnboardingInstallAppsPending: jest.fn(),
            setOnboardingInviteTeamPending: jest.fn(),
          },
        },
        {
          provide: WorkspaceEventEmitter,
          useValue: { emitCustomBatchEvent: jest.fn() },
        },
        {
          provide: TwentyConfigService,
          useValue: { get: jest.fn().mockReturnValue(true) },
        },
        {
          provide: SubdomainManagerService,
          useValue: {
            validateSubdomainOrThrow: jest.fn(),
            generateSubdomain: jest.fn().mockResolvedValue('generated-sub'),
          },
        },
        {
          provide: UserService,
          useValue: {
            markEmailAsVerified: jest.fn(),
            findUserByEmail: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: MetricsService,
          useValue: { incrementCounterForEvent: jest.fn() },
        },
        {
          provide: WorkspaceCacheService,
          useValue: { invalidateAndRecompute: jest.fn() },
        },
        {
          provide: ApplicationService,
          useValue: {
            createWorkspaceCustomApplication: jest.fn().mockResolvedValue({
              universalIdentifier: 'app-uid-1',
            }),
          },
        },
        {
          provide: FileCorePictureService,
          useValue: {
            deleteCorePicture: jest.fn(),
            uploadWorkspaceLogoFromUrl: jest
              .fn()
              .mockResolvedValue({ id: 'file-1' }),
          },
        },
        {
          provide: ExceptionHandlerService,
          useValue: { captureExceptions: jest.fn() },
        },
        {
          provide: EnterprisePlanService,
          useValue: { isValid: jest.fn().mockReturnValue(true) },
        },
        {
          provide: EventLogEmitterService,
          useValue: {
            createContext: jest.fn().mockReturnValue({
              insertWorkspaceEvent: jest.fn(),
            }),
          },
        },
        {
          provide: BillingCreditService,
          useValue: { grantCredits: jest.fn() },
        },
        {
          provide: BillingService,
          useValue: {
            isBillingEnabled: jest.fn().mockReturnValue(false),
            ensureBillingCustomer: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get(SignInUpService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    workspaceRepository = module.get(getRepositoryToken(WorkspaceEntity));
    workspaceInvitationService = module.get(WorkspaceInvitationService);
    userWorkspaceService = module.get(UserWorkspaceService);
    onboardingService = module.get(OnboardingService);
    workspaceEventEmitter = module.get(WorkspaceEventEmitter);
    twentyConfigService = module.get(TwentyConfigService);
    subdomainManagerService = module.get(SubdomainManagerService);
    userService = module.get(UserService);
    metricsService = module.get(MetricsService);
    workspaceCacheService = module.get(WorkspaceCacheService);
    applicationService = module.get(ApplicationService);
    fileCorePictureService = module.get(FileCorePictureService);
    exceptionHandlerService = module.get(ExceptionHandlerService);
    enterprisePlanService = module.get(EnterprisePlanService);
    eventLogEmitterService = module.get(EventLogEmitterService);
    billingCreditService = module.get(BillingCreditService);
    billingService = module.get(BillingService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('computePartialUserFromUserPayload', () => {
    it('builds partial user with password hash when provider is Password', async () => {
      jest.spyOn(authUtil, 'hashPassword').mockResolvedValue('hashed-pw');

      const result = await service.computePartialUserFromUserPayload(
        {
          email: 'ada@twenty.com',
          firstName: 'Ada',
          isEmailAlreadyVerified: true,
        },
        { provider: AuthProviderEnum.Password, password: 'StrongPassword1!' },
      );

      expect(result).toMatchObject({
        email: 'ada@twenty.com',
        firstName: 'Ada',
        lastName: '',
        locale: 'en',
        isEmailVerified: true,
        passwordHash: 'hashed-pw',
      });
    });

    it('throws INVALID_INPUT when email is missing', async () => {
      await expect(
        service.computePartialUserFromUserPayload(
          {} as never,
          { provider: AuthProviderEnum.Google } as never,
        ),
      ).rejects.toMatchObject({
        code: AuthExceptionCode.INVALID_INPUT,
      });
    });
  });

  describe('signInUp', () => {
    it('completes sign-in/up via personal invitation when workspace and invitation are provided', async () => {
      workspaceInvitationService.validatePersonalInvitation.mockResolvedValue({
        isValid: true,
        workspace: mockWorkspace,
      } as never);

      const res = await service.signInUp({
        workspace: mockWorkspace,
        invitation: {
          value: 'invite-token',
          type: AppTokenType.OnboardingInvitationToken,
          context: { roleId: 'role-1' },
        },
        userData: {
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email: 'invited@twenty.com',
            firstName: 'Grace',
            lastName: 'Hopper',
            picture: '',
            locale: 'en',
            isEmailVerified: false,
          },
        },
      } as never);

      expect(res.workspace).toEqual(mockWorkspace);
      expect(res.user.email).toBe('invited@twenty.com');
      expect(billingCreditService.grantCredits).toHaveBeenCalledTimes(1);
      expect(
        workspaceInvitationService.invalidateWorkspaceInvitation,
      ).toHaveBeenCalledWith(mockWorkspace.id, 'invited@twenty.com');
      expect(userService.markEmailAsVerified).toHaveBeenCalledWith(res.user.id);
    });

    it('signs in an existing user on an existing workspace when invitation is omitted', async () => {
      const res = await service.signInUp({
        workspace: mockWorkspace,
        userData: { type: 'existingUser', existingUser: mockExistingUser },
      } as never);

      expect(res).toEqual({ user: mockExistingUser, workspace: mockWorkspace });
      expect(
        userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
      ).toHaveBeenCalledWith(mockExistingUser, mockWorkspace, undefined);
    });
  });

  describe('generateHash', () => {
    it('hashes a valid password', async () => {
      jest.spyOn(authUtil, 'hashPassword').mockResolvedValue('bcrypt-hash');

      await expect(service.generateHash('ValidPass123!')).resolves.toBe(
        'bcrypt-hash',
      );
    });

    it('throws INVALID_INPUT on a weak password', async () => {
      await expect(service.generateHash('weak')).rejects.toBeInstanceOf(
        AuthException,
      );
    });
  });

  describe('validatePassword', () => {
    it('resolves when password matches hash', async () => {
      jest.spyOn(authUtil, 'compareHash').mockResolvedValue(true);

      await expect(
        service.validatePassword({ password: 'secret', passwordHash: 'hash' }),
      ).resolves.toBeUndefined();
    });

    it('throws FORBIDDEN_EXCEPTION when password does not match', async () => {
      jest.spyOn(authUtil, 'compareHash').mockResolvedValue(false);

      await expect(
        service.validatePassword({ password: 'wrong', passwordHash: 'hash' }),
      ).rejects.toMatchObject({
        code: AuthExceptionCode.FORBIDDEN_EXCEPTION,
      });
    });
  });

  describe('signInUpOnExistingWorkspace', () => {
    it('creates a new user, activates onboarding, and adds to workspace', async () => {
      const res = await service.signInUpOnExistingWorkspace({
        workspace: mockWorkspace,
        roleId: 'role-member',
        userData: {
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email: 'new@twenty.com',
            firstName: 'New',
            lastName: 'User',
            picture: '',
            locale: 'en',
            isEmailVerified: false,
          },
        },
      });

      expect(res.email).toBe('new@twenty.com');
      expect(
        onboardingService.setOnboardingConnectAccountPending,
      ).toHaveBeenCalled();
      expect(
        onboardingService.setOnboardingCreateProfilePending,
      ).toHaveBeenCalled();
      expect(
        userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
      ).toHaveBeenCalledWith(res, mockWorkspace, 'role-member');
    });

    it('throws FORBIDDEN_EXCEPTION when workspace is not ready for a new member', async () => {
      const inactiveWorkspace = {
        ...mockWorkspace,
        activationStatus: WorkspaceActivationStatus.SUSPENDED,
      } as WorkspaceEntity;

      await expect(
        service.signInUpOnExistingWorkspace({
          workspace: inactiveWorkspace,
          userData: {
            type: 'newUserWithPicture',
            newUserWithPicture: {
              email: 'blocked@twenty.com',
              firstName: 'Blocked',
              lastName: 'User',
              picture: '',
              locale: 'en',
              isEmailVerified: false,
            },
          },
        }),
      ).rejects.toMatchObject({
        code: AuthExceptionCode.FORBIDDEN_EXCEPTION,
      });
    });
  });

  describe('signUpOnNewWorkspace', () => {
    it('creates workspace, custom application, user-workspace, DPA, and invalidates cache', async () => {
      billingService.isBillingEnabled.mockReturnValue(true);

      const result = await service.signUpOnNewWorkspace(
        {
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email: 'founder@acme.io',
            firstName: 'Founder',
            lastName: 'One',
            picture: '',
            locale: 'en',
            isEmailVerified: true,
          },
        },
        { displayName: 'New Workspace' },
      );

      expect(result.workspace.displayName).toBe('New Workspace');
      expect(result.workspace.logoFileId).toBe('file-1');
      expect(
        applicationService.createWorkspaceCustomApplication,
      ).toHaveBeenCalledTimes(1);
      expect(billingService.ensureBillingCustomer).toHaveBeenCalledTimes(1);
      expect(
        workspaceCacheService.invalidateAndRecompute,
      ).toHaveBeenCalledTimes(1);
    });

    it('throws SUBDOMAIN_ALREADY_TAKEN on unique violation with requested subdomain', async () => {
      const dbError = Object.assign(
        new QueryFailedError('INSERT', [], new Error('dup')),
        { code: POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION },
      );
      dataSource.transaction.mockRejectedValue(dbError);

      await expect(
        service.signUpOnNewWorkspace(
          { type: 'existingUser', existingUser: mockExistingUser },
          { displayName: 'Taken WS', subdomain: 'taken' },
        ),
      ).rejects.toMatchObject({
        code: WorkspaceExceptionCode.SUBDOMAIN_ALREADY_TAKEN,
      });
      expect(
        workspaceCacheService.invalidateAndRecompute,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('signUpWithoutWorkspace', () => {
    it('creates a user without a workspace when allowed via provisioned destination', async () => {
      jest
        .spyOn(signUpDecisionUtil, 'getSignUpWithoutWorkspaceDecision')
        .mockReturnValue('requiresDestination');
      workspaceInvitationService.findInvitationsByEmail.mockResolvedValue([
        { id: 'inv-1' } as never,
      ]);
      jest
        .spyOn(destinationUtil, 'hasProvisionedSignUpDestination')
        .mockReturnValue(true);

      const created = await service.signUpWithoutWorkspace(
        { email: 'solo@twenty.com', firstName: 'Solo' },
        { provider: AuthProviderEnum.Google } as never,
      );

      expect(created.email).toBe('solo@twenty.com');
      expect(workspaceEventEmitter.emitCustomBatchEvent).toHaveBeenCalledTimes(
        1,
      );
      expect(eventLogEmitterService.createContext).toHaveBeenCalledTimes(1);
      expect(metricsService.incrementCounterForEvent).toHaveBeenCalledTimes(1);
    });

    it('throws USER_ALREADY_EXISTS if user email is already registered', async () => {
      userService.findUserByEmail.mockResolvedValue(mockExistingUser);

      await expect(
        service.signUpWithoutWorkspace({ email: mockExistingUser.email }, {
          provider: AuthProviderEnum.Google,
        } as never),
      ).rejects.toMatchObject({
        code: AuthExceptionCode.USER_ALREADY_EXISTS,
      });
    });
  });
});
